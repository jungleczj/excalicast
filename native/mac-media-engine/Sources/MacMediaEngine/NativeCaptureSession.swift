import Foundation
import MacMediaEngineCore
import MacMediaEnginePlatform
@preconcurrency import CoreMedia
@preconcurrency import AVFoundation

@available(macOS 13.0, *)
final class NativeCaptureSession: @unchecked Sendable {
    struct Configuration: Sendable {
        let recordingId: String
        let projectRoot: URL
        let source: CaptureSourceSelection
        let request: CaptureRequest
        let captureSystemAudio: Bool
        let captureMicrophone: Bool
        let microphoneDeviceID: String?
        let captureCamera: Bool
        let cameraDeviceID: String?
        let cameraRequest: CaptureRequest
        let excludedWindowIDs: [UInt32]
    }

    private var store: SegmentedRecordingStore?
    private var screen: ScreenCaptureEngine?
    private var microphone: MicrophoneCaptureEngine?
    private var camera: CameraCaptureEngine?
    private var projectRoot: URL?
    private var timeline: RecordingTimeline?
    private var inputTelemetryCoordinator: InputTelemetryCoordinatorSession?
    private var inputRuntime: NativeInputCaptureRuntime?
    private var requiredTracks: Set<RecordingTrackKind> = [.screen]
    private var lastAvailableDiskBytes: Int64 = 0
    private let pressureLock = NSLock()
    private let controls = CaptureControlState()

