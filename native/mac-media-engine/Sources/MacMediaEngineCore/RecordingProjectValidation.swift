import Foundation

public struct RecordingSegmentValidation: Codable, Equatable, Sendable {
    public let track: RecordingTrackKind
    public let index: Int
    public let relativePath: String
    public let expectedCodec: String
    public let actualCodec: String?
    public let durationUs: Int64
    public let byteLength: Int
    public let isDecodable: Bool
    public let issue: String?

    public init(
        track: RecordingTrackKind,
        index: Int,
        relativePath: String,
        expectedCodec: String,
        actualCodec: String?,
        durationUs: Int64,
        byteLength: Int,
        isDecodable: Bool,
        issue: String?
    ) {
        self.track = track
        self.index = index
        self.relativePath = relativePath
        self.expectedCodec = expectedCodec
        self.actualCodec = actualCodec
        self.durationUs = durationUs
        self.byteLength = byteLength
        self.isDecodable = isDecodable
        self.issue = issue
    }
}

public struct RecordingProjectValidationReport: Encodable, Sendable {
    public let isValid: Bool
    public let manifestState: RecordingStoreState
    public let continuity: RecordingContinuityReport
    public let segments: [RecordingSegmentValidation]

    public init(
        isValid: Bool,
        manifestState: RecordingStoreState,
        continuity: RecordingContinuityReport,
        segments: [RecordingSegmentValidation]
    ) {
        self.isValid = isValid
        self.manifestState = manifestState
        self.continuity = continuity
        self.segments = segments
    }
}
