import Foundation
import MacMediaEngineCore

private enum ContractFailure: Error {
    case expectation(String)
}

private final class ConcurrentErrors: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [Error] = []

    func append(_ error: Error) {
        lock.lock()
        values.append(error)
        lock.unlock()
    }

    var isEmpty: Bool {
        lock.lock()
        let result = values.isEmpty
        lock.unlock()
        return result
    }
}

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw ContractFailure.expectation(message) }
}

@main
struct MacMediaEngineContractTests {
    static func main() async throws {
        let handshake = try HelperHandshake.negotiate(clientProtocolVersion: 1)
        try expect(handshake.protocolVersion == 1, "protocol version")
        try expect(handshake.engine == "mac-media-engine", "engine name")
        try expect(handshake.state == .idle, "initial state")

        do {
            _ = try HelperHandshake.negotiate(clientProtocolVersion: 2)
            throw ContractFailure.expectation("unsupported protocol must fail")
        } catch HelperProtocolError.unsupportedProtocol(2) {
            // expected
        }

        let lifecycle = HelperLifecycle()
        try await lifecycle.start(sessionId: "recording-1")
        let first = await lifecycle.stop()
        let second = await lifecycle.stop()
        let stopCount = await lifecycle.stopCount
        try expect(first == .idle, "first stop")
        try expect(second == .idle, "idempotent stop")
        try expect(stopCount == 1, "single finalize")

        let stoppingLifecycle = HelperLifecycle()
        try await stoppingLifecycle.start(sessionId: "recording-pressure")
        let stoppingState = await stoppingLifecycle.beginStopping()
        let stoppedState = await stoppingLifecycle.finishStopping()
        try expect(stoppingState == .stopping, "safe stop exposes stopping state")
        try expect(stoppedState == .idle, "safe stop returns to idle after flush")

        var queue = LatestFrameQueue<Int>(capacity: 2)
        queue.offer(1)
        queue.offer(2)
        queue.offer(3)
        try expect(queue.count == 2, "bounded frame count")
        try expect(queue.droppedCount == 1, "oldest frame dropped")
        try expect(queue.popOldest() == 2, "kept second frame")
        try expect(queue.popOldest() == 3, "kept latest frame")

        try expect(
            InitialFrameSeedPolicy.shouldSeed(streamCompleteFrames: 0, seededFrames: 0),
            "idle-only ScreenCaptureKit streams require one initial frame"
        )
        try expect(
            !InitialFrameSeedPolicy.shouldSeed(streamCompleteFrames: 1, seededFrames: 0),
            "a real stream frame makes a screenshot seed unnecessary"
        )
        try expect(
            !InitialFrameSeedPolicy.shouldSeed(streamCompleteFrames: 0, seededFrames: 1),
            "the initial frame is seeded at most once"
        )
        try expect(
            InitialFrameSeedPolicy.shouldEmitHeartbeat(
                elapsedSinceLastFrameUs: CaptureEncodingPolicy.segmentDurationUs
            ),
            "static content emits one low-frequency recovery heartbeat"
        )
        try expect(
            !InitialFrameSeedPolicy.shouldEmitHeartbeat(elapsedSinceLastFrameUs: 500_000),
            "active content is not duplicated"
        )
        try expect(
            InitialFrameSeedPolicy.isLikelyProtectedBlackFrame(
                sampledColorComponents: Array(repeating: 0, count: 48)
            ),
            "uniform black fallback frames are treated as protected capture sources"
        )
        try expect(
            !InitialFrameSeedPolicy.isLikelyProtectedBlackFrame(
                sampledColorComponents: [0, 0, 0, 0, 0, 24]
            ),
            "real image detail is accepted"
        )

        let cameraFormat = CameraFormatPolicy.select(
            requestedWidth: 1_280,
            requestedHeight: 720,
            requestedFramesPerSecond: 24,
            candidates: [
                CameraFormatCandidate(id: 0, width: 640, height: 480, minimumFPS: 15, maximumFPS: 30),
                CameraFormatCandidate(id: 1, width: 1_920, height: 1_080, minimumFPS: 24, maximumFPS: 60),
                CameraFormatCandidate(id: 2, width: 1_280, height: 720, minimumFPS: 24, maximumFPS: 30),
            ]
        )
        try expect(cameraFormat?.id == 2, "camera chooses the smallest native format that preserves quality")
        try expect(
            CameraFormatPolicy.select(
                requestedWidth: 1_920,
                requestedHeight: 1_080,
                requestedFramesPerSecond: 60,
                candidates: [
                    CameraFormatCandidate(id: 0, width: 1_280, height: 720, minimumFPS: 24, maximumFPS: 60),
                ]
            ) == nil,
            "camera never silently lowers requested resolution"
        )
        try expect(
            CaptureDiskPressurePolicy.classify(availableBytes: 12 * 1_024 * 1_024 * 1_024) == .normal,
            "healthy disk remains normal"
        )
        try expect(
            CaptureDiskPressurePolicy.classify(availableBytes: 3 * 1_024 * 1_024 * 1_024) == .warning,
            "low disk raises a warning during capture"
        )
        try expect(
            CaptureDiskPressurePolicy.classify(availableBytes: 900 * 1_024 * 1_024) == .critical,
            "critical disk triggers safe interruption"
        )

        let requiredTracks = CaptureTrackRequirementPolicy.requiredTracks(
            capturesCamera: true,
            capturesMicrophone: true
        )
        try expect(requiredTracks == [.screen, .camera, .microphone], "enabled device tracks are required")
        try expect(
            CaptureTrackRequirementPolicy.requiredTracks(
                capturesCamera: false,
                capturesMicrophone: false
            ) == [.screen],
            "disabled device tracks do not become required"
        )
        let readyGate = FirstMediaSampleGate()
        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(10)) {
            readyGate.markReady()
        }
        try expect(
            readyGate.wait(timeout: 1) == .ready,
            "capture start waits until media reaches its processing pipeline"
        )
        let failedGate = FirstMediaSampleGate()
        failedGate.markFailed()
        try expect(failedGate.wait(timeout: 1) == .failed, "startup media failure wakes the waiter")
        let timeoutGate = FirstMediaSampleGate()
        try expect(timeoutGate.wait(timeout: 0.01) == .timedOut, "missing media cannot fake readiness")

