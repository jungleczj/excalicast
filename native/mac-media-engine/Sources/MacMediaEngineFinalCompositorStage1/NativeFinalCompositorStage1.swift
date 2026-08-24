import Foundation
import CryptoKit

private func sha256Hex<T: Encodable>(_ value: T) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let bytes = try encoder.encode(value)
    return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
}

private func isSHA256Hex(_ value: String) -> Bool {
    value.utf8.count == 64 && value.unicodeScalars.allSatisfy {
        ($0.value >= 48 && $0.value <= 57) || ($0.value >= 97 && $0.value <= 102)
    }
}

public enum NativeFinalCompositorStage: String, Codable, Equatable, Sendable {
    case plannerCore = "stage1-planner-core"
}

public enum NativeFinalCompositorFeature: String, Codable, Equatable, Sendable {
    case cameraOverlay = "camera-overlay"
    case chartOverlays = "chart-overlays"
    case teachingSoundEffects = "teaching-sound-effects"
}

public struct SourceKeepRangeV1: Codable, Equatable, Sendable {
    public let startUs: Int64
    public let endUs: Int64

    public init(startUs: Int64, endUs: Int64) {
        self.startUs = startUs
        self.endUs = endUs
    }
}

public struct NativeFinalRenderFeaturesV1: Codable, Equatable, Sendable {
    public let cameraOverlay: Bool
    public let chartOverlays: Bool
    public let teachingSoundEffects: Bool
    public let motionGraphics: Bool

    public init(
        cameraOverlay: Bool,
        chartOverlays: Bool,
        teachingSoundEffects: Bool,
        motionGraphics: Bool
    ) {
        self.cameraOverlay = cameraOverlay
        self.chartOverlays = chartOverlays
        self.teachingSoundEffects = teachingSoundEffects
        self.motionGraphics = motionGraphics
    }
}

public struct NativeFinalRenderResourceLimitsV1: Codable, Equatable, Sendable {
    public let videoFramesInFlight: Int
    public let audioFramesPerChunk: Int

    public init(videoFramesInFlight: Int, audioFramesPerChunk: Int) {
        self.videoFramesInFlight = videoFramesInFlight
        self.audioFramesPerChunk = audioFramesPerChunk
    }
}

public struct NativeFinalRenderRequestV1: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public let requestId: String
    public let revision: Int
    public let sourceDurationUs: Int64
    public let keepRanges: [SourceKeepRangeV1]
    public let features: NativeFinalRenderFeaturesV1
    public let resourceLimits: NativeFinalRenderResourceLimitsV1

    public init(
        schemaVersion: Int,
        requestId: String,
        revision: Int,
        sourceDurationUs: Int64,
        keepRanges: [SourceKeepRangeV1],
        features: NativeFinalRenderFeaturesV1,
        resourceLimits: NativeFinalRenderResourceLimitsV1
    ) {
        self.schemaVersion = schemaVersion
        self.requestId = requestId
        self.revision = revision
        self.sourceDurationUs = sourceDurationUs
        self.keepRanges = keepRanges
        self.features = features
        self.resourceLimits = resourceLimits
    }
}

public struct NativeFinalCompositorCapabilitiesV1: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let cameraOverlay: Bool
    public let chartOverlays: Bool
    public let teachingSoundEffects: Bool

    public init(
        schemaVersion: Int,
        cameraOverlay: Bool,
        chartOverlays: Bool,
        teachingSoundEffects: Bool
    ) {
        self.schemaVersion = schemaVersion
        self.cameraOverlay = cameraOverlay
        self.chartOverlays = chartOverlays
        self.teachingSoundEffects = teachingSoundEffects
    }
}

public struct SourceOutputTimeMapEntryV1: Codable, Equatable, Sendable {
    public let sourceStartUs: Int64
    public let sourceEndUs: Int64
    public let outputStartUs: Int64
    public let outputEndUs: Int64

    public init(sourceStartUs: Int64, sourceEndUs: Int64, outputStartUs: Int64, outputEndUs: Int64) {
        self.sourceStartUs = sourceStartUs
        self.sourceEndUs = sourceEndUs
        self.outputStartUs = outputStartUs
        self.outputEndUs = outputEndUs
    }
}

public struct NativeFinalSegmentCheckpointPlanV1: Codable, Equatable, Sendable {
    public let index: Int
    public let outputStartUs: Int64
    public let outputEndUs: Int64

