public struct CameraFormatCandidate: Equatable, Sendable {
    public let id: Int
    public let width: Int
    public let height: Int
    public let minimumFPS: Double
    public let maximumFPS: Double

    public init(
        id: Int,
        width: Int,
        height: Int,
        minimumFPS: Double,
        maximumFPS: Double
    ) {
        self.id = id
        self.width = width
        self.height = height
        self.minimumFPS = minimumFPS
        self.maximumFPS = maximumFPS
    }
}

public enum CameraFormatPolicy {
    public static func select(
        requestedWidth: Int,
        requestedHeight: Int,
        requestedFramesPerSecond: Int,
        candidates: [CameraFormatCandidate]
    ) -> CameraFormatCandidate? {
        let requestedFPS = Double(requestedFramesPerSecond)
        return candidates
            .filter {
                $0.width >= requestedWidth
                    && $0.height >= requestedHeight
                    && $0.minimumFPS <= requestedFPS
                    && $0.maximumFPS >= requestedFPS
            }
            .min {
                let lhsPixels = $0.width * $0.height
                let rhsPixels = $1.width * $1.height
                if lhsPixels != rhsPixels { return lhsPixels < rhsPixels }
                return $0.maximumFPS < $1.maximumFPS
            }
    }
}
