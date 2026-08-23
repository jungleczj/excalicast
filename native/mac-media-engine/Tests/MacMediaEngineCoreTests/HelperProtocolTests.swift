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

        let timeline = RecordingTimeline(originUs: 5_000_000)
        try expect(timeline.relativeUs(for: 5_250_000) == 250_000, "tracks share one relative clock")
        try expect(timeline.relativeUs(for: 4_999_000) == 0, "pre-roll timestamp clamps to zero")

        let temporaryRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("excalicast-contract-\(UUID().uuidString)", isDirectory: true)
        let store = try SegmentedRecordingStore(root: temporaryRoot, recordingId: "recording-1")
        try store.appendFinalizedSegment(track: .screen, index: 0, data: Data([1, 2, 3]), startUs: 0, durationUs: 2_000_000)
        try store.appendFinalizedSegment(track: .microphone, index: 0, data: Data([4, 5]), startUs: 0, durationUs: 2_000_000)
        let recovered = try SegmentedRecordingStore.recover(root: temporaryRoot)
        try expect(recovered.state == .interrupted, "unfinished project recovers as interrupted")
        try expect(recovered.tracks[.screen]?.count == 1, "screen segment recovered")
        try expect(recovered.tracks[.microphone]?.count == 1, "audio segment recovered")

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
        try? FileManager.default.removeItem(at: emptyRoot)
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
