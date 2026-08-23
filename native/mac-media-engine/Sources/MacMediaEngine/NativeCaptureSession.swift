import Foundation
import MacMediaEngineCore
@preconcurrency import CoreMedia
@preconcurrency import AVFoundation

@available(macOS 13.0, *)
final class NativeCaptureSession: @unchecked Sendable {
    struct Configuration {
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
    }

    private var store: SegmentedRecordingStore?
    private var screen: ScreenCaptureEngine?
    private var microphone: MicrophoneCaptureEngine?
    private var camera: CameraCaptureEngine?
    private var projectRoot: URL?
    private var lastAvailableDiskBytes: Int64 = 0
    private let pressureLock = NSLock()

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
            finalPressure: nil
        ))
        let hostTime = CMClockGetTime(CMClockGetHostTimeClock())
            .convertScale(1_000_000, method: .roundTowardZero)
            .value
        let timeline = RecordingTimeline(originUs: hostTime)
        let screen = ScreenCaptureEngine()
        let microphone = configuration.captureMicrophone ? MicrophoneCaptureEngine() : nil
        let camera = configuration.captureCamera ? CameraCaptureEngine() : nil
        do {
            try await screen.start(
                source: configuration.source,
                request: configuration.request,
                store: store,
                timeline: timeline,
                captureSystemAudio: configuration.captureSystemAudio
            )
            try microphone?.start(
                deviceID: configuration.microphoneDeviceID,
                store: store,
                timeline: timeline
            )
            try camera?.start(
                deviceID: configuration.cameraDeviceID,
                request: configuration.cameraRequest,
                store: store,
                timeline: timeline
            )
            self.store = store
            self.screen = screen
            self.microphone = microphone
            self.camera = camera
            self.projectRoot = configuration.projectRoot
            self.lastAvailableDiskBytes = availableBytes
            return report
        } catch {
            try? camera?.stop()
            try? microphone?.stop()
            try? await screen.stop()
            try? store.markInterrupted()
            throw error
        }
    }

    func stop(interrupted: Bool = false) async throws {
        let finalMediaPressure = screen?.pressureSnapshot()
        var firstError: Error?
        do { try camera?.stop() } catch { firstError = error }
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
            do { try store?.finalize(requiredTracks: [.screen]) }
            catch { firstError = error }
        }
        if firstError != nil || interrupted { try? store?.markInterrupted() }
        microphone = nil
        camera = nil
        screen = nil
        store = nil
        projectRoot = nil
        if let firstError { throw firstError }
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
}
