@preconcurrency import CoreMedia
@preconcurrency import CoreVideo
@preconcurrency import VideoToolbox
import Foundation
import MacMediaEngineCore

private let hardwareVideoEncoderCallback: VTCompressionOutputCallback = {
    outputCallbackRefCon,
    _,
    status,
    _,
    sampleBuffer
in
    guard let outputCallbackRefCon else { return }
    let encoder = Unmanaged<HardwareVideoEncoder>
        .fromOpaque(outputCallbackRefCon)
        .takeUnretainedValue()
    encoder.receive(status: status, sampleBuffer: sampleBuffer)
}

final class HardwareVideoEncoder: @unchecked Sendable {
    private let request: CaptureRequest
    private let muxer: VideoSegmentMuxer
    private let muxerQueue: DispatchQueue
    private var session: VTCompressionSession?
    private var lastForcedKeyframe: CMTime?
    private let keyframeInterval = CMTime(value: CaptureEncodingPolicy.segmentDurationUs, timescale: 1_000_000)
    private let errorLock = NSLock()
    private let inFlightSlots = DispatchSemaphore(value: CaptureEncodingPolicy.frameQueueCapacity)
    private var callbackError: Error?
    private var submittedFrames = 0
    private var encodedFrames = 0

    init(
        request: CaptureRequest,
        store: SegmentedRecordingStore,
        timeline: RecordingTimeline,
        track: RecordingTrackKind = .screen
    ) throws {
        self.request = request
        self.muxer = VideoSegmentMuxer(store: store, track: track, timeline: timeline)
        self.muxerQueue = DispatchQueue(
            label: "com.excalicast.mux.video.\(track.rawValue)",
            qos: .userInitiated
        )
        try configure()
    }

    deinit {
        if let session { VTCompressionSessionInvalidate(session) }
    }

    func encode(_ sampleBuffer: CMSampleBuffer) throws {
        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            throw NativeCaptureError.frameMissingPixelBuffer
        }
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let duration = CMSampleBufferGetDuration(sampleBuffer)
        try encode(
            pixelBuffer: imageBuffer,
            presentationTime: presentationTime,
            duration: duration
        )
    }

    func encode(
        pixelBuffer: CVPixelBuffer,
        presentationTime: CMTime,
        duration: CMTime = .invalid
    ) throws {
        try throwCallbackErrorIfNeeded()
        inFlightSlots.wait()
        var submitted = false
        defer { if !submitted { inFlightSlots.signal() } }
        guard let session else { throw NativeCaptureError.videoEncoderCreateFailed(-1) }
        let forceKeyframe = lastForcedKeyframe == nil
            || presentationTime - (lastForcedKeyframe ?? .zero) >= keyframeInterval
        let frameProperties = forceKeyframe
            ? [kVTEncodeFrameOptionKey_ForceKeyFrame as String: true] as CFDictionary
            : nil
        if forceKeyframe { lastForcedKeyframe = presentationTime }

        let status = VTCompressionSessionEncodeFrame(
            session,
            imageBuffer: pixelBuffer,
            presentationTimeStamp: presentationTime,
            duration: duration.isValid ? duration : .invalid,
            frameProperties: frameProperties,
            sourceFrameRefcon: nil,
            infoFlagsOut: nil
        )
        guard status == noErr else { throw NativeCaptureError.videoEncodeFailed(status) }
        errorLock.lock()
        submittedFrames += 1
        errorLock.unlock()
        submitted = true
    }

    func finish() throws {
        guard let session else { return }
        let status = VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid)
        guard status == noErr else { throw NativeCaptureError.videoEncodeFailed(status) }
        VTCompressionSessionInvalidate(session)
        self.session = nil
        muxerQueue.sync {}
        try throwCallbackErrorIfNeeded()
        try muxer.finishAndWait()
    }

    fileprivate func receive(status: OSStatus, sampleBuffer: CMSampleBuffer?) {
        defer { inFlightSlots.signal() }
        errorLock.lock()
        encodedFrames += 1
        errorLock.unlock()
        guard status == noErr, let sampleBuffer else {
            recordCallbackError(NativeCaptureError.videoEncoderOutputFailed(status))
            return
        }
        do {
            try muxerQueue.sync { try muxer.append(sampleBuffer) }
        } catch {
            recordCallbackError(error)
        }
    }

    func frameCounts() -> (submitted: Int, encoded: Int) {
        errorLock.lock()
        let result = (submittedFrames, encodedFrames)
        errorLock.unlock()
        return result
    }

    private func configure() throws {
        let codecType: CMVideoCodecType = request.codec == .h264
            ? kCMVideoCodecType_H264
            : kCMVideoCodecType_HEVC
        let encoderSpecification = [
            kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder as String: true,
        ] as CFDictionary
        var createdSession: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            width: Int32(request.width),
            height: Int32(request.height),
            codecType: codecType,
            encoderSpecification: encoderSpecification,
            imageBufferAttributes: nil,
            compressedDataAllocator: nil,
            outputCallback: hardwareVideoEncoderCallback,
            refcon: Unmanaged.passUnretained(self).toOpaque(),
            compressionSessionOut: &createdSession
        )
        guard status == noErr, let createdSession else {
            throw NativeCaptureError.videoEncoderCreateFailed(status)
        }
        session = createdSession
        try setProperty(kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue, session: createdSession)
        try setProperty(kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse, session: createdSession)
        try setProperty(
            kVTCompressionPropertyKey_ExpectedFrameRate,
            value: NSNumber(value: request.framesPerSecond),
            session: createdSession
        )
        try setProperty(
            kVTCompressionPropertyKey_AverageBitRate,
            value: NSNumber(value: CaptureEncodingPolicy.targetBitRate(for: request)),
            session: createdSession
        )
        try setProperty(
            kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration,
            value: NSNumber(value: 2),
            session: createdSession
        )
        if request.codec == .h264 {
            try setProperty(
                kVTCompressionPropertyKey_ProfileLevel,
                value: kVTProfileLevel_H264_High_AutoLevel,
                session: createdSession
            )
        }
        let prepareStatus = VTCompressionSessionPrepareToEncodeFrames(createdSession)
        guard prepareStatus == noErr else {
            throw NativeCaptureError.videoEncoderPropertyFailed(prepareStatus)
        }
    }

    private func setProperty(_ key: CFString, value: CFTypeRef, session: VTCompressionSession) throws {
        let status = VTSessionSetProperty(session, key: key, value: value)
        guard status == noErr else { throw NativeCaptureError.videoEncoderPropertyFailed(status) }
    }

    private func recordCallbackError(_ error: Error) {
        errorLock.lock()
        if callbackError == nil { callbackError = error }
        errorLock.unlock()
    }

    private func throwCallbackErrorIfNeeded() throws {
        errorLock.lock()
        let error = callbackError
        errorLock.unlock()
        if let error { throw error }
    }
}