    public init(index: Int, outputStartUs: Int64, outputEndUs: Int64) {
        self.index = index
        self.outputStartUs = outputStartUs
        self.outputEndUs = outputEndUs
    }
}

public struct NativeFinalRenderPlanV1: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let requestId: String
    public let requestRevision: Int
    public let requestSha256: String
    public let capabilitiesSha256: String
    public let planSha256: String
    public let stage: NativeFinalCompositorStage
    public let producesPlayableMedia: Bool
    public let outputDurationUs: Int64
    public let timeMap: [SourceOutputTimeMapEntryV1]
    public let segmentCheckpoints: [NativeFinalSegmentCheckpointPlanV1]
    public let resourceLimits: NativeFinalRenderResourceLimitsV1

    public init(
        schemaVersion: Int,
        requestId: String,
        requestRevision: Int,
        requestSha256: String,
        capabilitiesSha256: String,
        planSha256: String,
        stage: NativeFinalCompositorStage,
        producesPlayableMedia: Bool,
        outputDurationUs: Int64,
        timeMap: [SourceOutputTimeMapEntryV1],
        segmentCheckpoints: [NativeFinalSegmentCheckpointPlanV1],
        resourceLimits: NativeFinalRenderResourceLimitsV1
    ) {
        self.schemaVersion = schemaVersion
        self.requestId = requestId
        self.requestRevision = requestRevision
        self.requestSha256 = requestSha256
        self.capabilitiesSha256 = capabilitiesSha256
        self.planSha256 = planSha256
        self.stage = stage
        self.producesPlayableMedia = producesPlayableMedia
        self.outputDurationUs = outputDurationUs
        self.timeMap = timeMap
        self.segmentCheckpoints = segmentCheckpoints
        self.resourceLimits = resourceLimits
    }

    public func outputTime(forSourceTimeUs sourceTimeUs: Int64) -> Int64? {
        guard let entry = timeMap.first(where: {
            sourceTimeUs >= $0.sourceStartUs && sourceTimeUs < $0.sourceEndUs
        }) else { return nil }
        let delta = sourceTimeUs - entry.sourceStartUs
        let (mapped, overflow) = entry.outputStartUs.addingReportingOverflow(delta)
        return overflow ? nil : mapped
    }

    public func sourceTime(forOutputTimeUs outputTimeUs: Int64) -> Int64? {
        guard let entry = timeMap.first(where: {
            outputTimeUs >= $0.outputStartUs && outputTimeUs < $0.outputEndUs
        }) else { return nil }
        let delta = outputTimeUs - entry.outputStartUs
        let (mapped, overflow) = entry.sourceStartUs.addingReportingOverflow(delta)
        return overflow ? nil : mapped
    }
}

public enum NativeFinalRenderStatus: String, Codable, Equatable, Sendable {
    case planned
    case rendering
    case interrupted
    case cancelled
    case ready
    case failed
}

public struct NativeFinalRenderCheckpointV1: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let requestId: String
    public let requestRevision: Int
    public let requestSha256: String
    public let planSha256: String
    public var status: NativeFinalRenderStatus
    public let totalSegmentCount: Int
    public var nextSegmentIndex: Int
    public var completedSegments: [Int: String]
    public var outputIdentity: String?
    public var failureCode: String?

    public init(
        schemaVersion: Int,
        requestId: String,
        requestRevision: Int,
        requestSha256: String,
        planSha256: String,
        status: NativeFinalRenderStatus,
        totalSegmentCount: Int,
        nextSegmentIndex: Int,
        completedSegments: [Int: String],
        outputIdentity: String?,
        failureCode: String?
    ) {
        self.schemaVersion = schemaVersion
        self.requestId = requestId
        self.requestRevision = requestRevision
        self.requestSha256 = requestSha256
        self.planSha256 = planSha256
        self.status = status
        self.totalSegmentCount = totalSegmentCount
        self.nextSegmentIndex = nextSegmentIndex
        self.completedSegments = completedSegments
        self.outputIdentity = outputIdentity
        self.failureCode = failureCode
    }
}

