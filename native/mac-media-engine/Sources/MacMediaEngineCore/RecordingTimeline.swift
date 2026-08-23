public struct RecordingTimeline: Codable, Equatable, Sendable {
    public let originUs: Int64

    public init(originUs: Int64) {
        self.originUs = originUs
    }

    public func relativeUs(for absoluteUs: Int64) -> Int64 {
        max(0, absoluteUs - originUs)
    }
}
