import Foundation

public enum RecordingContinuityIssueCode: String, Codable, Sendable {
    case missingRequiredTrack = "missing-required-track"
    case invalidSegmentMetadata = "invalid-segment-metadata"
    case nonContiguousIndex = "non-contiguous-index"
    case nonMonotonicTimeline = "non-monotonic-timeline"
    case gap
    case overlap
}

public struct RecordingContinuityIssue: Codable, Equatable, Sendable {
    public let code: RecordingContinuityIssueCode
    public let segmentIndex: Int?
    public let deltaUs: Int64?

    public init(
        code: RecordingContinuityIssueCode,
        segmentIndex: Int? = nil,
        deltaUs: Int64? = nil
    ) {
        self.code = code
        self.segmentIndex = segmentIndex
        self.deltaUs = deltaUs
    }
}

public struct RecordingTrackContinuityReport: Codable, Equatable, Sendable {
    public let track: RecordingTrackKind
    public let segmentCount: Int
    public let firstStartUs: Int64?
    public let endUs: Int64?
    public let maximumGapUs: Int64
    public let maximumOverlapUs: Int64
    public let issues: [RecordingContinuityIssue]
}

public struct RecordingContinuityReport: Encodable, Sendable {
    public let isValid: Bool
    public let requiredTracks: Set<RecordingTrackKind>
    public let tracks: [RecordingTrackKind: RecordingTrackContinuityReport]

    private enum CodingKeys: String, CodingKey {
        case isValid
        case requiredTracks
        case tracks
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(isValid, forKey: .isValid)
        try container.encode(
            requiredTracks.map(\.rawValue).sorted(),
            forKey: .requiredTracks
        )
        try container.encode(
            Dictionary(uniqueKeysWithValues: tracks.map { ($0.key.rawValue, $0.value) }),
            forKey: .tracks
        )
    }
}

public enum RecordingContinuityValidator {
    private static let videoGapToleranceUs: Int64 = 250_000
    private static let audioGapToleranceUs: Int64 = 100_000
    private static let overlapToleranceUs: Int64 = 100_000

    public static func validate(_ manifest: RecoverableRecordingManifest) -> RecordingContinuityReport {
        let requiredTracks = CaptureTrackRequirementPolicy.requiredTracks(
            capturesCamera: manifest.capture?.camera != nil,
            capturesMicrophone: manifest.capture?.capturesMicrophone == true
        )
        var reports: [RecordingTrackKind: RecordingTrackContinuityReport] = [:]
        for track in RecordingTrackKind.allCases {
            reports[track] = validateTrack(
                track,
                segments: manifest.tracks[track, default: []],
                required: requiredTracks.contains(track)
            )
        }
        return RecordingContinuityReport(
            isValid: reports.values.allSatisfy(\.issues.isEmpty),
            requiredTracks: requiredTracks,
            tracks: reports
        )
    }

    private static func validateTrack(
        _ track: RecordingTrackKind,
        segments: [FinalizedSegment],
        required: Bool
    ) -> RecordingTrackContinuityReport {
        var issues: [RecordingContinuityIssue] = []
        if required, segments.isEmpty {
            issues.append(RecordingContinuityIssue(code: .missingRequiredTrack))
        }
        var previousStartUs: Int64?
        var previousEndUs: Int64?
        var maximumGapUs: Int64 = 0
        var maximumOverlapUs: Int64 = 0
        let gapTolerance = gapToleranceUs(for: track)

        for (position, segment) in segments.enumerated() {
            if segment.index != position {
                issues.append(RecordingContinuityIssue(
                    code: .nonContiguousIndex,
                    segmentIndex: segment.index
                ))
            }
            if segment.index < 0 || segment.startUs < 0
                || segment.durationUs <= 0 || segment.byteLength <= 0
                || segment.relativePath.isEmpty {
                issues.append(RecordingContinuityIssue(
                    code: .invalidSegmentMetadata,
                    segmentIndex: segment.index
                ))
            }
            if let previousStartUs, segment.startUs < previousStartUs {
                issues.append(RecordingContinuityIssue(
                    code: .nonMonotonicTimeline,
                    segmentIndex: segment.index,
                    deltaUs: segment.startUs - previousStartUs
                ))
            }
            if let previousEndUs {
                let deltaUs = segment.startUs - previousEndUs
                if deltaUs > 0 { maximumGapUs = max(maximumGapUs, deltaUs) }
                if deltaUs < 0 { maximumOverlapUs = max(maximumOverlapUs, -deltaUs) }
                if deltaUs > gapTolerance {
                    issues.append(RecordingContinuityIssue(
                        code: .gap,
                        segmentIndex: segment.index,
                        deltaUs: deltaUs
                    ))
                } else if deltaUs < -overlapToleranceUs {
                    issues.append(RecordingContinuityIssue(
                        code: .overlap,
                        segmentIndex: segment.index,
                        deltaUs: deltaUs
                    ))
                }
            }
            previousStartUs = segment.startUs
            previousEndUs = segment.startUs + max(0, segment.durationUs)
        }

        return RecordingTrackContinuityReport(
            track: track,
            segmentCount: segments.count,
            firstStartUs: segments.first?.startUs,
            endUs: segments.last.map { $0.startUs + max(0, $0.durationUs) },
            maximumGapUs: maximumGapUs,
            maximumOverlapUs: maximumOverlapUs,
            issues: issues
        )
    }

    private static func gapToleranceUs(for track: RecordingTrackKind) -> Int64 {
        switch track {
        case .screen, .camera: videoGapToleranceUs
        case .microphone, .systemAudio: audioGapToleranceUs
        // Event tracks are intentionally sparse: a ten-second pause means the
        // teacher did not draw, not that media was lost.
        case .excalidrawEvents, .inputTelemetry: Int64.max
        }
    }
}