public enum NativeFinalCompositorStage1Error: Error, Equatable, Sendable {
    case unsupportedSchemaVersion(Int)
    case unsupportedCapabilitySchemaVersion(Int)
    case invalidRequestIdentity
    case invalidSourceDuration
    case sourceDurationLimitExceeded(requested: Int64, maximum: Int64)
    case invalidKeepRanges
    case keepRangeLimitExceeded(requested: Int, maximum: Int)
    case durationOverflow
    case unsupportedFeature(NativeFinalCompositorFeature)
    case motionGraphicsUnsupported
    case invalidResourceLimit
    case videoFrameLimitExceeded(requested: Int, maximum: Int)
    case audioFrameLimitExceeded(requested: Int, maximum: Int)
    case unsupportedCheckpointSchemaVersion(Int)
    case checkpointRequestMismatch
    case capabilitySnapshotMismatch
    case invalidCheckpoint
    case invalidState(NativeFinalRenderStatus)
    case terminalState(NativeFinalRenderStatus)
    case invalidArtifactIdentity
    case segmentIdentityConflict(index: Int)
    case outOfOrderSegment(expected: Int, received: Int)
    case incompleteSegments
    case outputIdentityConflict
}

public enum NativeFinalCompositorStage1Planner {
    public static let maximumVideoFramesInFlight = 3
    public static let maximumAudioFramesPerChunk = 4_096
    public static let checkpointSegmentDurationUs: Int64 = 2_000_000
    public static let maximumSourceDurationUs: Int64 = 12 * 60 * 60 * 1_000_000
    public static let maximumKeepRangeCount = 65_536

    public static func plan(
        request: NativeFinalRenderRequestV1,
        capabilities: NativeFinalCompositorCapabilitiesV1
    ) throws -> NativeFinalRenderPlanV1 {
        guard request.schemaVersion == 1 else {
            throw NativeFinalCompositorStage1Error.unsupportedSchemaVersion(request.schemaVersion)
        }
        guard capabilities.schemaVersion == 1 else {
            throw NativeFinalCompositorStage1Error.unsupportedCapabilitySchemaVersion(capabilities.schemaVersion)
        }
        guard isValidIdentity(request.requestId), request.revision > 0 else {
            throw NativeFinalCompositorStage1Error.invalidRequestIdentity
        }
        guard request.sourceDurationUs > 0 else {
            throw NativeFinalCompositorStage1Error.invalidSourceDuration
        }
        guard request.sourceDurationUs <= maximumSourceDurationUs else {
            throw NativeFinalCompositorStage1Error.sourceDurationLimitExceeded(
                requested: request.sourceDurationUs,
                maximum: maximumSourceDurationUs
            )
        }
        guard request.keepRanges.count <= maximumKeepRangeCount else {
            throw NativeFinalCompositorStage1Error.keepRangeLimitExceeded(
                requested: request.keepRanges.count,
                maximum: maximumKeepRangeCount
            )
        }
        guard request.resourceLimits.videoFramesInFlight > 0,
              request.resourceLimits.audioFramesPerChunk > 0 else {
            throw NativeFinalCompositorStage1Error.invalidResourceLimit
        }
        guard request.resourceLimits.videoFramesInFlight <= maximumVideoFramesInFlight else {
            throw NativeFinalCompositorStage1Error.videoFrameLimitExceeded(
                requested: request.resourceLimits.videoFramesInFlight,
                maximum: maximumVideoFramesInFlight
            )
        }
        guard request.resourceLimits.audioFramesPerChunk <= maximumAudioFramesPerChunk else {
            throw NativeFinalCompositorStage1Error.audioFrameLimitExceeded(
                requested: request.resourceLimits.audioFramesPerChunk,
                maximum: maximumAudioFramesPerChunk
            )
        }
        if request.features.motionGraphics {
            throw NativeFinalCompositorStage1Error.motionGraphicsUnsupported
        }
        if request.features.cameraOverlay && !capabilities.cameraOverlay {
            throw NativeFinalCompositorStage1Error.unsupportedFeature(.cameraOverlay)
        }
        if request.features.chartOverlays && !capabilities.chartOverlays {
            throw NativeFinalCompositorStage1Error.unsupportedFeature(.chartOverlays)
        }
        if request.features.teachingSoundEffects && !capabilities.teachingSoundEffects {
            throw NativeFinalCompositorStage1Error.unsupportedFeature(.teachingSoundEffects)
        }

        var timeMap: [SourceOutputTimeMapEntryV1] = []
        var previousSourceEnd: Int64 = -1
        var outputCursor: Int64 = 0
        guard !request.keepRanges.isEmpty else {
            throw NativeFinalCompositorStage1Error.invalidKeepRanges
        }
        for range in request.keepRanges {
            guard range.startUs >= 0,
                  range.endUs > range.startUs,
                  range.endUs <= request.sourceDurationUs,
                  range.startUs >= previousSourceEnd else {
                throw NativeFinalCompositorStage1Error.invalidKeepRanges
            }
            let duration = range.endUs - range.startUs
            let (outputEnd, overflow) = outputCursor.addingReportingOverflow(duration)
            guard !overflow else { throw NativeFinalCompositorStage1Error.durationOverflow }
            timeMap.append(.init(
                sourceStartUs: range.startUs,
                sourceEndUs: range.endUs,
                outputStartUs: outputCursor,
                outputEndUs: outputEnd
            ))
            previousSourceEnd = range.endUs
            outputCursor = outputEnd
        }

        var segmentCheckpoints: [NativeFinalSegmentCheckpointPlanV1] = []
        var segmentStart: Int64 = 0
        var segmentIndex = 0
        while segmentStart < outputCursor {
            let remaining = outputCursor - segmentStart
            let duration = min(checkpointSegmentDurationUs, remaining)
            let segmentEnd = segmentStart + duration
            segmentCheckpoints.append(.init(
                index: segmentIndex,
                outputStartUs: segmentStart,
                outputEndUs: segmentEnd
            ))
            segmentIndex += 1
            segmentStart = segmentEnd
        }

        let requestSha256 = try sha256Hex(request)
        let capabilitiesSha256 = try sha256Hex(capabilities)
        let planSha256 = try planIdentitySha256(
            requestId: request.requestId,
            requestRevision: request.revision,
            requestSha256: requestSha256,
            capabilitiesSha256: capabilitiesSha256,
            outputDurationUs: outputCursor,
            timeMap: timeMap,
            segmentCheckpoints: segmentCheckpoints,
            resourceLimits: request.resourceLimits
        )
        return NativeFinalRenderPlanV1(
            schemaVersion: 1,
            requestId: request.requestId,
            requestRevision: request.revision,
            requestSha256: requestSha256,
            capabilitiesSha256: capabilitiesSha256,
            planSha256: planSha256,
            stage: .plannerCore,
            producesPlayableMedia: false,
            outputDurationUs: outputCursor,
            timeMap: timeMap,
            segmentCheckpoints: segmentCheckpoints,
            resourceLimits: request.resourceLimits
        )
    }

