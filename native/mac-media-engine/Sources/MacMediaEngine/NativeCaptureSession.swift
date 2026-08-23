import Foundation
import MacMediaEngineCore
@preconcurrency import CoreMedia

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

    func start(configuration: Configuration) async throws -> CapturePreflightReport {
        let values = try configuration.projectRoot.deletingLastPathComponent()
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        let availableBytes = values.volumeAvailableCapacityForImportantUsage ?? 0
        let report = try CapturePreflight.evaluateSystem(
            requested: configuration.request,
            availableBytes: availableBytes
        )
        let store = try SegmentedRecordingStore(
            root: configuration.projectRoot,
            recordingId: configuration.recordingId
        )
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
            return report
        } catch {
            try? camera?.stop()
            try? microphone?.stop()
            try? await screen.stop()
            throw error
        }
    }

    func stop() async throws {
        var firstError: Error?
        do { try camera?.stop() } catch { firstError = error }
        do { try microphone?.stop() } catch { if firstError == nil { firstError = error } }
        do { try await screen?.stop() } catch { if firstError == nil { firstError = error } }
        if firstError == nil {
            do { try store?.finalize(requiredTracks: [.screen]) }
            catch { firstError = error }
        }
        microphone = nil
        camera = nil
        screen = nil
        store = nil
        if let firstError { throw firstError }
    }

    func pressureSnapshot() -> CapturePressureSnapshot {
        screen?.pressureSnapshot() ?? CapturePressureSnapshot(
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
    }
}