        let timeline = RecordingTimeline(originUs: 5_000_000)
        try expect(timeline.relativeUs(for: 5_250_000) == 250_000, "tracks share one relative clock")
        try expect(timeline.relativeUs(for: 4_999_000) == 0, "pre-roll timestamp clamps to zero")

        let temporaryRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("excalicast-contract-\(UUID().uuidString)", isDirectory: true)
        let store = try SegmentedRecordingStore(root: temporaryRoot, recordingId: "recording-1")
        let captureMetadata = RecordingCaptureMetadata(
            screen: CaptureRequest(width: 2_560, height: 1_440, framesPerSecond: 30, codec: .h264),
            camera: CaptureRequest(width: 1_280, height: 720, framesPerSecond: 24, codec: .h264),
            capturesSystemAudio: true,
            capturesMicrophone: true,
            hardwareEncodingConfirmed: true,
            initialAvailableBytes: 100 * 1_024 * 1_024 * 1_024,
            finalPressure: nil
        )
        try store.configureCapture(captureMetadata)
        try store.appendFinalizedSegment(track: .screen, index: 0, data: Data([1, 2, 3]), startUs: 0, durationUs: 2_000_000)
        try store.appendFinalizedSegment(track: .microphone, index: 0, data: Data([4, 5]), startUs: 0, durationUs: 2_000_000)
        let storePressure = store.pressureSnapshot()
        try expect(storePressure.committedBytes == 5, "store pressure accounts for finalized bytes")
        try expect(storePressure.pendingWriteBytes == 0, "synchronous atomic commits leave no hidden queue")
        let recovered = try SegmentedRecordingStore.recover(root: temporaryRoot)
        try expect(recovered.state == .interrupted, "unfinished project recovers as interrupted")
        try expect(recovered.tracks[.screen]?.count == 1, "screen segment recovered")
        try expect(recovered.tracks[.microphone]?.count == 1, "audio segment recovered")
        try expect(recovered.capture?.camera?.width == 1_280, "camera configuration survives recovery")
        try expect(recovered.capture?.capturesSystemAudio == true, "system audio intent survives recovery")

