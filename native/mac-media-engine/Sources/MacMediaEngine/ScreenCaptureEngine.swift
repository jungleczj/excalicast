@preconcurrency import CoreMedia
@preconcurrency import CoreVideo
@preconcurrency import ScreenCaptureKit
import Foundation
import MacMediaEngineCore

@available(macOS 13.0, *)
final class ScreenCaptureEngine: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private let captureQueue = DispatchQueue(label: "com.excalicast.capture.screen", qos: .userInteractive)
    private let encodingQueue = DispatchQueue(label: "com.excalicast.encode.screen", qos: .userInitiated)
    private let queueLock = NSLock()
    private var pendingFrames = LatestFrameQueue<CMSampleBuffer>(capacity: CaptureEncodingPolicy.frameQueueCapacity)
    private var drainScheduled = false
    private var stream: SCStream?
    private var encoder: HardwareVideoEncoder?
    private var store: SegmentedRecordingStore?
    private var terminalError: Error?

    func start(
        displayID: CGDirectDisplayID,
        request: CaptureRequest,
        projectRoot: URL,
        recordingId: String
    ) async throws -> CapturePreflightReport {
        let resourceValues = try projectRoot.deletingLastPathComponent()
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        let availableBytes = resourceValues.volumeAvailableCapacityForImportantUsage ?? 0
        let preflight = try CapturePreflight.evaluateSystem(
            requested: request,
            availableBytes: availableBytes
        )
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
            throw NativeCaptureError.displayNotFound(displayID)
        }

        let store = try SegmentedRecordingStore(root: projectRoot, recordingId: recordingId)
        let encoder = try HardwareVideoEncoder(request: request, store: store)
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.width = request.width
        configuration.height = request.height
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(request.framesPerSecond))
        configuration.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        configuration.queueDepth = CaptureEncodingPolicy.screenCaptureQueueDepth
        configuration.showsCursor = true
        configuration.capturesAudio = false

        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: captureQueue)
        self.store = store
        self.encoder = encoder
        self.stream = stream
        try await stream.startCapture()
        return preflight
    }

    func stop() async throws {
        if let stream { try await stream.stopCapture() }
        self.stream = nil
        encodingQueue.sync {}
        try throwTerminalErrorIfNeeded()
        try encoder?.finish()
        try store?.finalize()
        encoder = nil
        store = nil
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .screen, sampleBuffer.isValid, CMSampleBufferDataIsReady(sampleBuffer) else { return }
        queueLock.lock()
        pendingFrames.offer(sampleBuffer)
        let shouldSchedule = !drainScheduled
        if shouldSchedule { drainScheduled = true }
        queueLock.unlock()
        if shouldSchedule {
            encodingQueue.async { [weak self] in self?.drainFrames() }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        recordTerminalError(error)
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
            } catch {
                recordTerminalError(error)
            }
        }
    }

    private func recordTerminalError(_ error: Error) {
        queueLock.lock()
        if terminalError == nil { terminalError = error }
        queueLock.unlock()
    }

    private func throwTerminalErrorIfNeeded() throws {
        queueLock.lock()
        let error = terminalError
        queueLock.unlock()
        if let error { throw error }
    }
}