    static func planIdentitySha256(for plan: NativeFinalRenderPlanV1) throws -> String {
        try planIdentitySha256(
            requestId: plan.requestId,
            requestRevision: plan.requestRevision,
            requestSha256: plan.requestSha256,
            capabilitiesSha256: plan.capabilitiesSha256,
            outputDurationUs: plan.outputDurationUs,
            timeMap: plan.timeMap,
            segmentCheckpoints: plan.segmentCheckpoints,
            resourceLimits: plan.resourceLimits
        )
    }

    private struct PlanIdentityMaterial: Encodable {
        let schemaVersion: Int
        let requestId: String
        let requestRevision: Int
        let requestSha256: String
        let capabilitiesSha256: String
        let stage: NativeFinalCompositorStage
        let producesPlayableMedia: Bool
        let outputDurationUs: Int64
        let timeMap: [SourceOutputTimeMapEntryV1]
        let segmentCheckpoints: [NativeFinalSegmentCheckpointPlanV1]
        let resourceLimits: NativeFinalRenderResourceLimitsV1
    }

    private static func planIdentitySha256(
        requestId: String,
        requestRevision: Int,
        requestSha256: String,
        capabilitiesSha256: String,
        outputDurationUs: Int64,
        timeMap: [SourceOutputTimeMapEntryV1],
        segmentCheckpoints: [NativeFinalSegmentCheckpointPlanV1],
        resourceLimits: NativeFinalRenderResourceLimitsV1
    ) throws -> String {
        try sha256Hex(PlanIdentityMaterial(
            schemaVersion: 1,
            requestId: requestId,
            requestRevision: requestRevision,
            requestSha256: requestSha256,
            capabilitiesSha256: capabilitiesSha256,
            stage: .plannerCore,
            producesPlayableMedia: false,
            outputDurationUs: outputDurationUs,
            timeMap: timeMap,
            segmentCheckpoints: segmentCheckpoints,
            resourceLimits: resourceLimits
        ))
    }

