public enum InitialFrameSeedPolicy {
    public static func shouldSeed(streamCompleteFrames: Int, seededFrames: Int) -> Bool {
        streamCompleteFrames == 0 && seededFrames == 0
    }

    public static func shouldEmitHeartbeat(elapsedSinceLastFrameUs: Int64) -> Bool {
        elapsedSinceLastFrameUs >= CaptureEncodingPolicy.segmentDurationUs
    }

    public static func heartbeatPresentationTimes(
        lastFrameUs: Int64,
        nowUs: Int64,
        framesPerSecond: Int,
        forceFinalFrame: Bool
    ) -> [Int64] {
        guard nowUs > lastFrameUs else { return [] }
        let frameDurationUs = max(1, 1_000_000 / Int64(max(1, framesPerSecond)))
        var times: [Int64] = []
        var boundaryUs = lastFrameUs
        var emittedBoundaries = 0
        let maximumCatchUpBoundaries = 4
        while nowUs - boundaryUs >= CaptureEncodingPolicy.segmentDurationUs,
              emittedBoundaries < maximumCatchUpBoundaries {
            boundaryUs += CaptureEncodingPolicy.segmentDurationUs
            let bridgeUs = boundaryUs - frameDurationUs
            if bridgeUs > (times.last ?? lastFrameUs) { times.append(bridgeUs) }
            times.append(boundaryUs)
            emittedBoundaries += 1
        }
        if forceFinalFrame, nowUs > (times.last ?? lastFrameUs) {
            times.append(nowUs)
        }
        return times
    }

    public static func isLikelyProtectedBlackFrame(
        sampledColorComponents: [UInt8]
    ) -> Bool {
        !sampledColorComponents.isEmpty
            && sampledColorComponents.allSatisfy { $0 <= 8 }
    }
}
