import Foundation

public struct NativeFinalNormalizedFrameV1: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public struct NativeFinalCompositorStage2ResourceLimitsV1: Codable, Equatable, Sendable {
    public let videoFramesInFlight: Int
    public let audioFramesPerChunk: Int

    public init(videoFramesInFlight: Int, audioFramesPerChunk: Int) {
        self.videoFramesInFlight = videoFramesInFlight
        self.audioFramesPerChunk = audioFramesPerChunk
    }
}

public struct NativeFinalCompositorStage2KeepRangeV1: Codable, Equatable, Sendable {
    public let startUs: Int64
    public let endUs: Int64

    public init(startUs: Int64, endUs: Int64) {
        self.startUs = startUs
        self.endUs = endUs
    }
}

public struct NativeFinalCompositorStage2RequestV1: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var requestID: String
    public var screenRelativePath: String
    public var cameraRelativePath: String?
    public var microphoneRelativePath: String?
    public var systemAudioRelativePath: String?
    public var teachingAudioRelativePath: String?
    public var chartRelativePath: String?
    public var outputRelativePath: String
    public var cameraFrame: NativeFinalNormalizedFrameV1
    public var chartFrame: NativeFinalNormalizedFrameV1
    public var motionGraphics: Bool
    public var limits: NativeFinalCompositorStage2ResourceLimitsV1
    public var stage1PlanSHA256: String
    public var sourceDurationUs: Int64
    public var keepRanges: [NativeFinalCompositorStage2KeepRangeV1]

    public init(
        schemaVersion: Int,
        requestID: String,
        screenRelativePath: String,
        cameraRelativePath: String?,
        microphoneRelativePath: String?,
        systemAudioRelativePath: String?,
        teachingAudioRelativePath: String?,
        chartRelativePath: String?,
        outputRelativePath: String,
        cameraFrame: NativeFinalNormalizedFrameV1,
        chartFrame: NativeFinalNormalizedFrameV1,
        motionGraphics: Bool,
        limits: NativeFinalCompositorStage2ResourceLimitsV1,
        stage1PlanSHA256: String,
        sourceDurationUs: Int64,
        keepRanges: [NativeFinalCompositorStage2KeepRangeV1]
    ) {
        self.schemaVersion = schemaVersion
        self.requestID = requestID
        self.screenRelativePath = screenRelativePath
        self.cameraRelativePath = cameraRelativePath
        self.microphoneRelativePath = microphoneRelativePath
        self.systemAudioRelativePath = systemAudioRelativePath
        self.teachingAudioRelativePath = teachingAudioRelativePath
        self.chartRelativePath = chartRelativePath
        self.outputRelativePath = outputRelativePath
        self.cameraFrame = cameraFrame
        self.chartFrame = chartFrame
        self.motionGraphics = motionGraphics
        self.limits = limits
        self.stage1PlanSHA256 = stage1PlanSHA256
        self.sourceDurationUs = sourceDurationUs
        self.keepRanges = keepRanges
    }
}

public struct NativeFinalCompositorStage2Validation: Equatable, Sendable {
    public let videoFramesInFlight: Int
    public let audioFramesPerChunk: Int
    public let checkpointIntervalUs: Int64
    public let producesPlayableMedia: Bool
    public let supportsInterruptedResume: Bool
}

public enum NativeFinalCompositorStage2Error: Error, Equatable, Sendable {
    case unsupportedSchemaVersion(Int)
    case unsupportedCheckpointSchemaVersion(Int)
    case invalidRequestIdentity
    case invalidOwnedPath
    case invalidOverlayFrame
    case invalidAudioTopology
    case motionGraphicsUnsupported
    case invalidResourceLimit
    case videoFrameLimitExceeded(requested: Int, maximum: Int)
    case audioFrameLimitExceeded(requested: Int, maximum: Int)
    case missingScreenTrack
    case missingCameraTrack(String)
    case missingAudioTrack(String)
    case chartDecodeFailed
    case readerSetupFailed
    case writerSetupFailed
    case readerFailed(String)
    case writerFailed(String)
    case audioChunkLimitExceeded(observed: Int, maximum: Int)
    case inputResourceLimitExceeded(String)
    case operationTimedOut(String)
    case cancelled
    case outputValidationFailed
    case outputIdentityConflict
}

public enum NativeFinalCompositorStage2 {
    public static let maximumSourceDurationUs: Int64 = 43_200_000_000
    public static let maximumKeepRangeCount = 65_536
    public static let maximumMediaInputBytes: Int64 = 549_755_813_888
    public static let maximumTotalInputBytes: Int64 = 1_099_511_627_776
    public static let maximumChartInputBytes: Int64 = 67_108_864
    public static let maximumVideoWidth: CGFloat = 7_680
    public static let maximumVideoHeight: CGFloat = 4_320
    public static let maximumVideoPixels: CGFloat = 33_177_600
    public static let minimumVideoFramesInFlight = 2
    public static let maximumVideoFramesInFlight = 3
    public static let maximumAudioFramesPerChunk = 4_096
    public static let checkpointIntervalUs: Int64 = 2_000_000

