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

        var admission = HelperCaptureCommandAdmission()
        try admission.beginStart()
        do {
            try admission.beginStop()
            throw ContractFailure.expectation("capture stop interleaved with unfinished capture start")
        } catch HelperCaptureCommandAdmissionError.startInProgress {
            // expected: the in-flight start must settle before stop can release render reservations
        }
        admission.startFailed()
        try admission.beginStart()
        admission.startSucceeded()
        try admission.beginStop()
        admission.stopFinished()
        try expect(admission.state == .idle, "capture admission returns to idle after a complete stop")

        let controls = CaptureControlState()
        try expect(controls.pause(atUs: 2_000_000), "first pause changes state")
        try expect(controls.adjustedPresentationUs(2_500_000) == nil, "paused samples are dropped")
        try expect(controls.resume(atUs: 5_000_000), "resume changes state")
        try expect(
            controls.adjustedPresentationUs(6_000_000) == 3_000_000,
            "paused wall time is removed from the project clock"
        )
        controls.setMicrophoneMuted(true)
        controls.setSystemAudioMuted(true)
        controls.setCameraHidden(true)
        controls.setCameraHardwareEnabled(false)
        let controlSnapshot = controls.snapshot()
        try expect(controlSnapshot.microphoneMuted, "microphone mute is explicit")
        try expect(controlSnapshot.systemAudioMuted, "system audio mute is explicit")
        try expect(controlSnapshot.cameraHidden, "camera visibility is independent")
        try expect(
            controlSnapshot.cameraHardwareState == .off && !controlSnapshot.cameraPhysicallyPowered,
            "hardware-off state never claims the camera remains powered"
        )

        var queue = LatestFrameQueue<Int>(capacity: 2)
        queue.offer(1)
        queue.offer(2)
        queue.offer(3)
        try expect(queue.count == 2, "bounded frame count")
        try expect(queue.droppedCount == 1, "oldest frame dropped")
        try expect(queue.popOldest() == 2, "kept second frame")
        try expect(queue.popOldest() == 3, "kept latest frame")

        try expect(
            CaptureWindowExclusionPolicy.normalized([9002, 9001, 9002, 0]) == [9002, 9001],
            "overlay exclusions are stable, unique and omit the invalid zero window"
        )
        try expect(
            CaptureWindowExclusionPolicy.matchingWindowIDs(
                requested: [9002, 9999, 9001],
                available: [9001, 9002, 9003]
            ) == [9002, 9001],
            "capture excludes only requested windows that remain shareable"
        )

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
            InitialFrameSeedPolicy.heartbeatPresentationTimes(
                lastFrameUs: 1_000_000,
                nowUs: 3_532_000,
                framesPerSecond: 30,
                forceFinalFrame: false
            ) == [2_966_667, 3_000_000],
            "timer jitter does not become a gap in the static video timeline"
        )
        try expect(
            InitialFrameSeedPolicy.heartbeatPresentationTimes(
                lastFrameUs: 1_000_000,
                nowUs: 3_532_000,
                framesPerSecond: 30,
                forceFinalFrame: true
            ) == [2_966_667, 3_000_000, 3_532_000],
            "stop extends the final static segment to the real stop time"
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

        let screenSegments = [
            FinalizedSegment(index: 0, relativePath: "segments/screen/000000.mp4", startUs: 0, durationUs: 2_000_000, byteLength: 100),
            FinalizedSegment(index: 1, relativePath: "segments/screen/000001.mp4", startUs: 2_033_333, durationUs: 1_966_667, byteLength: 100),
        ]
        let cameraSegments = [
            FinalizedSegment(index: 0, relativePath: "segments/camera/000000.mp4", startUs: 80_000, durationUs: 3_900_000, byteLength: 80),
        ]
        let microphoneSegments = [
            FinalizedSegment(index: 0, relativePath: "segments/microphone/000000.m4a", startUs: 20_000, durationUs: 3_970_000, byteLength: 40),
        ]
        let continuityMetadata = RecordingCaptureMetadata(
            screen: CaptureRequest(width: 2_560, height: 1_440, framesPerSecond: 30, codec: .h264),
            camera: CaptureRequest(width: 1_280, height: 720, framesPerSecond: 24, codec: .h264),
            capturesSystemAudio: true,
            capturesMicrophone: true,
            hardwareEncodingConfirmed: true,
            initialAvailableBytes: 100 * 1_024 * 1_024 * 1_024,
            finalPressure: nil
        )
        let continuousManifest = RecoverableRecordingManifest(
            schemaVersion: 1,
            recordingId: "continuous",
            state: .ready,
            tracks: [
                .screen: screenSegments,
                .camera: cameraSegments,
                .microphone: microphoneSegments,
            ],
            capture: continuityMetadata
        )
        let continuity = RecordingContinuityValidator.validate(continuousManifest)
        try expect(continuity.isValid, "normal frame and audio packet spacing is continuous")
        try expect(continuity.requiredTracks == [.screen, .camera, .microphone], "capture intent drives validation")

        let gappedManifest = RecoverableRecordingManifest(
            schemaVersion: 1,
            recordingId: "gapped",
            state: .ready,
            tracks: [
                .screen: [
                    screenSegments[0],
                    FinalizedSegment(
                        index: 1,
                        relativePath: "segments/screen/000001.mp4",
                        startUs: 2_800_000,
                        durationUs: 1_200_000,
                        byteLength: 100
                    ),
                ],
                .camera: cameraSegments,
                .microphone: microphoneSegments,
            ],
            capture: continuityMetadata
        )
        let gapReport = RecordingContinuityValidator.validate(gappedManifest)
        try expect(!gapReport.isValid, "a visible screen timeline gap fails validation")
        try expect(
            gapReport.tracks[.screen]?.issues.contains(where: { $0.code == .gap }) == true,
            "continuity report identifies the affected screen gap"
        )

        let sparseInkManifest = RecoverableRecordingManifest(
            schemaVersion: 1,
            recordingId: "sparse-ink",
            state: .ready,
            tracks: [
                .screen: screenSegments,
                .camera: cameraSegments,
                .microphone: microphoneSegments,
                .excalidrawEvents: [
                    FinalizedSegment(index: 0, relativePath: "segments/excalidraw-events/000000.segment", startUs: 100_000, durationUs: 1, byteLength: 40),
                    FinalizedSegment(index: 1, relativePath: "segments/excalidraw-events/000001.segment", startUs: 10_000_000, durationUs: 1, byteLength: 50),
                ],
            ],
            capture: continuityMetadata
        )
        let sparseInkReport = RecordingContinuityValidator.validate(sparseInkManifest)
        try expect(
            sparseInkReport.tracks[.excalidrawEvents]?.issues.isEmpty == true,
            "sparse event tracks do not invent media continuity gaps"
        )

        var missingCameraManifest = continuousManifest
        missingCameraManifest.tracks[.camera] = []
        let missingCameraReport = RecordingContinuityValidator.validate(missingCameraManifest)
        try expect(!missingCameraReport.isValid, "enabled camera without media fails continuity validation")
        try expect(
            missingCameraReport.tracks[.camera]?.issues.contains(where: { $0.code == .missingRequiredTrack }) == true,
            "continuity report identifies a missing enabled camera track"
        )

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
        let inkPayload = Data(#"{"schemaVersion":1,"events":[{"kind":"pointer"}]}"#.utf8)
        try store.appendFinalizedSegment(
            track: .excalidrawEvents,
            index: 0,
            data: inkPayload,
            startUs: 250_000,
            durationUs: 120_000
        )
        let telemetryCoordinator = InputTelemetryCoordinator(sessionId: "recording-1")
        var telemetryCommittedBytes = 0
        var telemetryPersistCount = 0
        func persistTelemetry(_ index: Int, _ startUs: Int64, _ durationUs: Int64, _ data: Data) throws {
            telemetryPersistCount += 1
            telemetryCommittedBytes += data.count
            try store.appendFinalizedSegment(
                track: .inputTelemetry,
                index: index,
                data: data,
                startUs: startUs,
                durationUs: durationUs
            )
        }
        let producerA = Data(#"{"schemaVersion":1,"events":[{"schemaVersion":1,"sessionId":"recording-1","producerId":"main-whiteboard","producerEpoch":"main-a","producerSequence":0,"surfaceId":"whiteboard","kind":"cursor","payload":{"x":1,"y":2}},{"schemaVersion":1,"sessionId":"recording-1","producerId":"main-whiteboard","producerEpoch":"main-a","producerSequence":1,"surfaceId":"whiteboard","kind":"click","payload":{"x":1,"y":2,"button":"primary","phase":"down"}}]}"#.utf8)
        let producerB = Data(#"{"schemaVersion":1,"events":[{"schemaVersion":1,"sessionId":"recording-1","producerId":"desktop-ink","producerEpoch":"ink-a","producerSequence":0,"surfaceId":"overlay","kind":"ink","payload":{"operation":"stroke","payload":{"points":[[1,2]]}}}]}"#.utf8)
        let firstAck = try telemetryCoordinator.append(
            payload: producerA,
            projectAtUs: 300_000,
            persist: persistTelemetry
        )
        let secondAck = try telemetryCoordinator.append(
            payload: producerB,
            projectAtUs: 300_000,
            persist: persistTelemetry
        )
        try expect(firstAck.segmentIndex == 0, "first producer owns native segment zero")
        try expect(secondAck.segmentIndex == 1, "second producer may independently begin at sequence zero")
        let retryAck = try telemetryCoordinator.append(
            payload: producerA,
            projectAtUs: 900_000,
            persist: persistTelemetry
        )
        try expect(retryAck.duplicate && telemetryPersistCount == 2, "durable ack retry never duplicates a segment")

        let pausedControls = CaptureControlState()
        _ = pausedControls.pause(atUs: 1_000_000)
        try expect(pausedControls.adjustedPresentationUs(1_100_000) == nil, "pause does not advance project time")
        let pausedPayload = Data(#"{"schemaVersion":1,"events":[{"schemaVersion":1,"sessionId":"recording-1","producerId":"desktop-ink","producerEpoch":"ink-a","producerSequence":1,"surfaceId":"overlay","kind":"cursor","payload":{"x":3,"y":4}}]}"#.utf8)
        let droppedAck = try telemetryCoordinator.acknowledgeDropped(payload: pausedPayload)
        try expect(droppedAck.dropped && telemetryPersistCount == 2, "paused producer events are acknowledged without persistence")
        _ = pausedControls.resume(atUs: 2_000_000)
        let resumedPayload = Data(#"{"schemaVersion":1,"events":[{"schemaVersion":1,"sessionId":"recording-1","producerId":"desktop-ink","producerEpoch":"ink-a","producerSequence":2,"surfaceId":"overlay","kind":"cursor","payload":{"x":5,"y":6}}]}"#.utf8)
        _ = try telemetryCoordinator.append(
            payload: resumedPayload,
            projectAtUs: 400_000,
            persist: persistTelemetry
        )
        let restartedEpoch = Data(#"{"schemaVersion":1,"events":[{"schemaVersion":1,"sessionId":"recording-1","producerId":"main-whiteboard","producerEpoch":"main-b","producerSequence":0,"surfaceId":"whiteboard","kind":"mode-change","payload":{"mode":"whiteboard"}}]}"#.utf8)
        _ = try telemetryCoordinator.append(
            payload: restartedEpoch,
            projectAtUs: 400_000,
            persist: persistTelemetry
        )
        try expect(telemetryPersistCount == 4, "resume and a restarted producer epoch persist exactly once")

        let boundedEpochs = InputTelemetryCoordinator(sessionId: "recording-1")
        for epoch in 0..<64 {
            let payload = Data("{\"schemaVersion\":1,\"events\":[{\"schemaVersion\":1,\"sessionId\":\"recording-1\",\"producerId\":\"main-whiteboard\",\"producerEpoch\":\"epoch-\(epoch)\",\"producerSequence\":0,\"surfaceId\":\"whiteboard\",\"kind\":\"cursor\",\"payload\":{\"x\":1,\"y\":2}}]}".utf8)
            _ = try boundedEpochs.append(payload: payload, projectAtUs: Int64(epoch)) { _, _, _, _ in }
        }
        let overflowEpoch = Data(#"{"schemaVersion":1,"events":[{"schemaVersion":1,"sessionId":"recording-1","producerId":"main-whiteboard","producerEpoch":"epoch-overflow","producerSequence":0,"surfaceId":"whiteboard","kind":"cursor","payload":{"x":1,"y":2}}]}"#.utf8)
        do {
            _ = try boundedEpochs.append(payload: overflowEpoch, projectAtUs: 100) { _, _, _, _ in }
            throw ContractFailure.expectation("producer epoch state must stay bounded")
        } catch InputTelemetryBatchError.tooManyProducerEpochs {
            // expected
        }
        let storePressure = store.pressureSnapshot()
        try expect(
            storePressure.committedBytes == 5 + inkPayload.count + telemetryCommittedBytes,
            "store pressure accounts for media and both event tracks"
        )
        try expect(storePressure.pendingWriteBytes == 0, "synchronous atomic commits leave no hidden queue")
        let recovered = try SegmentedRecordingStore.recover(root: temporaryRoot)
        try expect(recovered.state == .interrupted, "unfinished project recovers as interrupted")
        try expect(recovered.tracks[.screen]?.count == 1, "screen segment recovered")
        try expect(recovered.tracks[.microphone]?.count == 1, "audio segment recovered")
        try expect(recovered.tracks[.excalidrawEvents]?.count == 1, "Excalidraw event segment recovered")
        try expect(
            recovered.tracks[.inputTelemetry]?.first?.relativePath == "segments/input-telemetry/000000.segment",
            "input telemetry stays in its manifest-owned track directory"
        )
        let escapingTelemetry = Data(#"{"schemaVersion":1,"events":[{"schemaVersion":1,"sessionId":"recording-1","producerId":"main-whiteboard","producerEpoch":"main-c","producerSequence":0,"surfaceId":"whiteboard","kind":"ink","payload":{"operation":"stroke","payload":{"relativePath":"../../outside"}}}]}"#.utf8)
        do {
            _ = try telemetryCoordinator.append(
                payload: escapingTelemetry,
                projectAtUs: 500_000,
                persist: persistTelemetry
            )
            throw ContractFailure.expectation("telemetry payload paths must be rejected")
        } catch InputTelemetryBatchError.invalidEnvelope {
            // expected
        }
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

        let longTelemetryRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("excalicast-telemetry-60m-\(UUID().uuidString)", isDirectory: true)
        let longTelemetryStore = try SegmentedRecordingStore(
            root: longTelemetryRoot,
            recordingId: "telemetry-60m"
        )
        try longTelemetryStore.appendFinalizedSegment(
            track: .screen,
            index: 0,
            data: Data([1]),
            startUs: 0,
            durationUs: 3_600_000_000
        )
        for batchIndex in 0..<36_000 {
            let startUs = Int64(batchIndex) * 100_000
            let payload = Data(
                "{\"schemaVersion\":1,\"sessionId\":\"telemetry-60m\",\"index\":\(batchIndex),\"startUs\":\(startUs),\"endUs\":\(startUs + 99_999),\"events\":[{}]}".utf8
            )
            try longTelemetryStore.appendInputTelemetryBatch(
                batchIndex: batchIndex,
                data: payload,
                startUs: startUs,
                durationUs: 100_000
            )
        }
        try longTelemetryStore.finalize(requiredTracks: [.screen])
        let telemetryPersistence = longTelemetryStore.inputTelemetryPersistenceSnapshot()
        let longTelemetryManifestURL = longTelemetryRoot.appendingPathComponent("manifest.json")
        let longTelemetryManifestBytes = try Data(contentsOf: longTelemetryManifestURL)
        let recoveredLongTelemetry = try SegmentedRecordingStore.recover(root: longTelemetryRoot)
        let recoveredTelemetryChunks = recoveredLongTelemetry.tracks[.inputTelemetry] ?? []
        try expect(recoveredLongTelemetry.state == .ready, "60 minute telemetry project remains recoverable after stop")
        try expect(recoveredTelemetryChunks.count <= 1_800, "100 ms batches are coalesced into bounded two-second chunks")
        try expect(longTelemetryManifestBytes.count < 1_024 * 1_024, "60 minute telemetry manifest stays below a fixed 1 MiB budget")
        try expect(telemetryPersistence.batchCount == 36_000, "all 60 minute telemetry batches are appended")
        try expect(telemetryPersistence.chunkCount == recoveredTelemetryChunks.count, "checkpoint index contains exactly the sealed chunks")
        try expect(telemetryPersistence.manifestCheckpointCount <= 32, "manifest checkpoints stay bounded instead of following batch count")
        try expect(
            telemetryPersistence.manifestCheckpointBytes <= telemetryPersistence.telemetryBytes * 2,
            "manifest checkpoint write amplification remains linear and below telemetry payload volume"
        )

        func telemetryBatchLine(index: Int, startUs: Int64) -> Data {
            Data(
                "{\"schemaVersion\":1,\"sessionId\":\"recovery\",\"index\":\(index),\"startUs\":\(startUs),\"endUs\":\(startUs),\"events\":[{}]}".utf8
            )
        }
        func unlistedTelemetryRoot(_ suffix: String) throws -> (URL, URL) {
            let root = FileManager.default.temporaryDirectory
                .appendingPathComponent("excalicast-telemetry-recovery-\(suffix)-\(UUID().uuidString)", isDirectory: true)
            _ = try SegmentedRecordingStore(root: root, recordingId: "recovery")
            let directory = root.appendingPathComponent("segments/input-telemetry", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            return (root, directory.appendingPathComponent("000000.segment"))
        }
        func listedTelemetryRoot(_ suffix: String) throws -> (URL, URL) {
            let root = FileManager.default.temporaryDirectory
                .appendingPathComponent("excalicast-listed-telemetry-\(suffix)-\(UUID().uuidString)", isDirectory: true)
            let store = try SegmentedRecordingStore(root: root, recordingId: "recovery")
            let line = telemetryBatchLine(index: 0, startUs: 1_000)
            try store.appendInputTelemetryBatch(
                batchIndex: 0,
                data: line,
                startUs: 1_000,
                durationUs: 1
            )
            try store.markInterrupted()
            return (
                root,
                root.appendingPathComponent("segments/input-telemetry/000000.segment")
            )
        }

        let (partialTailRoot, partialTailURL) = try unlistedTelemetryRoot("partial-tail")
        let completeRecoveryLine = telemetryBatchLine(index: 0, startUs: 1_000)
        var partialTailBytes = completeRecoveryLine
        partialTailBytes.append(0x0a)
        partialTailBytes.append(Data("{\"schemaVersion\":".utf8))
        try partialTailBytes.write(to: partialTailURL)
        let partialTailRecovery = try SegmentedRecordingStore.recoverAndCheckpoint(root: partialTailRoot)
        try expect(
            partialTailRecovery.tracks[.inputTelemetry]?.first?.byteLength == completeRecoveryLine.count + 1,
            "recovery truncates an incomplete JSONL tail to the last durable newline"
        )
        let recoveredPartialTailBytes = try Data(contentsOf: partialTailURL)
        try expect(
            recoveredPartialTailBytes.count == completeRecoveryLine.count + 1,
            "recovered telemetry byteLength matches the fsynced truncated file"
        )

        let (corruptMiddleRoot, corruptMiddleURL) = try unlistedTelemetryRoot("corrupt-middle")
        var corruptMiddleBytes = telemetryBatchLine(index: 0, startUs: 1_000)
        corruptMiddleBytes.append(0x0a)
        corruptMiddleBytes.append(Data("not-json\n".utf8))
        corruptMiddleBytes.append(telemetryBatchLine(index: 1, startUs: 2_000))
        corruptMiddleBytes.append(0x0a)
        try corruptMiddleBytes.write(to: corruptMiddleURL)
        let corruptMiddleRecovery = try SegmentedRecordingStore.recover(root: corruptMiddleRoot)
        try expect(
            corruptMiddleRecovery.state == .interrupted
                && corruptMiddleRecovery.tracks[.inputTelemetry]?.isEmpty == true,
            "a corrupt complete line is never published as a recoverable telemetry chunk"
        )

        let (indexGapRoot, indexGapURL) = try unlistedTelemetryRoot("index-gap")
        var indexGapBytes = telemetryBatchLine(index: 0, startUs: 1_000)
        indexGapBytes.append(0x0a)
        indexGapBytes.append(telemetryBatchLine(index: 2, startUs: 2_000))
        indexGapBytes.append(0x0a)
        try indexGapBytes.write(to: indexGapURL)
        let indexGapRecovery = try SegmentedRecordingStore.recover(root: indexGapRoot)
        try expect(
            indexGapRecovery.tracks[.inputTelemetry]?.isEmpty == true,
            "batch index gaps are rejected during telemetry recovery"
        )

        let (duplicateIndexRoot, duplicateIndexURL) = try unlistedTelemetryRoot("duplicate-index")
        var duplicateIndexBytes = telemetryBatchLine(index: 0, startUs: 1_000)
        duplicateIndexBytes.append(0x0a)
        duplicateIndexBytes.append(telemetryBatchLine(index: 0, startUs: 2_000))
        duplicateIndexBytes.append(0x0a)
        try duplicateIndexBytes.write(to: duplicateIndexURL)
        let duplicateIndexRecovery = try SegmentedRecordingStore.recover(root: duplicateIndexRoot)
        try expect(
            duplicateIndexRecovery.tracks[.inputTelemetry]?.isEmpty == true,
            "duplicate batch indices are rejected during telemetry recovery"
        )

        let (nearLimitRoot, nearLimitURL) = try unlistedTelemetryRoot("near-limit")
        let nearLimitPadding = String(
            repeating: "x",
            count: SegmentedRecordingStore.inputTelemetryChunkMaximumBytes - 512
        )
        var nearLimitBytes = Data(
            "{\"schemaVersion\":1,\"sessionId\":\"recovery\",\"index\":0,\"startUs\":1000,\"endUs\":1000,\"events\":[{\"payload\":{\"padding\":\"\(nearLimitPadding)\"}}]}".utf8
        )
        nearLimitBytes.append(0x0a)
        try expect(
            nearLimitBytes.count <= SegmentedRecordingStore.inputTelemetryChunkMaximumBytes,
            "near-limit fixture stays within the production chunk boundary"
        )
        try nearLimitBytes.write(to: nearLimitURL)
        let nearLimitRecovery = try SegmentedRecordingStore.recover(root: nearLimitRoot)
        try expect(
            nearLimitRecovery.tracks[.inputTelemetry]?.first?.byteLength == nearLimitBytes.count,
            "a valid telemetry chunk near the 2 MiB write boundary remains recoverable"
        )

        let (oversizedTelemetryRoot, oversizedTelemetryURL) = try unlistedTelemetryRoot("oversized")
        try Data(
            repeating: 0x61,
            count: SegmentedRecordingStore.inputTelemetryChunkMaximumBytes + 1
        ).write(to: oversizedTelemetryURL)
        let oversizedTelemetryRecovery = try SegmentedRecordingStore.recover(root: oversizedTelemetryRoot)
        try expect(
            oversizedTelemetryRecovery.tracks[.inputTelemetry]?.isEmpty == true,
            "recovery rejects telemetry files beyond the exact production chunk boundary"
        )

        let (symlinkTelemetryRoot, symlinkTelemetryURL) = try unlistedTelemetryRoot("symlink")
        let externalTelemetry = FileManager.default.temporaryDirectory
            .appendingPathComponent("excalicast-external-telemetry-\(UUID().uuidString)")
        var externalBytes = telemetryBatchLine(index: 0, startUs: 1_000)
        externalBytes.append(0x0a)
        try externalBytes.write(to: externalTelemetry)
        try FileManager.default.createSymbolicLink(at: symlinkTelemetryURL, withDestinationURL: externalTelemetry)
        let symlinkTelemetryRecovery = try SegmentedRecordingStore.recover(root: symlinkTelemetryRoot)
        try expect(
            symlinkTelemetryRecovery.tracks[.inputTelemetry]?.isEmpty == true,
            "telemetry recovery never follows symlinks or non-regular files"
        )

        let (listedSymlinkRoot, listedSymlinkURL) = try listedTelemetryRoot("symlink")
        let listedSymlinkTarget = FileManager.default.temporaryDirectory
            .appendingPathComponent("excalicast-listed-symlink-target-\(UUID().uuidString)")
        var listedSymlinkTargetBytes = telemetryBatchLine(index: 0, startUs: 1_000)
        listedSymlinkTargetBytes.append(0x0a)
        try listedSymlinkTargetBytes.write(to: listedSymlinkTarget)
        try FileManager.default.removeItem(at: listedSymlinkURL)
        try FileManager.default.createSymbolicLink(at: listedSymlinkURL, withDestinationURL: listedSymlinkTarget)
        let listedSymlinkManifestURL = listedSymlinkRoot.appendingPathComponent("manifest.json")
        var listedSymlinkManifest = try JSONSerialization.jsonObject(
            with: Data(contentsOf: listedSymlinkManifestURL)
        ) as! [String: Any]
        listedSymlinkManifest["state"] = "ready"
        try JSONSerialization.data(withJSONObject: listedSymlinkManifest)
            .write(to: listedSymlinkManifestURL, options: .atomic)
        let listedSymlinkRecovery = try SegmentedRecordingStore.recover(root: listedSymlinkRoot)
        try expect(
            listedSymlinkRecovery.state == .interrupted
                && listedSymlinkRecovery.tracks[.inputTelemetry]?.isEmpty == true,
            "manifest-listed telemetry symlinks are revalidated and removed"
        )

        let (listedCorruptRoot, listedCorruptURL) = try listedTelemetryRoot("corrupt")
        try Data("not-json\n".utf8).write(to: listedCorruptURL)
        let listedCorruptRecovery = try SegmentedRecordingStore.recover(root: listedCorruptRoot)
        try expect(
            listedCorruptRecovery.state == .interrupted
                && listedCorruptRecovery.tracks[.inputTelemetry]?.isEmpty == true,
            "manifest-listed telemetry with a corrupt complete line is removed"
        )

        let (listedOversizedRoot, listedOversizedURL) = try listedTelemetryRoot("oversized")
        try Data(
            repeating: 0x61,
            count: SegmentedRecordingStore.inputTelemetryChunkMaximumBytes + 1
        ).write(to: listedOversizedURL)
        let listedOversizedRecovery = try SegmentedRecordingStore.recover(root: listedOversizedRoot)
        try expect(
            listedOversizedRecovery.state == .interrupted
                && listedOversizedRecovery.tracks[.inputTelemetry]?.isEmpty == true,
            "manifest-listed telemetry over the production bound is removed"
        )

        let (listedGapRoot, _) = try listedTelemetryRoot("orphan-gap")
        let listedGapOrphan = listedGapRoot
            .appendingPathComponent("segments/input-telemetry/000001.segment")
        var listedGapBytes = telemetryBatchLine(index: 2, startUs: 2_000)
        listedGapBytes.append(0x0a)
        try listedGapBytes.write(to: listedGapOrphan)
        let listedGapRecovery = try SegmentedRecordingStore.recover(root: listedGapRoot)
        try expect(
            listedGapRecovery.tracks[.inputTelemetry]?.count == 1,
            "an orphan whose first batch skips the listed global index is not recovered"
        )

        let (listedDuplicateRoot, _) = try listedTelemetryRoot("cross-chunk-duplicate")
        let listedDuplicateOrphan = listedDuplicateRoot
            .appendingPathComponent("segments/input-telemetry/000001.segment")
        var listedDuplicateBytes = telemetryBatchLine(index: 0, startUs: 2_000)
        listedDuplicateBytes.append(0x0a)
        try listedDuplicateBytes.write(to: listedDuplicateOrphan)
        let listedDuplicateRecovery = try SegmentedRecordingStore.recover(root: listedDuplicateRoot)
        try expect(
            listedDuplicateRecovery.tracks[.inputTelemetry]?.count == 1,
            "a duplicate batch index across listed and orphan chunks is not recovered"
        )

        let (listedContinuousRoot, _) = try listedTelemetryRoot("orphan-continuous")
        let listedContinuousOrphan = listedContinuousRoot
            .appendingPathComponent("segments/input-telemetry/000001.segment")
        var listedContinuousBytes = telemetryBatchLine(index: 1, startUs: 2_000)
        listedContinuousBytes.append(0x0a)
        try listedContinuousBytes.write(to: listedContinuousOrphan)
        let listedContinuousRecovery = try SegmentedRecordingStore.recover(root: listedContinuousRoot)
        try expect(
            listedContinuousRecovery.state == .interrupted
                && listedContinuousRecovery.tracks[.inputTelemetry]?.count == 2,
            "a contiguous orphan is recovered after a revalidated listed chunk"
        )

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
        try? FileManager.default.removeItem(at: longTelemetryRoot)
        try? FileManager.default.removeItem(at: partialTailRoot)
        try? FileManager.default.removeItem(at: corruptMiddleRoot)
        try? FileManager.default.removeItem(at: indexGapRoot)
        try? FileManager.default.removeItem(at: duplicateIndexRoot)
        try? FileManager.default.removeItem(at: nearLimitRoot)
        try? FileManager.default.removeItem(at: oversizedTelemetryRoot)
        try? FileManager.default.removeItem(at: symlinkTelemetryRoot)
        try? FileManager.default.removeItem(at: externalTelemetry)
        try? FileManager.default.removeItem(at: listedSymlinkRoot)
        try? FileManager.default.removeItem(at: listedSymlinkTarget)
        try? FileManager.default.removeItem(at: listedCorruptRoot)
        try? FileManager.default.removeItem(at: listedOversizedRoot)
        try? FileManager.default.removeItem(at: listedGapRoot)
        try? FileManager.default.removeItem(at: listedDuplicateRoot)
        try? FileManager.default.removeItem(at: listedContinuousRoot)
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
