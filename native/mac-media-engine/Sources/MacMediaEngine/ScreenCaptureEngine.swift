@preconcurrency import CoreMedia
@preconcurrency import CoreVideo
@preconcurrency import CoreGraphics
@preconcurrency import ScreenCaptureKit
import Foundation
import MacMediaEngineCore

private struct SendablePixelBuffer: @unchecked Sendable {
    let value: CVPixelBuffer
}

private final class InitialFrameContinuationGate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<SendablePixelBuffer, Error>?

    init(_ continuation: CheckedContinuation<SendablePixelBuffer, Error>) {
        self.continuation = continuation
    }

    func resolve(_ result: sending Result<SendablePixelBuffer, Error>) {
        lock.lock()
        let pending = continuation
        continuation = nil
        lock.unlock()
        pending?.resume(with: result)
    }
}

@available(macOS 13.0, *)
enum CaptureSourceSelection: Sendable {
    case display(UInt32)
    case window(UInt32)
}

@available(macOS 13.0, *)
final class ScreenCaptureEngine: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private let captureQueue = DispatchQueue(label: "com.excalicast.capture.screen", qos: .userInteractive)
    private let encodingQueue = DispatchQueue(label: "com.excalicast.encode.screen", qos: .userInitiated)
    private let queueLock = NSLock()
    private var pendingFrames = LatestFrameQueue<CMSampleBuffer>(capacity: CaptureEncodingPolicy.frameQueueCapacity)
    private var drainScheduled = false
    private var stream: SCStream?
    private var encoder: HardwareVideoEncoder?
    private var systemAudioWriter: AudioSegmentWriter?
    private var store: SegmentedRecordingStore?
    private var terminalError: Error?
    private var heartbeatTimer: DispatchSourceTimer?
    private var lastPixelBuffer: CVPixelBuffer?
    private var lastSubmittedPresentationTime: CMTime?
    private var seededFrames = 0
    private var receivedScreenSamples = 0
    private var completeSamples = 0
    private var idleSamples = 0
    private var blankSamples = 0
    private var suspendedSamples = 0
    private var pixelBufferSamples = 0

    func start(
        source: CaptureSourceSelection,
        request: CaptureRequest,
        store: SegmentedRecordingStore,
        timeline: RecordingTimeline,
        captureSystemAudio: Bool,
        excludedWindowIDs: [UInt32]
    ) async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        let filter: SCContentFilter
        switch source {
        case .display(let displayID):
            guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
                throw NativeCaptureError.displayNotFound(displayID)
            }
            let matchingIDs = Set(CaptureWindowExclusionPolicy.matchingWindowIDs(
                requested: excludedWindowIDs,
                available: content.windows.map(\.windowID)
            ))
            let excludedWindows = content.windows.filter { matchingIDs.contains($0.windowID) }
            filter = SCContentFilter(display: display, excludingWindows: excludedWindows)
        case .window(let windowID):
            guard let window = content.windows.first(where: { $0.windowID == windowID }) else {
                throw NativeCaptureError.windowNotFound(windowID)
            }
            filter = SCContentFilter(desktopIndependentWindow: window)
        }

        let encoder = try HardwareVideoEncoder(request: request, store: store, timeline: timeline)
        let systemAudioWriter = captureSystemAudio
            ? AudioSegmentWriter(
                store: store,
                track: .systemAudio,
                channelCount: 2,
                bitRate: 192_000,
                timeline: timeline
            )
            : nil
        let configuration = SCStreamConfiguration()
        configuration.width = request.width
        configuration.height = request.height
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(request.framesPerSecond))
        // ScreenCaptureKit natively delivers IOSurface-backed BGRA. Passing that
        // surface directly to VideoToolbox avoids a CPU-side color conversion.
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.queueDepth = CaptureEncodingPolicy.screenCaptureQueueDepth
        configuration.showsCursor = true
        configuration.capturesAudio = captureSystemAudio
        configuration.sampleRate = 48_000
        configuration.channelCount = 2
        configuration.excludesCurrentProcessAudio = true

        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: captureQueue)
        if captureSystemAudio {
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: captureQueue)
        }
        self.store = store
        self.encoder = encoder
        self.systemAudioWriter = systemAudioWriter
        self.requestFramesPerSecond = request.framesPerSecond
        self.stream = stream
        let initialPixelBuffer = try await captureInitialPixelBuffer(
            filter: filter,
            configuration: configuration,
            source: source
        )
        try await stream.startCapture()
        if isLikelyProtectedBlackFrame(initialPixelBuffer) {
            try await Task.sleep(nanoseconds: 750_000_000)
            if currentCompleteSampleCount() == 0 {
                try? await stream.stopCapture()
                self.stream = nil
                throw NativeCaptureError.captureSourceUnavailableOrProtected
            }
        }
        try encodingQueue.sync {
            queueLock.lock()
            let shouldSeed = InitialFrameSeedPolicy.shouldSeed(
                streamCompleteFrames: completeSamples,
                seededFrames: seededFrames
            )
            queueLock.unlock()
            if shouldSeed {
                try submit(
                    initialPixelBuffer,
                    presentationTime: CMClockGetTime(CMClockGetHostTimeClock())
                )
                queueLock.lock()
                seededFrames += 1
                queueLock.unlock()
            }
        }
        startHeartbeatTimer()
    }

    func stop() async throws {
        var firstError: Error?
        do { if let stream { try await stream.stopCapture() } }
        catch { firstError = error }
        self.stream = nil
        heartbeatTimer?.cancel()
        heartbeatTimer = nil
        encodingQueue.sync { emitHeartbeat(force: true) }
        do { try throwTerminalErrorIfNeeded() } catch { firstError = error }
        do { try encoder?.finish() } catch { if firstError == nil { firstError = error } }
        do { try systemAudioWriter?.finishAndWait() } catch { if firstError == nil { firstError = error } }
        encoder = nil
        systemAudioWriter = nil
        store = nil
        clearLastFrame()
        if let firstError { throw firstError }
    }

    private func clearLastFrame() {
        queueLock.lock()
        lastPixelBuffer = nil
        lastSubmittedPresentationTime = nil
        queueLock.unlock()
    }

    private func currentCompleteSampleCount() -> Int {
        queueLock.lock()
        let count = completeSamples
        queueLock.unlock()
        return count
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard sampleBuffer.isValid, CMSampleBufferDataIsReady(sampleBuffer) else { return }
        if outputType == .audio {
            do { try systemAudioWriter?.append(sampleBuffer) }
            catch { recordTerminalError(error) }
            return
        }
        guard outputType == .screen else { return }
        queueLock.lock()
        receivedScreenSamples += 1
        switch frameStatus(sampleBuffer) {
        case .complete, .started: completeSamples += 1
        case .idle: idleSamples += 1
        case .blank: blankSamples += 1
        case .suspended: suspendedSamples += 1
        case .stopped, .none: break
        @unknown default: break
        }
        queueLock.unlock()
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        queueLock.lock()
        pixelBufferSamples += 1
        lastPixelBuffer = pixelBuffer
        pendingFrames.offer(sampleBuffer)
        let shouldSchedule = !drainScheduled
        if shouldSchedule { drainScheduled = true }
        queueLock.unlock()
        if shouldSchedule {
            encodingQueue.async { [weak self] in self?.drainFrames() }
        }
    }

    func pressureSnapshot() -> CapturePressureSnapshot {
        queueLock.lock()
        let received = receivedScreenSamples
        let dropped = pendingFrames.droppedCount
        let complete = completeSamples
        let idle = idleSamples
        let blank = blankSamples
        let suspended = suspendedSamples
        let pixelBuffers = pixelBufferSamples
        queueLock.unlock()
        let counts = encoder?.frameCounts() ?? (submitted: 0, encoded: 0)
        return CapturePressureSnapshot(
            receivedScreenSamples: received,
            submittedVideoFrames: counts.submitted,
            encodedVideoFrames: counts.encoded,
            droppedPendingFrames: dropped,
            pendingEncoderFrames: max(0, counts.submitted - counts.encoded),
            completeSamples: complete,
            idleSamples: idle,
            blankSamples: blank,
            suspendedSamples: suspended,
            pixelBufferSamples: pixelBuffers
        )
    }

    private func frameStatus(_ sampleBuffer: CMSampleBuffer) -> SCFrameStatus? {
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(
            sampleBuffer,
            createIfNecessary: false
        ) as? [[SCStreamFrameInfo: Any]],
        let rawValue = attachments.first?[.status] as? Int else { return nil }
        return SCFrameStatus(rawValue: rawValue)
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
                guard let pixelBuffer = CMSampleBufferGetImageBuffer(frame) else { continue }
                try submit(
                    pixelBuffer,
                    presentationTime: CMSampleBufferGetPresentationTimeStamp(frame),
                    duration: CMSampleBufferGetDuration(frame)
                )
            } catch {
                recordTerminalError(error)
            }
        }
    }

    private func submit(
        _ pixelBuffer: CVPixelBuffer,
        presentationTime: CMTime,
        duration: CMTime = .invalid
    ) throws {
        queueLock.lock()
        let previous = lastSubmittedPresentationTime
        if previous == nil || presentationTime > previous! {
            lastPixelBuffer = pixelBuffer
            lastSubmittedPresentationTime = presentationTime
            queueLock.unlock()
            try encoder?.encode(
                pixelBuffer: pixelBuffer,
                presentationTime: presentationTime,
                duration: duration
            )
        } else {
            queueLock.unlock()
        }
    }

    private func startHeartbeatTimer() {
        let timer = DispatchSource.makeTimerSource(queue: encodingQueue)
        timer.schedule(deadline: .now() + .seconds(1), repeating: .milliseconds(500))
        timer.setEventHandler { [weak self] in self?.emitHeartbeat(force: false) }
        heartbeatTimer = timer
        timer.resume()
    }

    private func emitHeartbeat(force: Bool) {
        queueLock.lock()
        let pixelBuffer = lastPixelBuffer
        let lastPresentationTime = lastSubmittedPresentationTime
        queueLock.unlock()
        guard let pixelBuffer, let lastPresentationTime else { return }
        let now = CMClockGetTime(CMClockGetHostTimeClock())
        let elapsedUs = (now - lastPresentationTime)
            .convertScale(1_000_000, method: .roundTowardZero)
            .value
        guard force || InitialFrameSeedPolicy.shouldEmitHeartbeat(
            elapsedSinceLastFrameUs: elapsedUs
        ) else { return }
        let lastUs = lastPresentationTime
            .convertScale(1_000_000, method: .roundTowardZero)
            .value
        let nowUs = now
            .convertScale(1_000_000, method: .roundTowardZero)
            .value
        let presentationTimes = InitialFrameSeedPolicy.heartbeatPresentationTimes(
            lastFrameUs: lastUs,
            nowUs: nowUs,
            framesPerSecond: requestFramesPerSecond,
            forceFinalFrame: force
        )
        let frameDuration = CMTime(
            value: 1,
            timescale: CMTimeScale(max(1, requestFramesPerSecond))
        )
        do {
            for presentationTimeUs in presentationTimes {
                try submit(
                    pixelBuffer,
                    presentationTime: CMTime(value: presentationTimeUs, timescale: 1_000_000),
                    duration: frameDuration
                )
            }
        } catch {
            recordTerminalError(error)
        }
    }

    private var requestFramesPerSecond = 30

    private func captureInitialPixelBuffer(
        filter: SCContentFilter,
        configuration: SCStreamConfiguration,
        source: CaptureSourceSelection
    ) async throws -> CVPixelBuffer {
        if #available(macOS 14.0, *) {
            do {
                return try await captureScreenshotManagerPixelBuffer(
                    filter: filter,
                    configuration: configuration
                )
            } catch {
                // The legacy one-shot capture below keeps macOS 13 support and
                // also covers transient or non-returning screenshot-manager calls.
            }
        }
        guard let image = legacyInitialImage(source: source) else {
            throw NativeCaptureError.initialFrameCaptureFailed
        }
        return try makePixelBuffer(
            from: image,
            width: configuration.width,
            height: configuration.height
        )
    }

    @available(macOS 14.0, *)
    private func captureScreenshotManagerPixelBuffer(
        filter: SCContentFilter,
        configuration: SCStreamConfiguration
    ) async throws -> CVPixelBuffer {
        let captured = try await withCheckedThrowingContinuation { continuation in
            let gate = InitialFrameContinuationGate(continuation)
            SCScreenshotManager.captureSampleBuffer(
                contentFilter: filter,
                configuration: configuration
            ) { sampleBuffer, error in
                if let pixelBuffer = sampleBuffer.flatMap(CMSampleBufferGetImageBuffer) {
                    gate.resolve(.success(SendablePixelBuffer(value: pixelBuffer)))
                } else {
                    gate.resolve(.failure(error ?? NativeCaptureError.initialFrameCaptureFailed))
                }
            }
            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + .seconds(2)) {
                gate.resolve(.failure(NativeCaptureError.initialFrameCaptureFailed))
            }
        }
        return captured.value
    }

    private func legacyInitialImage(source: CaptureSourceSelection) -> CGImage? {
        switch source {
        case .display(let displayID):
            return CGDisplayCreateImage(CGDirectDisplayID(displayID))
        case .window(let windowID):
            return CGWindowListCreateImage(
                .null,
                .optionIncludingWindow,
                CGWindowID(windowID),
                [.boundsIgnoreFraming, .bestResolution]
            )
        }
    }

    private func makePixelBuffer(from image: CGImage, width: Int, height: Int) throws -> CVPixelBuffer {
        let attributes: [CFString: Any] = [
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true,
            kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary,
        ]
        var created: CVPixelBuffer?
        let status = CVPixelBufferCreate(
            kCFAllocatorDefault,
            width,
            height,
            kCVPixelFormatType_32BGRA,
            attributes as CFDictionary,
            &created
        )
        guard status == kCVReturnSuccess, let pixelBuffer = created else {
            throw NativeCaptureError.initialFramePixelBufferCreateFailed(status)
        }
        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
        guard let context = CGContext(
            data: CVPixelBufferGetBaseAddress(pixelBuffer),
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
                | CGBitmapInfo.byteOrder32Little.rawValue
        ) else {
            throw NativeCaptureError.initialFrameContextCreateFailed
        }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return pixelBuffer
    }

    private func isLikelyProtectedBlackFrame(_ pixelBuffer: CVPixelBuffer) -> Bool {
        guard CVPixelBufferGetPixelFormatType(pixelBuffer) == kCVPixelFormatType_32BGRA else {
            return false
        }
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return false }
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let bytes = baseAddress.assumingMemoryBound(to: UInt8.self)
        let xStep = max(1, width / 8)
        let yStep = max(1, height / 8)
        var samples: [UInt8] = []
        samples.reserveCapacity(8 * 8 * 3)
        for y in stride(from: yStep / 2, to: height, by: yStep) {
            for x in stride(from: xStep / 2, to: width, by: xStep) {
                let offset = y * bytesPerRow + x * 4
                samples.append(bytes[offset])
                samples.append(bytes[offset + 1])
                samples.append(bytes[offset + 2])
            }
        }
        return InitialFrameSeedPolicy.isLikelyProtectedBlackFrame(
            sampledColorComponents: samples
        )
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