        let orphanStaging = try store.makeStagingSegmentURL(track: .screen, index: 99)
        try Data([9, 9, 9]).write(to: orphanStaging)
        let checkpointedRecovery = try SegmentedRecordingStore.recoverAndCheckpoint(root: temporaryRoot)
        try expect(checkpointedRecovery.state == .interrupted, "recovery state is checkpointed")
        try expect(!FileManager.default.fileExists(atPath: orphanStaging.path), "incomplete staging segment is discarded")
        let checkpointedManifest = try JSONDecoder().decode(
            RecoverableRecordingManifest.self,
            from: Data(contentsOf: temporaryRoot.appendingPathComponent("manifest.json"))
        )
        try expect(checkpointedManifest.state == .interrupted, "interrupted state survives another launch")

        let cameraStaging = try store.makeStagingSegmentURL(track: .camera, index: 0)
        try Data([6, 7, 8, 9]).write(to: cameraStaging)
        try store.commitStagedSegment(
            track: .camera,
            index: 0,
            stagingURL: cameraStaging,
            startUs: 0,
            durationUs: 2_000_000,
            fileExtension: "mp4"
        )
        let recoveredAfterCommit = try SegmentedRecordingStore.recover(root: temporaryRoot)
        try expect(recoveredAfterCommit.tracks[.camera]?.first?.byteLength == 4, "streamed file size checkpointed")
        try expect(!FileManager.default.fileExists(atPath: cameraStaging.path), "staging file atomically promoted")