    static func isValidIdentity(_ value: String) -> Bool {
        guard !value.isEmpty, value.utf8.count <= 128 else { return false }
        return value.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_"
        }
    }
}

public struct NativeFinalCompositorStage1StateMachine: Sendable {
    public private(set) var checkpoint: NativeFinalRenderCheckpointV1
    private let plan: NativeFinalRenderPlanV1

    private init(plan: NativeFinalRenderPlanV1, checkpoint: NativeFinalRenderCheckpointV1) {
        self.plan = plan
        self.checkpoint = checkpoint
    }

    public static func create(plan: NativeFinalRenderPlanV1) throws -> Self {
        try validate(plan: plan)
        return Self(
            plan: plan,
            checkpoint: .init(
                schemaVersion: 1,
                requestId: plan.requestId,
                requestRevision: plan.requestRevision,
                requestSha256: plan.requestSha256,
                planSha256: plan.planSha256,
                status: .planned,
                totalSegmentCount: plan.segmentCheckpoints.count,
                nextSegmentIndex: 0,
                completedSegments: [:],
                outputIdentity: nil,
                failureCode: nil
            )
        )
    }

    public static func recover(
        plan: NativeFinalRenderPlanV1,
        checkpoint: NativeFinalRenderCheckpointV1,
        capabilities: NativeFinalCompositorCapabilitiesV1
    ) throws -> Self {
        guard checkpoint.schemaVersion == 1 else {
            throw NativeFinalCompositorStage1Error.unsupportedCheckpointSchemaVersion(checkpoint.schemaVersion)
        }
        guard checkpoint.requestId == plan.requestId,
              checkpoint.requestRevision == plan.requestRevision,
              checkpoint.requestSha256 == plan.requestSha256,
              checkpoint.planSha256 == plan.planSha256,
              try NativeFinalCompositorStage1Planner.planIdentitySha256(for: plan) == plan.planSha256 else {
            throw NativeFinalCompositorStage1Error.checkpointRequestMismatch
        }
        guard capabilities.schemaVersion == 1,
              try sha256Hex(capabilities) == plan.capabilitiesSha256 else {
            throw NativeFinalCompositorStage1Error.capabilitySnapshotMismatch
        }
        try validate(plan: plan)
        try validate(checkpoint: checkpoint, for: plan)
        var recovered = checkpoint
        if recovered.status == .interrupted {
            recovered.status = .rendering
        }
        return Self(plan: plan, checkpoint: recovered)
    }

    @discardableResult
    public mutating func start() throws -> NativeFinalRenderCheckpointV1 {
        switch checkpoint.status {
        case .planned:
            checkpoint.status = .rendering
        case .rendering:
            break
        case .interrupted:
            checkpoint.status = .rendering
        case .cancelled, .ready, .failed:
            throw NativeFinalCompositorStage1Error.terminalState(checkpoint.status)
        }
        return checkpoint
    }

    @discardableResult
    public mutating func completeSegment(
        index: Int,
        artifactIdentity: String
    ) throws -> NativeFinalRenderCheckpointV1 {
        guard checkpoint.status == .rendering else {
            if [.cancelled, .ready, .failed].contains(checkpoint.status) {
                throw NativeFinalCompositorStage1Error.terminalState(checkpoint.status)
            }
            throw NativeFinalCompositorStage1Error.invalidState(checkpoint.status)
        }
        guard NativeFinalCompositorStage1StateMachine.isValidArtifactIdentity(artifactIdentity) else {
            throw NativeFinalCompositorStage1Error.invalidArtifactIdentity
        }
        if index < checkpoint.nextSegmentIndex {
            guard checkpoint.completedSegments[index] == artifactIdentity else {
                throw NativeFinalCompositorStage1Error.segmentIdentityConflict(index: index)
            }
            return checkpoint
        }
        guard index == checkpoint.nextSegmentIndex,
              index < checkpoint.totalSegmentCount else {
            throw NativeFinalCompositorStage1Error.outOfOrderSegment(
                expected: checkpoint.nextSegmentIndex,
                received: index
            )
        }
        checkpoint.completedSegments[index] = artifactIdentity
        checkpoint.nextSegmentIndex += 1
        return checkpoint
    }

