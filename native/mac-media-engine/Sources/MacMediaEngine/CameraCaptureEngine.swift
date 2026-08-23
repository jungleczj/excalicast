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
        let device = deviceID.flatMap { id in discovery.devices.first { $0.uniqueID == id } }
            ?? AVCaptureDevice.default(for: .video)
        guard let device else { throw NativeCaptureError.cameraNotFound(deviceID) }
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
        session.sessionPreset = preset(for: request)
        guard session.canAddInput(input) else { throw NativeCaptureError.cameraCannotAddInput }
        session.addInput(input)
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
            do { try encoder?.encode(frame) }
            catch { recordTerminalError(error) }
        }
    }

    private func preset(for request: CaptureRequest) -> AVCaptureSession.Preset {
        if request.width >= 1_920 || request.height >= 1_080 { return .hd1920x1080 }
        if request.width >= 1_280 || request.height >= 720 { return .hd1280x720 }
        return .vga640x480
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
