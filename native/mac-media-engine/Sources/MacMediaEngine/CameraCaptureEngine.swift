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
    private var controls: CaptureControlState?
    private var hardwareFillTimer: DispatchSourceTimer?
    private var lastPixelBuffer: CVPixelBuffer?
    private var lastSubmittedPresentationTime: CMTime?
    private var hardwareEnabled = true
    private var awaitingFirstFrameAfterRestart = false
    private var terminalError: Error?
    private let firstSampleGate = FirstMediaSampleGate()

    func start(
        deviceID: String?,
        request: CaptureRequest,
        store: SegmentedRecordingStore,
        timeline: RecordingTimeline,
        controls: CaptureControlState
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
        self.controls = controls
        self.hardwareEnabled = true
        session.startRunning()
        guard session.isRunning else { throw NativeCaptureError.cameraStartFailed }
        guard firstSampleGate.wait(timeout: 3) == .ready else {
            try throwTerminalErrorIfNeeded()
            throw NativeCaptureError.mediaTrackNotReady(.camera)
        }
    }

    func stop() throws {
        var firstError: Error?
        hardwareFillTimer?.cancel()
        hardwareFillTimer = nil
        output?.setSampleBufferDelegate(nil, queue: nil)
        session?.stopRunning()
        captureQueue.sync {}
        encodingQueue.sync {}
        do { try throwTerminalErrorIfNeeded() } catch { firstError = error }
        do { try encoder?.finish() } catch { if firstError == nil { firstError = error } }
        encoder = nil
        output = nil
        session = nil
        controls = nil
        lastPixelBuffer = nil
        lastSubmittedPresentationTime = nil
        awaitingFirstFrameAfterRestart = false
        if let firstError { throw firstError }
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        queueLock.lock()
        guard hardwareEnabled else {
            queueLock.unlock()
            return
        }
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
                guard let controls,
                      let presentationTime = ControlledSampleBuffer.videoPresentationTime(frame, controls: controls),
                      let pixelBuffer = CMSampleBufferGetImageBuffer(frame) else { continue }
                queueLock.lock()
                let previous = lastSubmittedPresentationTime
                if previous == nil || presentationTime > previous! {
                    lastPixelBuffer = pixelBuffer
                    lastSubmittedPresentationTime = presentationTime
                    queueLock.unlock()
                    try encoder?.encode(
                        pixelBuffer: pixelBuffer,
                        presentationTime: presentationTime,
                        duration: CMSampleBufferGetDuration(frame)
                    )
                } else {
                    queueLock.unlock()
                }
                firstSampleGate.markReady()
                finishHardwareRestartAfterFirstFrame()
            } catch {
                recordTerminalError(error)
            }
        }
    }

    /**
     * Truly releases/reacquires AVCaptureSession hardware. While off, a bounded
     * 10fps repeat of the last frame keeps the independent camera file seekable;
     * renderer visibility events ensure the frozen filler is never shown.
     */
    func setHardwareEnabled(_ enabled: Bool) throws {
        queueLock.lock()
        let changed = hardwareEnabled != enabled
        queueLock.unlock()
        guard changed else { return }
        if enabled {
            session?.startRunning()
            guard session?.isRunning == true else { throw NativeCaptureError.cameraHardwareTransitionFailed }
            // Keep the bounded filler alive until the first real camera sample is
            // encoded. If startRunning succeeds but the device stalls, the camera
            // track remains continuous while the renderer keeps it hidden.
            queueLock.lock()
            hardwareEnabled = true
            awaitingFirstFrameAfterRestart = true
            queueLock.unlock()
        } else {
            queueLock.lock()
            hardwareEnabled = false
            awaitingFirstFrameAfterRestart = false
            queueLock.unlock()
            session?.stopRunning()
            guard session?.isRunning != true else {
                queueLock.lock(); hardwareEnabled = true; queueLock.unlock()
                throw NativeCaptureError.cameraHardwareTransitionFailed
            }
            captureQueue.sync {}
            encodingQueue.sync {}
            queueLock.lock()
            pendingFrames = LatestFrameQueue<CMSampleBuffer>(
                capacity: CaptureEncodingPolicy.frameQueueCapacity
            )
            queueLock.unlock()
            startHardwareFillTimer()
        }
    }

    private func startHardwareFillTimer() {
        let timer = DispatchSource.makeTimerSource(queue: encodingQueue)
        timer.schedule(deadline: .now() + .milliseconds(100), repeating: .milliseconds(100))
        timer.setEventHandler { [weak self] in self?.emitHardwareOffFiller() }
        hardwareFillTimer = timer
        timer.resume()
    }

    private func emitHardwareOffFiller() {
        queueLock.lock()
        let pixelBuffer = lastPixelBuffer
        let previous = lastSubmittedPresentationTime
        let enabled = hardwareEnabled
        let awaitingRestart = awaitingFirstFrameAfterRestart
        queueLock.unlock()
        guard (!enabled || awaitingRestart), let pixelBuffer, let controls else { return }
        let sourceUs = CMClockGetTime(CMClockGetHostTimeClock())
            .convertScale(1_000_000, method: .roundTowardZero).value
        guard let adjustedUs = controls.adjustedPresentationUs(sourceUs) else { return }
        let presentationTime = CMTime(value: adjustedUs, timescale: 1_000_000)
        guard previous == nil || presentationTime > previous! else { return }
        do {
            try encoder?.encode(
                pixelBuffer: pixelBuffer,
                presentationTime: presentationTime,
                duration: CMTime(value: 1, timescale: 10)
            )
            queueLock.lock(); lastSubmittedPresentationTime = presentationTime; queueLock.unlock()
        } catch {
            recordTerminalError(error)
        }
    }

    private func finishHardwareRestartAfterFirstFrame() {
        queueLock.lock()
        let shouldStopFiller = awaitingFirstFrameAfterRestart
        awaitingFirstFrameAfterRestart = false
        queueLock.unlock()
        guard shouldStopFiller else { return }
        hardwareFillTimer?.cancel()
        hardwareFillTimer = nil
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