    public static func validate(
        _ request: NativeFinalCompositorStage2RequestV1
    ) throws -> NativeFinalCompositorStage2Validation {
        guard request.schemaVersion == 1 else {
            throw NativeFinalCompositorStage2Error.unsupportedSchemaVersion(request.schemaVersion)
        }
        guard validIdentifier(request.requestID) else {
            throw NativeFinalCompositorStage2Error.invalidRequestIdentity
        }
        guard isSHA256(request.stage1PlanSHA256),
              request.sourceDurationUs > 0,
              request.sourceDurationUs <= maximumSourceDurationUs else {
            throw NativeFinalCompositorStage2Error.invalidRequestIdentity
        }
        var previousEnd: Int64 = -1
        guard !request.keepRanges.isEmpty,
              request.keepRanges.count <= maximumKeepRangeCount,
              request.keepRanges.allSatisfy({ range in
                  defer { previousEnd = range.endUs }
                  return range.startUs >= 0
                      && range.endUs > range.startUs
                      && range.endUs <= request.sourceDurationUs
                      && range.startUs >= previousEnd
              }) else {
            throw NativeFinalCompositorStage2Error.invalidRequestIdentity
        }
        guard validOwnedPath(request.screenRelativePath, namespace: ["materialized"]),
              request.cameraRelativePath.map({ validOwnedPath($0, namespace: ["materialized"]) }) ?? true,
              request.microphoneRelativePath.map({ validOwnedPath($0, namespace: ["materialized"]) }) ?? true,
              request.systemAudioRelativePath.map({ validOwnedPath($0, namespace: ["materialized"]) }) ?? true,
              request.teachingAudioRelativePath.map({ validOwnedPath($0, namespace: ["teaching", "outputs"]) }) ?? true,
              request.chartRelativePath.map({ validOwnedPath($0, namespace: ["rendered-charts"], requiredExtension: "png") }) ?? true,
              validOwnedPath(request.outputRelativePath, namespace: ["final"], requiredExtension: "mp4") else {
            throw NativeFinalCompositorStage2Error.invalidOwnedPath
        }
        guard validFrame(request.cameraFrame), validFrame(request.chartFrame) else {
            throw NativeFinalCompositorStage2Error.invalidOverlayFrame
        }
        guard !request.motionGraphics else {
            throw NativeFinalCompositorStage2Error.motionGraphicsUnsupported
        }
        if request.teachingAudioRelativePath != nil,
           request.microphoneRelativePath != nil || request.systemAudioRelativePath != nil {
            throw NativeFinalCompositorStage2Error.invalidAudioTopology
        }
        guard request.limits.videoFramesInFlight >= minimumVideoFramesInFlight,
              request.limits.audioFramesPerChunk > 0 else {
            throw NativeFinalCompositorStage2Error.invalidResourceLimit
        }
        guard request.limits.videoFramesInFlight <= maximumVideoFramesInFlight else {
            throw NativeFinalCompositorStage2Error.videoFrameLimitExceeded(
                requested: request.limits.videoFramesInFlight,
                maximum: maximumVideoFramesInFlight
            )
        }
        guard request.limits.audioFramesPerChunk <= maximumAudioFramesPerChunk else {
            throw NativeFinalCompositorStage2Error.audioFrameLimitExceeded(
                requested: request.limits.audioFramesPerChunk,
                maximum: maximumAudioFramesPerChunk
            )
        }
        return .init(
            videoFramesInFlight: request.limits.videoFramesInFlight,
            audioFramesPerChunk: request.limits.audioFramesPerChunk,
            checkpointIntervalUs: checkpointIntervalUs,
            producesPlayableMedia: true,
            supportsInterruptedResume: false
        )
    }

    private static func validIdentifier(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 128 && value.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_"
        }
    }

    private static func isSHA256(_ value: String) -> Bool {
        value.utf8.count == 64 && value.unicodeScalars.allSatisfy {
            ($0.value >= 48 && $0.value <= 57) || ($0.value >= 97 && $0.value <= 102)
        }
    }

    private static func validOwnedPath(
        _ path: String,
        namespace: [String],
        requiredExtension: String? = nil
    ) -> Bool {
        guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\") else { return false }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == namespace.count + 1,
              Array(parts.dropLast()) == namespace,
              parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }),
              !parts.last!.hasPrefix(".") else { return false }
        if let requiredExtension {
            return URL(fileURLWithPath: parts.last!).pathExtension.lowercased() == requiredExtension
        }
        return true
    }

    private static func validFrame(_ frame: NativeFinalNormalizedFrameV1) -> Bool {
        let values = [frame.x, frame.y, frame.width, frame.height]
        return values.allSatisfy(\.isFinite)
            && frame.x >= 0 && frame.y >= 0
            && frame.width > 0 && frame.height > 0
            && frame.x + frame.width <= 1
            && frame.y + frame.height <= 1
    }
}
