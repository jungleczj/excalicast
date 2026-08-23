@preconcurrency import AVFoundation
@preconcurrency import CoreVideo
import Foundation
import MacMediaEngineCore

final class CameraCaptureEngine: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    private let captureQueue = DispatchQueue(label: "com.excalicast.capture.camera", qos: .userInteractive)
    private let encodingQueue = DispatchQueue(label: "com.excalicast.encode.camera", qos: .userInitiated)
    private let queueLock = NSLock()
    private var pendingFrames = LatestFrameQueue<CMSampleBuffer>(capacity: CaptureEncodingPolicy.frameQueueCapacity)
    private var drainScheduled = false
    private var session: AVCaptureSession?
    private var output: AVCaptureVideoDataOutput?
    private var encoder: HardwareVideoEncoder?
    private var terminalError: Error?
    private let firstSampleGate = FirstMediaSampleGate()

    func start(
        deviceID: String?,
        request: CaptureRequest,
        store: SegmentedRecordingStore,
        timeline: RecordingTimeline
    ) throws {
        var deviceTypes: [AVCaptureDevice.DeviceType] = [.builtInWideAngleCamera, .externalUnknown]
        if #available(macOS 14.0, *) { deviceTypes.append(.continuityCamera) }
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: deviceTypes,
            mediaType: .video,
            position: .unspecified
        )
        let device: AVCaptureDevice?
        if let deviceID {
            device = discovery.devices.first { $0.uniqueID == deviceID }
        } else {
            device = AVCaptureDevice.default(for: .video)
        }
        guard let device else { throw NativeCaptureError.cameraNotFound(deviceID) }
        let formats = device.formats
        let candidates = formats.enumerated().compactMap { index, format -> CameraFormatCandidate? in
            let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            guard let range = format.videoSupportedFrameRateRanges.first(where: {
                $0.minFrameRate <= Double(request.framesPerSecond)
                    && $0.maxFrameRate >= Double(request.framesPerSecond)
            }) else { return nil }
            return CameraFormatCandidate(
                id: index,
                width: Int(dimensions.width),
                height: Int(dimensions.height),
                minimumFPS: range.minFrameRate,
                maximumFPS: range.maxFrameRate
            )
        }
        guard let selected = CameraFormatPolicy.select(
            requestedWidth: request.width,
            requestedHeight: request.height,
            requestedFramesPerSecond: request.framesPerSecond,
            candidates: candidates
        ) else {
            throw NativeCaptureError.cameraFormatUnsupported(
                width: request.width,
                height: request.height,
                framesPerSecond: request.framesPerSecond
            )
        }
        let frameDuration = CMTime(
            value: 1,
            timescale: CMTimeScale(request.framesPerSecond)
        )
        let input = try AVCaptureDeviceInput(device: device)
        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
            kCVPixelBufferWidthKey as String: request.width,
            kCVPixelBufferHeightKey as String: request.height,
        ]
        output.setSampleBufferDelegate(self, queue: captureQueue)

        let session = AVCaptureSession()
        session.beginConfiguration()
        guard session.canAddInput(input) else { throw NativeCaptureError.cameraCannotAddInput }
        session.addInput(input)
        try device.lockForConfiguration()
        device.activeFormat = formats[selected.id]
        device.activeVideoMinFrameDuration = frameDuration
        device.activeVideoMaxFrameDuration = frameDuration
        device.unlockForConfiguration()
        guard session.canAddOutput(output) else { throw NativeCaptureError.cameraCannotAddOutput }
        session.addOutput(output)
        session.commitConfiguration()

        self.encoder = try HardwareVideoEncoder(
            request: request,
            store: store,
            timeline: timeline,
            track: .camera
        )
        self.output = output
        self.session = session
        session.startRunning()
        guard session.isRunning else { throw NativeCaptureError.cameraStartFailed }
        guard firstSampleGate.wait(timeout: 3) == .ready else {
            try throwTerminalErrorIfNeeded()
            throw NativeCaptureError.mediaTrackNotReady(.camera)
        }
    }

    func stop() throws {
        var firstError: Error?
        output?.setSampleBufferDelegate(nil, queue: nil)
        session?.stopRunning()
        captureQueue.sync {}
        encodingQueue.sync {}
        do { try throwTerminalErrorIfNeeded() } catch { firstError = error }
        do { try encoder?.finish() } catch { if firstError == nil { firstError = error } }
        encoder = nil
        output = nil
        session = nil
        if let firstError { throw firstError }
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        queueLock.lock()
        pendingFrames.offer(sampleBuffer)
        let shouldSchedule = !drainScheduled
        if shouldSchedule { drainScheduled = true }
        queueLock.unlock()
        if shouldSchedule {
            encodingQueue.async { [weak self] in self?.drainFrames() }
        }
    }

    private func drainFrames() {
        while true {
            queueLock.lock()
            guard let frame = pendingFrames.popOldest() else {
                drainScheduled = false
                queueLock.unlock()
                return
            }
            queueLock.unlock()
            do {
                try encoder?.encode(frame)
                firstSampleGate.markReady()
            } catch {
                recordTerminalError(error)
            }
        }
    }

    private func recordTerminalError(_ error: Error) {
        queueLock.lock()
        if terminalError == nil { terminalError = error }
        queueLock.unlock()
        firstSampleGate.markFailed()
    }

    private func throwTerminalErrorIfNeeded() throws {
        queueLock.lock()
        let error = terminalError
        queueLock.unlock()
        if let error { throw error }
    }
}
