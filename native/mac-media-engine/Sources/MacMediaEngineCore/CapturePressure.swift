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
        pixelBufferSamples: Int
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
    }
}