    func start(configuration: Configuration) async throws -> CapturePreflightReport {
        if configuration.captureMicrophone,
           AVCaptureDevice.authorizationStatus(for: .audio) != .authorized {
            throw NativeCaptureError.microphonePermissionRequired
        }
        if configuration.captureCamera,
           AVCaptureDevice.authorizationStatus(for: .video) != .authorized {
            throw NativeCaptureError.cameraPermissionRequired
        }
        let values = try configuration.projectRoot.deletingLastPathComponent()
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        let availableBytes = values.volumeAvailableCapacityForImportantUsage ?? 0
        let report = try CapturePreflight.evaluateSystem(
            requested: configuration.request,
            availableBytes: availableBytes
        )
        if configuration.captureCamera {
            _ = try CapturePreflight.evaluateSystem(
                requested: configuration.cameraRequest,
                availableBytes: availableBytes
            )
        }
        let store = try SegmentedRecordingStore(
            root: configuration.projectRoot,
            recordingId: configuration.recordingId
        )
        try store.configureCapture(RecordingCaptureMetadata(
            screen: report.effective,
            camera: configuration.captureCamera ? configuration.cameraRequest : nil,
            capturesSystemAudio: configuration.captureSystemAudio,
            capturesMicrophone: configuration.captureMicrophone,
            hardwareEncodingConfirmed: report.hardwareEncodingConfirmed,
            initialAvailableBytes: availableBytes,
            finalPressure: nil,
            inputTelemetry: NativeInputTelemetryCaptureMetadata(
                requested: true,
                available: false,
                producerSchemaVersion: 1,
                coordinateSpaceVersion: NativeInputTelemetryMapper.coordinateSpaceVersion,
                terminalError: nil,
                capturedEventCount: 0,
                coalescedEventCount: 0,
                droppedEventCount: 0
            )
        ))
        let clock = CoreMediaHostClock()
        let hostTime = clock.nowUs()
        let timeline = RecordingTimeline(originUs: hostTime)
        let inputTelemetryCoordinator = InputTelemetryCoordinatorSession(
            coordinator: InputTelemetryCoordinator(sessionId: configuration.recordingId)
        )
        let inputSink = NativeInputTelemetryCoordinatorSink(
            sessionId: configuration.recordingId,
            producerEpoch: UUID().uuidString,
            controls: controls,
            timeline: timeline,
            coordinatorSession: inputTelemetryCoordinator
        ) { index, startUs, durationUs, data in
            try store.appendInputTelemetryBatch(
                batchIndex: index,
                data: data,
                startUs: startUs,
                durationUs: durationUs
            )
        }
        let inputRuntime = NativeInputCaptureRuntime(
            source: MacNativeInputEventSource(backend: MacCGEventTapBackend(), clock: clock),
            displays: MacDisplayGeometryProvider(),
            windows: MacActiveWindowProvider(),
            clock: clock,
            controls: controls,
            sink: inputSink,
            excludedWindowIDs: Set(configuration.excludedWindowIDs)
        ) { _, metadata in
            try? store.updateInputTelemetry(metadata)
            try? store.markInterrupted()
        }
        let screen = ScreenCaptureEngine()
        let microphone = configuration.captureMicrophone ? MicrophoneCaptureEngine() : nil
        let camera = configuration.captureCamera ? CameraCaptureEngine() : nil
        do {
            try await NativeInputSessionStartup.start(
                startMedia: {
                    try await screen.start(
                        source: configuration.source,
                        request: configuration.request,
                        store: store,
                        timeline: timeline,
                        captureSystemAudio: configuration.captureSystemAudio,
                        controls: self.controls,
                        excludedWindowIDs: configuration.excludedWindowIDs
                    )
                    try microphone?.start(
                        deviceID: configuration.microphoneDeviceID,
                        store: store,
                        timeline: timeline,
                        controls: self.controls
                    )
                    try camera?.start(
                        deviceID: configuration.cameraDeviceID,
                        request: configuration.cameraRequest,
                        store: store,
                        timeline: timeline,
                        controls: self.controls
                    )
                },
                startInput: {
                    try inputRuntime.start()
                    do { try store.updateInputTelemetry(inputRuntime.captureMetadata) }
                    catch { throw MacNativeInputError.inputTelemetryWriteFailed }
                },
                stopInput: { try? inputRuntime.stop() },
                stopMedia: {
                    try? camera?.stop()
                    try? microphone?.stop()
                    try? await screen.stop()
                },
                markInterrupted: {
                    let error = inputRuntime.terminalFailure
                    try? store.updateInputTelemetry(NativeInputTelemetryCaptureMetadata(
                        requested: true,
                        available: false,
                        producerSchemaVersion: 1,
                        coordinateSpaceVersion: NativeInputTelemetryMapper.coordinateSpaceVersion,
                        terminalError: error?.rawValue,
                        capturedEventCount: inputRuntime.captureMetadata.capturedEventCount,
                        coalescedEventCount: inputRuntime.captureMetadata.coalescedEventCount,
                        droppedEventCount: inputRuntime.captureMetadata.droppedEventCount
                    ))
                    try? store.markInterrupted()
                }
            )
            self.store = store
            self.screen = screen
            self.microphone = microphone
            self.camera = camera
            self.projectRoot = configuration.projectRoot
            self.timeline = timeline
            self.inputTelemetryCoordinator = inputTelemetryCoordinator
            self.inputRuntime = inputRuntime
            self.requiredTracks = CaptureTrackRequirementPolicy.requiredTracks(
                capturesCamera: configuration.captureCamera,
                capturesMicrophone: configuration.captureMicrophone
            )
            self.lastAvailableDiskBytes = availableBytes
            return report
        } catch {
            if let nativeInputError = error as? MacNativeInputError {
                try? store.updateInputTelemetry(NativeInputTelemetryCaptureMetadata(
                    requested: true,
                    available: false,
                    producerSchemaVersion: 1,
                    coordinateSpaceVersion: NativeInputTelemetryMapper.coordinateSpaceVersion,
                    terminalError: nativeInputError.rawValue,
                    capturedEventCount: inputRuntime.captureMetadata.capturedEventCount,
                    coalescedEventCount: inputRuntime.captureMetadata.coalescedEventCount,
                    droppedEventCount: inputRuntime.captureMetadata.droppedEventCount
                ))
            }
            throw error
        }
    }

    func pause() throws {
        try inputRuntime?.pause()
    }

    func resume() throws {
        try inputRuntime?.resume()
    }

    func setMicrophoneMuted(_ muted: Bool) throws {
        guard microphone != nil else { throw NativeCaptureError.controlTrackUnavailable(.microphone) }
        controls.setMicrophoneMuted(muted)
    }

    func setSystemAudioMuted(_ muted: Bool) throws {
        guard screen?.hasSystemAudio == true else { throw NativeCaptureError.controlTrackUnavailable(.systemAudio) }
        controls.setSystemAudioMuted(muted)
    }

    func setCameraHidden(_ hidden: Bool) throws {
        guard camera != nil else { throw NativeCaptureError.controlTrackUnavailable(.camera) }
        controls.setCameraHidden(hidden)
    }

    func setCameraHardwareEnabled(_ enabled: Bool) throws -> CaptureControlSnapshot {
        guard let camera else { throw NativeCaptureError.controlTrackUnavailable(.camera) }
        try camera.setHardwareEnabled(enabled)
        controls.setCameraHardwareEnabled(enabled)
        return controls.snapshot()
    }

