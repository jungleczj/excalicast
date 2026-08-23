public enum InitialFrameSeedPolicy {
    public static func shouldSeed(streamCompleteFrames: Int, seededFrames: Int) -> Bool {
        streamCompleteFrames == 0 && seededFrames == 0
    }

    public static func shouldEmitHeartbeat(elapsedSinceLastFrameUs: Int64) -> Bool {
        elapsedSinceLastFrameUs >= CaptureEncodingPolicy.segmentDurationUs
    }

    public static func isLikelyProtectedBlackFrame(
        sampledColorComponents: [UInt8]
    ) -> Bool {
        !sampledColorComponents.isEmpty
            && sampledColorComponents.allSatisfy { $0 <= 8 }
    }
}