        let replayRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("excalicast-commit-replay-\(UUID().uuidString)", isDirectory: true)
        let replayStore = try SegmentedRecordingStore(root: replayRoot, recordingId: "commit-replay")
        let replayStaging = try replayStore.makeStagingSegmentURL(track: .screen, index: 0)
        try Data([10, 11, 12, 13]).write(to: replayStaging)
        let replayFinalRelativePath = "segments/screen/000000.mp4"
        let replayFinal = replayRoot.appendingPathComponent(replayFinalRelativePath)
        try FileManager.default.createDirectory(
            at: replayFinal.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try FileManager.default.moveItem(at: replayStaging, to: replayFinal)
        let replayJournalRoot = replayRoot.appendingPathComponent("segments/.commit-journal")
        try FileManager.default.createDirectory(at: replayJournalRoot, withIntermediateDirectories: true)
        let replayRecord = PendingSegmentCommit(
            track: .screen,
            index: 0,
            stagingRelativePath: "segments/.staging/\(replayStaging.lastPathComponent)",
            finalRelativePath: replayFinalRelativePath,
            startUs: 0,
            durationUs: 2_000_000,
            byteLength: 4
        )
        let replayJournal = replayJournalRoot.appendingPathComponent("crash-window.json")
        try JSONEncoder().encode(replayRecord).write(to: replayJournal, options: .atomic)
        let replayedManifest = try SegmentedRecordingStore.recoverAndCheckpoint(root: replayRoot)
        try expect(
            replayedManifest.tracks[.screen]?.first?.relativePath == replayFinalRelativePath,
            "a finalized file is replayed when the process crashes before manifest checkpoint"
        )
        try expect(!FileManager.default.fileExists(atPath: replayJournal.path), "replayed commit journal is removed")

        let prePromotionRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("excalicast-pre-promotion-\(UUID().uuidString)", isDirectory: true)
        let prePromotionStore = try SegmentedRecordingStore(
            root: prePromotionRoot,
            recordingId: "pre-promotion"
        )
        let prePromotionStaging = try prePromotionStore.makeStagingSegmentURL(track: .screen, index: 0)
        try Data([20, 21, 22]).write(to: prePromotionStaging)
        let prePromotionFinalRelativePath = "segments/screen/000000.mp4"
        let prePromotionJournalRoot = prePromotionRoot.appendingPathComponent("segments/.commit-journal")
        try FileManager.default.createDirectory(
            at: prePromotionJournalRoot,
            withIntermediateDirectories: true
        )
        let prePromotionRecord = PendingSegmentCommit(
            track: .screen,
            index: 0,
            stagingRelativePath: "segments/.staging/\(prePromotionStaging.lastPathComponent)",
            finalRelativePath: prePromotionFinalRelativePath,
            startUs: 0,
            durationUs: 2_000_000,
            byteLength: 3
        )
        try JSONEncoder().encode(prePromotionRecord).write(
            to: prePromotionJournalRoot.appendingPathComponent("before-move.json"),
            options: .atomic
        )
        let promotedManifest = try SegmentedRecordingStore.recoverAndCheckpoint(root: prePromotionRoot)
        try expect(
            promotedManifest.tracks[.screen]?.first?.byteLength == 3,
            "a staged file is promoted and replayed when the process crashes before the move"
        )
        try expect(
            FileManager.default.fileExists(
                atPath: prePromotionRoot.appendingPathComponent(prePromotionFinalRelativePath).path
            ),
            "recovery promotes the staged media to its deterministic final path"
        )

        let traversalRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("excalicast-journal-traversal-\(UUID().uuidString)", isDirectory: true)
        _ = try SegmentedRecordingStore(root: traversalRoot, recordingId: "journal-traversal")
        try Data([30, 31]).write(to: traversalRoot.appendingPathComponent("escaped.mp4"))
        let traversalJournalRoot = traversalRoot.appendingPathComponent("segments/.commit-journal")
        try FileManager.default.createDirectory(
            at: traversalJournalRoot,
            withIntermediateDirectories: true
        )
        let traversalRecord = PendingSegmentCommit(
            track: .screen,
            index: 0,
            stagingRelativePath: "segments/.staging/../../escaped.part",
            finalRelativePath: "segments/screen/../../escaped.mp4",
            startUs: 0,
            durationUs: 2_000_000,
            byteLength: 2
        )
        try JSONEncoder().encode(traversalRecord).write(
            to: traversalJournalRoot.appendingPathComponent("traversal.json"),
            options: .atomic
        )
        let traversalManifest = try SegmentedRecordingStore.recoverAndCheckpoint(root: traversalRoot)
        try expect(
            traversalManifest.tracks[.screen, default: []].isEmpty,
            "commit journal paths cannot escape their assigned track directories"
        )

        let concurrentRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("excalicast-concurrent-\(UUID().uuidString)", isDirectory: true)
        let concurrentStore = try SegmentedRecordingStore(root: concurrentRoot, recordingId: "concurrent")
        let concurrentErrors = ConcurrentErrors()
        DispatchQueue.concurrentPerform(iterations: 40) { index in
            do {
                let track: RecordingTrackKind = index.isMultiple(of: 2) ? .screen : .camera
                try concurrentStore.appendFinalizedSegment(
                    track: track,
                    index: index / 2,
                    data: Data(repeating: UInt8(index), count: 32),
                    startUs: Int64(index) * 100_000,
                    durationUs: 100_000
                )
            } catch {
                concurrentErrors.append(error)
            }
        }
        let concurrentManifest = try SegmentedRecordingStore.recover(root: concurrentRoot)
        try expect(concurrentErrors.isEmpty, "parallel track checkpoints do not race")
        try expect(concurrentManifest.tracks[.screen]?.count == 20, "all parallel screen segments survive")
        try expect(concurrentManifest.tracks[.camera]?.count == 20, "all parallel camera segments survive")

        let emptyRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("excalicast-empty-\(UUID().uuidString)", isDirectory: true)
        let emptyStore = try SegmentedRecordingStore(root: emptyRoot, recordingId: "empty")
        do {
            try emptyStore.finalize(requiredTracks: [.screen])
            throw ContractFailure.expectation("empty screen track must not become ready")
        } catch RecordingStoreError.missingRequiredTrack(.screen) {
            // expected
        }
        let missingCameraRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("excalicast-missing-camera-\(UUID().uuidString)", isDirectory: true)
        let missingCameraStore = try SegmentedRecordingStore(
            root: missingCameraRoot,
            recordingId: "missing-camera"
        )
        try missingCameraStore.appendFinalizedSegment(
            track: .screen,
            index: 0,
            data: Data([1]),
            startUs: 0,
            durationUs: 1_000_000
        )
        do {
            try missingCameraStore.finalize(
                requiredTracks: CaptureTrackRequirementPolicy.requiredTracks(
                    capturesCamera: true,
                    capturesMicrophone: false
                )
            )
            throw ContractFailure.expectation("enabled camera without media must not become ready")
        } catch RecordingStoreError.missingRequiredTrack(.camera) {
            // expected
        }
        try? FileManager.default.removeItem(at: emptyRoot)
        try? FileManager.default.removeItem(at: missingCameraRoot)
        try? FileManager.default.removeItem(at: replayRoot)
        try? FileManager.default.removeItem(at: prePromotionRoot)
        try? FileManager.default.removeItem(at: traversalRoot)
        try? FileManager.default.removeItem(at: concurrentRoot)
        try? FileManager.default.removeItem(at: temporaryRoot)

        let h264Preflight = try CapturePreflight.evaluate(
            requested: CaptureRequest(width: 3840, height: 2160, framesPerSecond: 60, codec: .h264),
            hardwareProbe: { codec in codec == .h264 },
            availableBytes: 100 * 1_024 * 1_024 * 1_024
        )
        try expect(h264Preflight.hardwareEncodingConfirmed, "hardware encoder confirmed")
        try expect(h264Preflight.effective == h264Preflight.requested, "quality is not silently reduced")
        try expect(CaptureEncodingPolicy.targetBitRate(for: h264Preflight.requested) >= 48_000_000, "4K60 retains production bitrate")
        let teachingRequest = CaptureRequest(width: 2560, height: 1440, framesPerSecond: 30, codec: .h264)
        try expect(CaptureEncodingPolicy.targetBitRate(for: teachingRequest) >= 12_000_000, "1440p text remains crisp")
        try expect(CaptureEncodingPolicy.frameQueueCapacity == 2, "real-time queue stays bounded")
        let hardwareStatus = CapturePreflight.systemHardwareEncoderStatus(.h264)
        print("VideoToolbox H.264 hardware probe status: \(hardwareStatus)")
        let actualHardwareReport = try CapturePreflight.evaluateSystem(
            requested: teachingRequest,
            availableBytes: 100 * 1_024 * 1_024 * 1_024
        )
        try expect(actualHardwareReport.hardwareEncodingConfirmed, "system hardware preflight succeeds")

        do {
            _ = try CapturePreflight.evaluate(
                requested: CaptureRequest(width: 3840, height: 2160, framesPerSecond: 60, codec: .h264),
                hardwareProbe: { _ in false },
                availableBytes: 100 * 1_024 * 1_024 * 1_024
            )
            throw ContractFailure.expectation("software fallback must not be silent")
        } catch CapturePreflightError.hardwareEncoderUnavailable(.h264) {
            // expected
        }

        print("MacMediaEngine contract tests passed")
    }
}