    func stop(interrupted: Bool = false) async throws {
        let finalMediaPressure = screen?.pressureSnapshot()
        var firstError: Error?
        do { try inputRuntime?.stop() } catch { firstError = error }
        if let inputRuntime, let store {
            do { try store.updateInputTelemetry(inputRuntime.captureMetadata) }
            catch { if firstError == nil { firstError = MacNativeInputError.inputTelemetryWriteFailed } }
        }
        do { try camera?.stop() } catch { if firstError == nil { firstError = error } }
        do { try microphone?.stop() } catch { if firstError == nil { firstError = error } }
        do { try await screen?.stop() } catch { if firstError == nil { firstError = error } }
        if let finalMediaPressure, let store {
            let finalPressure = finalMediaPressure.enriched(
                availableDiskBytes: currentAvailableDiskBytes(),
                store: store.pressureSnapshot()
            )
            try? store.updateFinalPressure(finalPressure)
        }
        if firstError == nil, !interrupted {
            do { try store?.finalize(requiredTracks: requiredTracks) }
            catch { firstError = error }
        }
        if firstError != nil || interrupted { try? store?.markInterrupted() }
        microphone = nil
        camera = nil
        screen = nil
        store = nil
        projectRoot = nil
        timeline = nil
        inputTelemetryCoordinator = nil
        inputRuntime = nil
        requiredTracks = [.screen]
        if let firstError { throw firstError }
    }

    func appendInkEvents(
        index: Int,
        startUs: Int64,
        durationUs: Int64,
        payload: String
    ) throws {
        guard let store,
              index >= 0,
              startUs >= 0,
              durationUs > 0,
              let data = payload.data(using: .utf8),
              !data.isEmpty,
              data.count <= 16 * 1_024 * 1_024 else {
            throw RecordingStoreError.invalidSegmentMetadata
        }
        try store.appendFinalizedSegment(
            track: .excalidrawEvents,
            index: index,
            data: data,
            startUs: startUs,
            durationUs: durationUs
        )
    }

    func appendInputTelemetry(payload: String) throws -> InputTelemetryAcknowledgement {
        guard let store, let timeline, let inputTelemetryCoordinator,
              let data = payload.data(using: .utf8) else {
            throw RecordingStoreError.invalidSegmentMetadata
        }
        guard let adjustedHostUs = controls.adjustedPresentationUs(currentHostTimeUs()) else {
            return try inputTelemetryCoordinator.acknowledgeDropped(payload: data)
        }
        let projectAtUs = timeline.relativeUs(for: adjustedHostUs)
        return try inputTelemetryCoordinator.append(
            payload: data,
            projectAtUs: projectAtUs
        ) { index, startUs, durationUs, authoritativePayload in
            try store.appendInputTelemetryBatch(
                batchIndex: index,
                data: authoritativePayload,
                startUs: startUs,
                durationUs: durationUs
            )
        }
    }

    func pressureSnapshot() -> CapturePressureSnapshot {
        let media = screen?.pressureSnapshot() ?? CapturePressureSnapshot(
            receivedScreenSamples: 0,
            submittedVideoFrames: 0,
            encodedVideoFrames: 0,
            droppedPendingFrames: 0,
            pendingEncoderFrames: 0,
            completeSamples: 0,
            idleSamples: 0,
            blankSamples: 0,
            suspendedSamples: 0,
            pixelBufferSamples: 0
        )
        guard let store else { return media }
        let availableBytes = currentAvailableDiskBytes()
        return media.enriched(
            availableDiskBytes: availableBytes,
            store: store.pressureSnapshot()
        )
    }

    func inputTerminalFailure() -> MacNativeInputError? {
        inputRuntime?.terminalFailure
    }

    private func currentAvailableDiskBytes() -> Int64 {
        let latest: Int64?
        if let projectRoot {
            latest = try? projectRoot.resourceValues(
                forKeys: [.volumeAvailableCapacityForImportantUsageKey]
            ).volumeAvailableCapacityForImportantUsage
        } else {
            latest = nil
        }
        pressureLock.lock()
        if let latest { lastAvailableDiskBytes = latest }
        let value = lastAvailableDiskBytes
        pressureLock.unlock()
        return value
    }

    private func currentHostTimeUs() -> Int64 {
        CMClockGetTime(CMClockGetHostTimeClock())
            .convertScale(1_000_000, method: .roundTowardZero)
            .value
    }
}
