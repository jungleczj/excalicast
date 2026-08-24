import Foundation
#if canImport(MacMediaEngineFinalCompositorStage1)
@testable import MacMediaEngineFinalCompositorStage1
#endif

private enum ContractFailure: Error {
    case expectation(String)
}

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw ContractFailure.expectation(message) }
}

private func expectThrows<T, E: Error & Equatable>(
    _ expected: E,
    _ message: String,
    _ operation: () throws -> T
) throws {
    do {
        _ = try operation()
        throw ContractFailure.expectation(message)
    } catch let error as E {
        try expect(error == expected, "\(message): received \(error), expected \(expected)")
    }
}

private func makeRequest(
    requestId: String = "render-001",
    revision: Int = 1,
    sourceDurationUs: Int64 = 7_500_000,
    keepRanges: [SourceKeepRangeV1] = [
        .init(startUs: 0, endUs: 1_500_000),
        .init(startUs: 3_000_000, endUs: 7_500_000),
    ],
    camera: Bool = true,
    charts: Bool = true,
    soundEffects: Bool = true,
    motionGraphics: Bool = false,
    videoFramesInFlight: Int = 3,
    audioFramesPerChunk: Int = 4_096
) -> NativeFinalRenderRequestV1 {
    NativeFinalRenderRequestV1(
        schemaVersion: 1,
        requestId: requestId,
        revision: revision,
        sourceDurationUs: sourceDurationUs,
        keepRanges: keepRanges,
        features: .init(
            cameraOverlay: camera,
            chartOverlays: charts,
            teachingSoundEffects: soundEffects,
            motionGraphics: motionGraphics
        ),
        resourceLimits: .init(
            videoFramesInFlight: videoFramesInFlight,
            audioFramesPerChunk: audioFramesPerChunk
        )
    )
}

