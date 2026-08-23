public enum CaptureDiskPressureLevel: String, Codable, Equatable, Sendable {
    case normal
    case warning
    case critical
}

public enum CaptureDiskPressurePolicy {
    public static let warningAvailableBytes: Int64 = 5 * 1_024 * 1_024 * 1_024
    public static let criticalAvailableBytes: Int64 = 1 * 1_024 * 1_024 * 1_024

    public static func classify(availableBytes: Int64) -> CaptureDiskPressureLevel {
        if availableBytes <= criticalAvailableBytes { return .critical }
        if availableBytes <= warningAvailableBytes { return .warning }
        return .normal
    }
}

public struct RecordingStorePressureSnapshot: Codable, Equatable, Sendable {
    public let pendingWriteBytes: Int
    public let committedBytes: Int
    public let lastCommitLatencyMs: Double
    public let maximumCommitLatencyMs: Double

    public init(
        pendingWriteBytes: Int,
        committedBytes: Int,
        lastCommitLatencyMs: Double,
        maximumCommitLatencyMs: Double
    ) {
        self.pendingWriteBytes = pendingWriteBytes
        self.committedBytes = committedBytes
        self.lastCommitLatencyMs = lastCommitLatencyMs
        self.maximumCommitLatencyMs = maximumCommitLatencyMs
    }
}

public struct CapturePressureSnapshot: Codable, Equatable, Sendable {
    public let receivedScreenSamples: Int
    public let submittedVideoFrames: Int
    public let encodedVideoFrames: Int
    public let droppedPendingFrames: Int
    public let pendingEncoderFrames: Int
    public let completeSamples: Int
    public let idleSamples: Int
    public let blankSamples: Int
    public let suspendedSamples: Int
    public let pixelBufferSamples: Int
    public let availableDiskBytes: Int64
    public let diskPressure: CaptureDiskPressureLevel
    public let pendingWriteBytes: Int
    public let committedBytes: Int
    public let lastSegmentWriteLatencyMs: Double
    public let maximumSegmentWriteLatencyMs: Double

    public init(
        receivedScreenSamples: Int,
        submittedVideoFrames: Int,
        encodedVideoFrames: Int,
        droppedPendingFrames: Int,
        pendingEncoderFrames: Int,
        completeSamples: Int,
        idleSamples: Int,
        blankSamples: Int,
        suspendedSamples: Int,
        pixelBufferSamples: Int,
        availableDiskBytes: Int64 = 0,
        diskPressure: CaptureDiskPressureLevel = .normal,
        pendingWriteBytes: Int = 0,
        committedBytes: Int = 0,
        lastSegmentWriteLatencyMs: Double = 0,
        maximumSegmentWriteLatencyMs: Double = 0
    ) {
        self.receivedScreenSamples = receivedScreenSamples
        self.submittedVideoFrames = submittedVideoFrames
        self.encodedVideoFrames = encodedVideoFrames
        self.droppedPendingFrames = droppedPendingFrames
        self.pendingEncoderFrames = pendingEncoderFrames
        self.completeSamples = completeSamples
        self.idleSamples = idleSamples
        self.blankSamples = blankSamples
        self.suspendedSamples = suspendedSamples
        self.pixelBufferSamples = pixelBufferSamples
        self.availableDiskBytes = availableDiskBytes
        self.diskPressure = diskPressure
        self.pendingWriteBytes = pendingWriteBytes
        self.committedBytes = committedBytes
        self.lastSegmentWriteLatencyMs = lastSegmentWriteLatencyMs
        self.maximumSegmentWriteLatencyMs = maximumSegmentWriteLatencyMs
    }

    public func enriched(
        availableDiskBytes: Int64,
        store: RecordingStorePressureSnapshot
    ) -> CapturePressureSnapshot {
        CapturePressureSnapshot(
            receivedScreenSamples: receivedScreenSamples,
            submittedVideoFrames: submittedVideoFrames,
            encodedVideoFrames: encodedVideoFrames,
            droppedPendingFrames: droppedPendingFrames,
            pendingEncoderFrames: pendingEncoderFrames,
            completeSamples: completeSamples,
            idleSamples: idleSamples,
            blankSamples: blankSamples,
            suspendedSamples: suspendedSamples,
            pixelBufferSamples: pixelBufferSamples,
            availableDiskBytes: availableDiskBytes,
            diskPressure: CaptureDiskPressurePolicy.classify(availableBytes: availableDiskBytes),
            pendingWriteBytes: store.pendingWriteBytes,
            committedBytes: store.committedBytes,
            lastSegmentWriteLatencyMs: store.lastCommitLatencyMs,
            maximumSegmentWriteLatencyMs: store.maximumCommitLatencyMs
        )
    }
}