    @discardableResult
    public mutating func interrupt() throws -> NativeFinalRenderCheckpointV1 {
        switch checkpoint.status {
        case .rendering:
            checkpoint.status = .interrupted
        case .interrupted:
            break
        case .planned:
            throw NativeFinalCompositorStage1Error.invalidState(.planned)
        case .cancelled, .ready, .failed:
            throw NativeFinalCompositorStage1Error.terminalState(checkpoint.status)
        }
        return checkpoint
    }

    @discardableResult
    public mutating func cancel() throws -> NativeFinalRenderCheckpointV1 {
        switch checkpoint.status {
        case .cancelled:
            return checkpoint
        case .ready, .failed:
            throw NativeFinalCompositorStage1Error.terminalState(checkpoint.status)
        case .planned, .rendering, .interrupted:
            checkpoint.status = .cancelled
            return checkpoint
        }
    }

    @discardableResult
    public mutating func fail(code: String) throws -> NativeFinalRenderCheckpointV1 {
        guard checkpoint.status == .rendering || checkpoint.status == .interrupted else {
            if checkpoint.status == .failed, checkpoint.failureCode == code {
                return checkpoint
            }
            throw NativeFinalCompositorStage1Error.terminalState(checkpoint.status)
        }
        guard Self.isValidFailureCode(code) else {
            throw NativeFinalCompositorStage1Error.invalidArtifactIdentity
        }
        checkpoint.status = .failed
        checkpoint.failureCode = code
        return checkpoint
    }

    @discardableResult
    public mutating func complete(outputIdentity: String) throws -> NativeFinalRenderCheckpointV1 {
        if checkpoint.status == .ready {
            guard checkpoint.outputIdentity == outputIdentity else {
                throw NativeFinalCompositorStage1Error.outputIdentityConflict
            }
            return checkpoint
        }
        guard checkpoint.status == .rendering else {
            if [.cancelled, .failed].contains(checkpoint.status) {
                throw NativeFinalCompositorStage1Error.terminalState(checkpoint.status)
            }
            throw NativeFinalCompositorStage1Error.invalidState(checkpoint.status)
        }
        guard checkpoint.nextSegmentIndex == checkpoint.totalSegmentCount else {
            throw NativeFinalCompositorStage1Error.incompleteSegments
        }
        guard Self.isValidArtifactIdentity(outputIdentity) else {
            throw NativeFinalCompositorStage1Error.invalidArtifactIdentity
        }
        checkpoint.status = .ready
        checkpoint.outputIdentity = outputIdentity
        return checkpoint
    }

    private static func validate(
        checkpoint: NativeFinalRenderCheckpointV1,
        for plan: NativeFinalRenderPlanV1
    ) throws {
        guard plan.schemaVersion == 1,
              plan.stage == .plannerCore,
              !plan.producesPlayableMedia,
              NativeFinalCompositorStage1Planner.isValidIdentity(plan.requestId),
              plan.requestRevision > 0,
              isSHA256Hex(plan.requestSha256),
              isSHA256Hex(plan.capabilitiesSha256),
              isSHA256Hex(plan.planSha256),
              isSHA256Hex(checkpoint.planSha256),
              checkpoint.planSha256 == plan.planSha256,
              try NativeFinalCompositorStage1Planner.planIdentitySha256(for: plan) == plan.planSha256,
              isSHA256Hex(checkpoint.requestSha256),
              checkpoint.totalSegmentCount == plan.segmentCheckpoints.count,
              checkpoint.nextSegmentIndex >= 0,
              checkpoint.nextSegmentIndex <= checkpoint.totalSegmentCount,
              checkpoint.completedSegments.count == checkpoint.nextSegmentIndex else {
            throw NativeFinalCompositorStage1Error.invalidCheckpoint
        }
        if checkpoint.status == .planned {
            guard checkpoint.nextSegmentIndex == 0,
                  checkpoint.completedSegments.isEmpty else {
                throw NativeFinalCompositorStage1Error.invalidCheckpoint
            }
        }
        for index in 0..<checkpoint.nextSegmentIndex {
            guard let identity = checkpoint.completedSegments[index], isValidArtifactIdentity(identity) else {
                throw NativeFinalCompositorStage1Error.invalidCheckpoint
            }
        }
        guard checkpoint.completedSegments.keys.allSatisfy({
            $0 >= 0 && $0 < checkpoint.nextSegmentIndex
        }) else {
            throw NativeFinalCompositorStage1Error.invalidCheckpoint
        }
        if checkpoint.status == .ready {
            guard checkpoint.nextSegmentIndex == checkpoint.totalSegmentCount,
                  checkpoint.outputIdentity.map(isValidArtifactIdentity) == true,
                  checkpoint.failureCode == nil else {
                throw NativeFinalCompositorStage1Error.invalidCheckpoint
            }
        } else {
            guard checkpoint.outputIdentity == nil else {
                throw NativeFinalCompositorStage1Error.invalidCheckpoint
            }
        }
        if checkpoint.status == .failed {
            guard checkpoint.failureCode.map(isValidFailureCode) == true else {
                throw NativeFinalCompositorStage1Error.invalidCheckpoint
            }
        } else {
            guard checkpoint.failureCode == nil else {
                throw NativeFinalCompositorStage1Error.invalidCheckpoint
            }
        }
    }

