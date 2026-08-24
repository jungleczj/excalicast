public struct NativeInputTelemetryCaptureMetadata: Codable, Equatable, Sendable {
    public let requested: Bool
    public let available: Bool
    public let producerSchemaVersion: Int?
    public let coordinateSpaceVersion: Int?
    public let terminalError: String?
    public let capturedEventCount: Int64
    public let coalescedEventCount: Int64
    public let droppedEventCount: Int64

    public init(
        requested: Bool,
        available: Bool,
        producerSchemaVersion: Int?,
        coordinateSpaceVersion: Int?,
        terminalError: String?,
        capturedEventCount: Int64,
        coalescedEventCount: Int64,
        droppedEventCount: Int64
    ) {
        self.requested = requested
        self.available = available
        self.producerSchemaVersion = producerSchemaVersion
        self.coordinateSpaceVersion = coordinateSpaceVersion
        self.terminalError = terminalError
        self.capturedEventCount = capturedEventCount
        self.coalescedEventCount = coalescedEventCount
        self.droppedEventCount = droppedEventCount
    }
}

public struct RecordingCaptureMetadata: Codable, Equatable, Sendable {
    public let screen: CaptureRequest
    public let camera: CaptureRequest?
    public let capturesSystemAudio: Bool
    public let capturesMicrophone: Bool
    public let hardwareEncodingConfirmed: Bool
    public let initialAvailableBytes: Int64
    public let finalPressure: CapturePressureSnapshot?
    public let inputTelemetry: NativeInputTelemetryCaptureMetadata?

    public init(
        screen: CaptureRequest,
        camera: CaptureRequest?,
        capturesSystemAudio: Bool,
        capturesMicrophone: Bool,
        hardwareEncodingConfirmed: Bool,
        initialAvailableBytes: Int64,
        finalPressure: CapturePressureSnapshot?,
        inputTelemetry: NativeInputTelemetryCaptureMetadata? = nil
    ) {
        self.screen = screen
        self.camera = camera
        self.capturesSystemAudio = capturesSystemAudio
        self.capturesMicrophone = capturesMicrophone
        self.hardwareEncodingConfirmed = hardwareEncodingConfirmed
        self.initialAvailableBytes = initialAvailableBytes
        self.finalPressure = finalPressure
        self.inputTelemetry = inputTelemetry
    }

    public func withFinalPressure(_ pressure: CapturePressureSnapshot) -> RecordingCaptureMetadata {
        RecordingCaptureMetadata(
            screen: screen,
            camera: camera,
            capturesSystemAudio: capturesSystemAudio,
            capturesMicrophone: capturesMicrophone,
            hardwareEncodingConfirmed: hardwareEncodingConfirmed,
            initialAvailableBytes: initialAvailableBytes,
            finalPressure: pressure,
            inputTelemetry: inputTelemetry
        )
    }

    public func withInputTelemetry(_ telemetry: NativeInputTelemetryCaptureMetadata) -> RecordingCaptureMetadata {
        RecordingCaptureMetadata(
            screen: screen,
            camera: camera,
            capturesSystemAudio: capturesSystemAudio,
            capturesMicrophone: capturesMicrophone,
            hardwareEncodingConfirmed: hardwareEncodingConfirmed,
            initialAvailableBytes: initialAvailableBytes,
            finalPressure: finalPressure,
            inputTelemetry: telemetry
        )
    }
}