@main
struct NativeFinalCompositorStage1ContractTests {
    static func main() throws {
        let capabilities = NativeFinalCompositorCapabilitiesV1(
            schemaVersion: 1,
            cameraOverlay: true,
            chartOverlays: true,
            teachingSoundEffects: true
        )
        let segment0Sha256 = String(repeating: "a", count: 64)
        let segment1Sha256 = String(repeating: "b", count: 64)
        let segment2Sha256 = String(repeating: "c", count: 64)
        let differentSha256 = String(repeating: "d", count: 64)
        let outputSha256 = String(repeating: "e", count: 64)
        let differentOutputSha256 = String(repeating: "f", count: 64)

        let request = makeRequest()
        let plan = try NativeFinalCompositorStage1Planner.plan(
            request: request,
            capabilities: capabilities
        )

        try expect(plan.schemaVersion == 1, "render plan is explicitly versioned")
        try expect(plan.requestSha256.count == 64, "plan binds the complete immutable request digest")
        try expect(plan.stage == .plannerCore, "stage 1 identifies itself as planner/core")
        try expect(plan.producesPlayableMedia == false, "stage 1 never claims to render playable MP4")
        try expect(plan.outputDurationUs == 6_000_000, "cleanup removes source gaps from output duration")
        try expect(
            plan.timeMap == [
                .init(sourceStartUs: 0, sourceEndUs: 1_500_000, outputStartUs: 0, outputEndUs: 1_500_000),
                .init(sourceStartUs: 3_000_000, sourceEndUs: 7_500_000, outputStartUs: 1_500_000, outputEndUs: 6_000_000),
            ],
            "source-to-output cleanup map is contiguous and literal"
        )
        try expect(plan.outputTime(forSourceTimeUs: 500_000) == 500_000, "retained source time maps into output")
        try expect(plan.outputTime(forSourceTimeUs: 2_000_000) == nil, "removed source time has no output mapping")
        try expect(plan.outputTime(forSourceTimeUs: 3_250_000) == 1_750_000, "post-cut source time maps after removed gap")
        try expect(plan.sourceTime(forOutputTimeUs: 5_999_999) == 7_499_999, "output maps back to retained source")
        try expect(plan.sourceTime(forOutputTimeUs: 6_000_000) == nil, "time-map end is exclusive")

        try expect(
            plan.segmentCheckpoints == [
                .init(index: 0, outputStartUs: 0, outputEndUs: 2_000_000),
                .init(index: 1, outputStartUs: 2_000_000, outputEndUs: 4_000_000),
                .init(index: 2, outputStartUs: 4_000_000, outputEndUs: 6_000_000),
            ],
            "planner creates exact two-second checkpoint segments"
        )

        let tailPlan = try NativeFinalCompositorStage1Planner.plan(
            request: makeRequest(
                sourceDurationUs: 4_100_000,
                keepRanges: [.init(startUs: 0, endUs: 4_100_000)]
            ),
            capabilities: capabilities
        )
        try expect(
            tailPlan.segmentCheckpoints.last == .init(index: 2, outputStartUs: 4_000_000, outputEndUs: 4_100_000),
            "final checkpoint preserves a short tail without padding"
        )

        try expectThrows(
            NativeFinalCompositorStage1Error.unsupportedSchemaVersion(2),
            "unknown request schema must fail closed"
        ) {
            var bad = request
            bad.schemaVersion = 2
            return try NativeFinalCompositorStage1Planner.plan(request: bad, capabilities: capabilities)
        }
        try expectThrows(
            NativeFinalCompositorStage1Error.unsupportedCapabilitySchemaVersion(2),
            "unknown capabilities schema must fail closed"
        ) {
            try NativeFinalCompositorStage1Planner.plan(
                request: request,
                capabilities: .init(schemaVersion: 2, cameraOverlay: true, chartOverlays: true, teachingSoundEffects: true)
            )
        }
        try expectThrows(
            NativeFinalCompositorStage1Error.unsupportedFeature(.cameraOverlay),
            "requested camera overlay requires native capability"
        ) {
            try NativeFinalCompositorStage1Planner.plan(
                request: request,
                capabilities: .init(schemaVersion: 1, cameraOverlay: false, chartOverlays: true, teachingSoundEffects: true)
            )
        }
        try expectThrows(
            NativeFinalCompositorStage1Error.unsupportedFeature(.chartOverlays),
            "requested charts require native capability"
        ) {
            try NativeFinalCompositorStage1Planner.plan(
                request: request,
                capabilities: .init(schemaVersion: 1, cameraOverlay: true, chartOverlays: false, teachingSoundEffects: true)
            )
        }
        try expectThrows(
            NativeFinalCompositorStage1Error.unsupportedFeature(.teachingSoundEffects),
            "requested sound effects require native capability"
        ) {
            try NativeFinalCompositorStage1Planner.plan(
                request: request,
                capabilities: .init(schemaVersion: 1, cameraOverlay: true, chartOverlays: true, teachingSoundEffects: false)
            )
        }
        try expectThrows(
            NativeFinalCompositorStage1Error.motionGraphicsUnsupported,
            "motion graphics remain explicitly unsupported in stage 1"
        ) {
            try NativeFinalCompositorStage1Planner.plan(
                request: makeRequest(motionGraphics: true),
                capabilities: capabilities
            )
        }
        try expectThrows(
            NativeFinalCompositorStage1Error.videoFrameLimitExceeded(requested: 4, maximum: 3),
            "planner enforces a maximum of three in-flight video frames"
        ) {
            try NativeFinalCompositorStage1Planner.plan(
                request: makeRequest(videoFramesInFlight: 4),
                capabilities: capabilities
            )
        }
        try expectThrows(
            NativeFinalCompositorStage1Error.audioFrameLimitExceeded(requested: 4_097, maximum: 4_096),
            "planner enforces 4096 audio frames per chunk"
        ) {
            try NativeFinalCompositorStage1Planner.plan(
                request: makeRequest(audioFramesPerChunk: 4_097),
                capabilities: capabilities
            )
        }
        try expectThrows(
            NativeFinalCompositorStage1Error.invalidKeepRanges,
            "overlapping cleanup ranges cannot create an ambiguous map"
        ) {
            try NativeFinalCompositorStage1Planner.plan(
                request: makeRequest(
                    keepRanges: [
                        .init(startUs: 0, endUs: 2_000_000),
                        .init(startUs: 1_999_999, endUs: 3_000_000),
                    ]
                ),
                capabilities: capabilities
            )
        }
        try expectThrows(
            NativeFinalCompositorStage1Error.sourceDurationLimitExceeded(
                requested: Int64.max,
                maximum: NativeFinalCompositorStage1Planner.maximumSourceDurationUs
            ),
            "untrusted duration is rejected before allocating trillions of checkpoint entries"
        ) {
            try NativeFinalCompositorStage1Planner.plan(
                request: makeRequest(
                    sourceDurationUs: Int64.max,
                    keepRanges: [.init(startUs: 0, endUs: Int64.max)]
                ),
                capabilities: capabilities
            )
        }

        var machine = try NativeFinalCompositorStage1StateMachine.create(plan: plan)
        try expect(machine.checkpoint.status == .planned, "new work starts planned")
        let started = try machine.start()
        try expect(started.status == .rendering, "start transitions planned work to rendering")
        let duplicateStart = try machine.start()
        try expect(duplicateStart == started, "duplicate start is idempotent")

        let afterFirst = try machine.completeSegment(index: 0, artifactIdentity: segment0Sha256)
        try expect(afterFirst.nextSegmentIndex == 1, "segment completion advances exactly once")
        let duplicateFirst = try machine.completeSegment(index: 0, artifactIdentity: segment0Sha256)
        try expect(duplicateFirst == afterFirst, "same completed segment replay is idempotent")
        try expectThrows(
            NativeFinalCompositorStage1Error.segmentIdentityConflict(index: 0),
            "same segment index cannot be rebound to different output"
        ) {
            try machine.completeSegment(index: 0, artifactIdentity: differentSha256)
        }
        try expectThrows(
            NativeFinalCompositorStage1Error.outOfOrderSegment(expected: 1, received: 2),
            "checkpoint cannot skip a segment"
        ) {
            try machine.completeSegment(index: 2, artifactIdentity: segment2Sha256)
        }

        let interrupted = try machine.interrupt()
        try expect(interrupted.status == .interrupted, "interruption preserves recoverable progress")
        var recovered = try NativeFinalCompositorStage1StateMachine.recover(
            plan: plan,
            checkpoint: interrupted,
            capabilities: capabilities
        )
        try expect(recovered.checkpoint.status == .rendering, "recover resumes interrupted work")
        try expect(recovered.checkpoint.nextSegmentIndex == 1, "recover resumes at first incomplete segment")
        try expect(recovered.checkpoint.completedSegments[0] == segment0Sha256, "recover preserves completed segment identity")

        let cancelled = try recovered.cancel()
        try expect(cancelled.status == .cancelled, "cancel reaches a terminal checkpoint")
        let duplicateCancel = try recovered.cancel()
        try expect(duplicateCancel == cancelled, "duplicate cancel is idempotent")
        try expectThrows(
            NativeFinalCompositorStage1Error.terminalState(.cancelled),
            "cancelled work cannot accept more segments"
        ) {
            try recovered.completeSegment(index: 1, artifactIdentity: segment1Sha256)
        }

        try expectThrows(
            NativeFinalCompositorStage1Error.checkpointRequestMismatch,
            "checkpoint cannot be recovered under another immutable request"
        ) {
            try NativeFinalCompositorStage1StateMachine.recover(
                plan: try NativeFinalCompositorStage1Planner.plan(
                    request: makeRequest(requestId: "render-002"),
                    capabilities: capabilities
                ),
                checkpoint: interrupted,
                capabilities: capabilities
            )
        }
        try expectThrows(
            NativeFinalCompositorStage1Error.checkpointRequestMismatch,
            "same request ID and revision cannot hide changed render content"
        ) {
            try NativeFinalCompositorStage1StateMachine.recover(
                plan: try NativeFinalCompositorStage1Planner.plan(
                    request: makeRequest(
                        sourceDurationUs: 7_600_000,
                        keepRanges: [
                            .init(startUs: 0, endUs: 1_500_000),
                            .init(startUs: 3_000_000, endUs: 7_600_000),
                        ]
                    ),
                    capabilities: capabilities
                ),
                checkpoint: interrupted,
                capabilities: capabilities
            )
        }

        let tamperedPlan = NativeFinalRenderPlanV1(
            schemaVersion: plan.schemaVersion,
            requestId: plan.requestId,
            requestRevision: plan.requestRevision,
            requestSha256: plan.requestSha256,
            capabilitiesSha256: plan.capabilitiesSha256,
            planSha256: plan.planSha256,
            stage: plan.stage,
            producesPlayableMedia: plan.producesPlayableMedia,
            outputDurationUs: plan.outputDurationUs,
            timeMap: [
                .init(
                    sourceStartUs: 0,
                    sourceEndUs: 1_500_000,
                    outputStartUs: 0,
                    outputEndUs: 1_500_000
                ),
                .init(
                    sourceStartUs: 3_000_001,
                    sourceEndUs: 7_500_001,
                    outputStartUs: 1_500_000,
                    outputEndUs: 6_000_000
                ),
            ],
            segmentCheckpoints: plan.segmentCheckpoints,
            resourceLimits: plan.resourceLimits
        )
        try expectThrows(
            NativeFinalCompositorStage1Error.checkpointRequestMismatch,
            "checkpoint recovery binds the derived time map and segment plan, not only the request digest"
        ) {
            try NativeFinalCompositorStage1StateMachine.recover(
                plan: tamperedPlan,
                checkpoint: interrupted,
                capabilities: capabilities
            )
        }
        try expectThrows(
            NativeFinalCompositorStage1Error.capabilitySnapshotMismatch,
            "recovery revalidates native capabilities instead of trusting an old plan"
        ) {
            try NativeFinalCompositorStage1StateMachine.recover(
                plan: plan,
                checkpoint: interrupted,
                capabilities: .init(
                    schemaVersion: 1,
                    cameraOverlay: false,
                    chartOverlays: true,
                    teachingSoundEffects: true
                )
            )
        }

        let malformedTimeMapDraft = NativeFinalRenderPlanV1(
            schemaVersion: plan.schemaVersion,
            requestId: plan.requestId,
            requestRevision: plan.requestRevision,
            requestSha256: plan.requestSha256,
            capabilitiesSha256: plan.capabilitiesSha256,
            planSha256: String(repeating: "0", count: 64),
            stage: plan.stage,
            producesPlayableMedia: plan.producesPlayableMedia,
            outputDurationUs: plan.outputDurationUs,
            timeMap: [
                .init(sourceStartUs: 0, sourceEndUs: 1_500_000, outputStartUs: 0, outputEndUs: 1_500_000),
                .init(sourceStartUs: 3_000_000, sourceEndUs: 7_500_000, outputStartUs: 1_400_000, outputEndUs: 5_900_000),
            ],
            segmentCheckpoints: plan.segmentCheckpoints,
            resourceLimits: plan.resourceLimits
        )
        let malformedTimeMapPlan = NativeFinalRenderPlanV1(
            schemaVersion: malformedTimeMapDraft.schemaVersion,
            requestId: malformedTimeMapDraft.requestId,
            requestRevision: malformedTimeMapDraft.requestRevision,
            requestSha256: malformedTimeMapDraft.requestSha256,
            capabilitiesSha256: malformedTimeMapDraft.capabilitiesSha256,
            planSha256: try NativeFinalCompositorStage1Planner.planIdentitySha256(for: malformedTimeMapDraft),
            stage: malformedTimeMapDraft.stage,
            producesPlayableMedia: malformedTimeMapDraft.producesPlayableMedia,
            outputDurationUs: malformedTimeMapDraft.outputDurationUs,
            timeMap: malformedTimeMapDraft.timeMap,
            segmentCheckpoints: malformedTimeMapDraft.segmentCheckpoints,
            resourceLimits: malformedTimeMapDraft.resourceLimits
        )
        try expectThrows(
            NativeFinalCompositorStage1Error.invalidCheckpoint,
            "state creation rejects a self-consistent digest over a non-contiguous derived time map"
        ) {
            try NativeFinalCompositorStage1StateMachine.create(plan: malformedTimeMapPlan)
        }

        let invalidIdentityDraft = NativeFinalRenderPlanV1(
            schemaVersion: plan.schemaVersion,
            requestId: "",
            requestRevision: 0,
            requestSha256: plan.requestSha256,
            capabilitiesSha256: plan.capabilitiesSha256,
            planSha256: String(repeating: "0", count: 64),
            stage: plan.stage,
            producesPlayableMedia: plan.producesPlayableMedia,
            outputDurationUs: plan.outputDurationUs,
            timeMap: plan.timeMap,
            segmentCheckpoints: plan.segmentCheckpoints,
            resourceLimits: plan.resourceLimits
        )
        let invalidIdentityPlan = NativeFinalRenderPlanV1(
            schemaVersion: invalidIdentityDraft.schemaVersion,
            requestId: invalidIdentityDraft.requestId,
            requestRevision: invalidIdentityDraft.requestRevision,
            requestSha256: invalidIdentityDraft.requestSha256,
            capabilitiesSha256: invalidIdentityDraft.capabilitiesSha256,
            planSha256: try NativeFinalCompositorStage1Planner.planIdentitySha256(for: invalidIdentityDraft),
            stage: invalidIdentityDraft.stage,
            producesPlayableMedia: invalidIdentityDraft.producesPlayableMedia,
            outputDurationUs: invalidIdentityDraft.outputDurationUs,
            timeMap: invalidIdentityDraft.timeMap,
            segmentCheckpoints: invalidIdentityDraft.segmentCheckpoints,
            resourceLimits: invalidIdentityDraft.resourceLimits
        )
        try expectThrows(
            NativeFinalCompositorStage1Error.invalidCheckpoint,
            "state creation revalidates request identity even when the plan digest is self-consistent"
        ) {
            try NativeFinalCompositorStage1StateMachine.create(plan: invalidIdentityPlan)
        }

        let malformedPlanned = NativeFinalRenderCheckpointV1(
            schemaVersion: 1,
            requestId: plan.requestId,
            requestRevision: plan.requestRevision,
            requestSha256: plan.requestSha256,
            planSha256: plan.planSha256,
            status: .planned,
            totalSegmentCount: plan.segmentCheckpoints.count,
            nextSegmentIndex: 1,
            completedSegments: [0: segment0Sha256],
            outputIdentity: nil,
            failureCode: nil
        )
        try expectThrows(
            NativeFinalCompositorStage1Error.invalidCheckpoint,
            "planned checkpoint cannot contain forged completed progress"
        ) {
            try NativeFinalCompositorStage1StateMachine.recover(
                plan: plan,
                checkpoint: malformedPlanned,
                capabilities: capabilities
            )
        }

        var completing = try NativeFinalCompositorStage1StateMachine.create(plan: tailPlan)
        _ = try completing.start()
        try expectThrows(
            NativeFinalCompositorStage1Error.invalidArtifactIdentity,
            "segment content identity must be a canonical SHA-256 digest"
        ) {
            try completing.completeSegment(index: 0, artifactIdentity: "not-a-content-digest")
        }
        _ = try completing.completeSegment(index: 0, artifactIdentity: segment0Sha256)
        _ = try completing.completeSegment(index: 1, artifactIdentity: segment1Sha256)
        _ = try completing.completeSegment(index: 2, artifactIdentity: segment2Sha256)
        let ready = try completing.complete(outputIdentity: outputSha256)
        try expect(ready.status == .ready, "complete publishes ready only after every planned segment")
        try expect(ready.outputIdentity == outputSha256, "ready checkpoint binds final output identity")
        let duplicateReady = try completing.complete(outputIdentity: outputSha256)
        try expect(duplicateReady == ready, "duplicate finalization is idempotent")
        try expectThrows(
            NativeFinalCompositorStage1Error.outputIdentityConflict,
            "ready output identity is immutable"
        ) {
            try completing.complete(outputIdentity: differentOutputSha256)
        }
        let recoveredReady = try NativeFinalCompositorStage1StateMachine.recover(
            plan: tailPlan,
            checkpoint: ready,
            capabilities: capabilities
        )
        try expect(recoveredReady.checkpoint == ready, "recovery preserves an already-ready checkpoint")

        let encodedRequest = try JSONEncoder().encode(request)
        let decodedRequest = try JSONDecoder().decode(NativeFinalRenderRequestV1.self, from: encodedRequest)
        try expect(decodedRequest == request, "versioned request survives persistence round trip")
        let encodedCheckpoint = try JSONEncoder().encode(ready)
        let decodedCheckpoint = try JSONDecoder().decode(NativeFinalRenderCheckpointV1.self, from: encodedCheckpoint)
        try expect(decodedCheckpoint == ready, "versioned checkpoint survives persistence round trip")

        print("Native final compositor stage 1 contract tests passed")
    }
}
