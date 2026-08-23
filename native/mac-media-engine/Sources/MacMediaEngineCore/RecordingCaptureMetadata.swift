public struct RecordingCaptureMetadata: Codable, Equatable, Sendable {
    public let screen: CaptureRequest
    public let camera: CaptureRequest?
    public let capturesSystemAudio: Bool
    public let capturesMicrophone: Bool
    public let hardwareEncodingConfirmed: Bool
    public let initialAvailableBytes: Int64
    public let finalPressure: CapturePressureSnapshot?

    public init(
        screen: CaptureRequest,
        camera: CaptureRequest?,
        capturesSystemAudio: Bool,
        capturesMicrophone: Bool,
        hardwareEncodingConfirmed: Bool,
        initialAvailableBytes: Int64,
        finalPressure: CapturePressureSnapshot?
    ) {
        self.screen = screen
        self.camera = camera
        self.capturesSystemAudio = capturesSystemAudio
        self.capturesMicrophone = capturesMicrophone
        self.hardwareEncodingConfirmed = hardwareEncodingConfirmed
        self.initialAvailableBytes = initialAvailableBytes
        self.finalPressure = finalPressure
    }

    public func withFinalPressure(_ pressure: CapturePressureSnapshot) -> RecordingCaptureMetadata {
        RecordingCaptureMetadata(
            screen: screen,
            camera: camera,
            capturesSystemAudio: capturesSystemAudio,
            capturesMicrophone: capturesMicrophone,
            hardwareEncodingConfirmed: hardwareEncodingConfirmed,
            initialAvailableBytes: initialAvailableBytes,
            finalPressure: pressure
        )
    }
}