    private static func validate(plan: NativeFinalRenderPlanV1) throws {
        guard plan.schemaVersion == 1,
              plan.stage == .plannerCore,
              !plan.producesPlayableMedia,
              NativeFinalCompositorStage1Planner.isValidIdentity(plan.requestId),
              plan.requestRevision > 0,
              isSHA256Hex(plan.requestSha256),
              isSHA256Hex(plan.capabilitiesSha256),
              isSHA256Hex(plan.planSha256),
              try NativeFinalCompositorStage1Planner.planIdentitySha256(for: plan) == plan.planSha256,
              plan.outputDurationUs > 0,
              plan.outputDurationUs <= NativeFinalCompositorStage1Planner.maximumSourceDurationUs,
              !plan.timeMap.isEmpty,
              plan.timeMap.count <= NativeFinalCompositorStage1Planner.maximumKeepRangeCount,
              !plan.segmentCheckpoints.isEmpty,
              plan.resourceLimits.videoFramesInFlight > 0,
              plan.resourceLimits.videoFramesInFlight <= NativeFinalCompositorStage1Planner.maximumVideoFramesInFlight,
              plan.resourceLimits.audioFramesPerChunk > 0,
              plan.resourceLimits.audioFramesPerChunk <= NativeFinalCompositorStage1Planner.maximumAudioFramesPerChunk else {
            throw NativeFinalCompositorStage1Error.invalidCheckpoint
        }

        var expectedOutputStart: Int64 = 0
        var previousSourceEnd: Int64 = -1
        for entry in plan.timeMap {
            guard entry.sourceStartUs >= 0,
                  entry.sourceEndUs > entry.sourceStartUs,
                  entry.sourceEndUs <= NativeFinalCompositorStage1Planner.maximumSourceDurationUs,
                  entry.sourceStartUs >= previousSourceEnd,
                  entry.outputStartUs == expectedOutputStart,
                  entry.outputEndUs > entry.outputStartUs,
                  entry.sourceEndUs - entry.sourceStartUs == entry.outputEndUs - entry.outputStartUs else {
                throw NativeFinalCompositorStage1Error.invalidCheckpoint
            }
            previousSourceEnd = entry.sourceEndUs
            expectedOutputStart = entry.outputEndUs
        }
        guard expectedOutputStart == plan.outputDurationUs else {
            throw NativeFinalCompositorStage1Error.invalidCheckpoint
        }

        var expectedSegmentStart: Int64 = 0
        for (expectedIndex, segment) in plan.segmentCheckpoints.enumerated() {
            let remaining = plan.outputDurationUs - expectedSegmentStart
            let expectedDuration = min(NativeFinalCompositorStage1Planner.checkpointSegmentDurationUs, remaining)
            guard remaining > 0,
                  segment.index == expectedIndex,
                  segment.outputStartUs == expectedSegmentStart,
                  segment.outputEndUs == expectedSegmentStart + expectedDuration else {
                throw NativeFinalCompositorStage1Error.invalidCheckpoint
            }
            expectedSegmentStart = segment.outputEndUs
        }
        guard expectedSegmentStart == plan.outputDurationUs else {
            throw NativeFinalCompositorStage1Error.invalidCheckpoint
        }
    }

    private static func isValidArtifactIdentity(_ value: String) -> Bool {
        isSHA256Hex(value)
    }

    private static func isValidFailureCode(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 128 && value.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" || $0 == "."
        }
    }
}
