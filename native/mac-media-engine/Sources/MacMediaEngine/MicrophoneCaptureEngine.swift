@preconcurrency import AVFoundation
import Foundation
import MacMediaEngineCore

final class MicrophoneCaptureEngine: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate, @unchecked Sendable {
    private let captureQueue = DispatchQueue(label: "com.excalicast.capture.microphone", qos: .userInteractive)
    private let errorLock = NSLock()
    private var session: AVCaptureSession?
    private var output: AVCaptureAudioDataOutput?
    private var writer: AudioSegmentWriter?
    private var terminalError: Error?
    private let firstSampleGate = FirstMediaSampleGate()
    private var controls: CaptureControlState?
    var onSharedPCMSample: (@Sendable (CMSampleBuffer) -> Void)?

    func start(
        deviceID: String?,
        store: SegmentedRecordingStore,
        timeline: RecordingTimeline,
        controls: CaptureControlState
    ) throws {
        let device: AVCaptureDevice?
        if let deviceID {
            let discovery = AVCaptureDevice.DiscoverySession(
                deviceTypes: [.builtInMicrophone, .externalUnknown],
                mediaType: .audio,
                position: .unspecified
            )
            device = discovery.devices.first { $0.uniqueID == deviceID }
        } else {
            device = AVCaptureDevice.default(for: .audio)
        }
        guard let device else { throw NativeCaptureError.microphoneNotFound(deviceID) }
        let input = try AVCaptureDeviceInput(device: device)
        let output = AVCaptureAudioDataOutput()
        output.setSampleBufferDelegate(self, queue: captureQueue)
        let session = AVCaptureSession()
        session.beginConfiguration()
        guard session.canAddInput(input) else { throw NativeCaptureError.microphoneCannotAddInput }
        session.addInput(input)
        guard session.canAddOutput(output) else { throw NativeCaptureError.microphoneCannotAddOutput }
        session.addOutput(output)
        session.commitConfiguration()

        writer = AudioSegmentWriter(
            store: store,
            track: .microphone,
            channelCount: 1,
            bitRate: 128_000,
            timeline: timeline
        )
        self.output = output
        self.session = session
        self.controls = controls
        session.startRunning()
        guard session.isRunning else { throw NativeCaptureError.microphoneStartFailed }
        guard firstSampleGate.wait(timeout: 3) == .ready else {
            try throwTerminalErrorIfNeeded()
            throw NativeCaptureError.mediaTrackNotReady(.microphone)
        }
    }

    func stop() throws {
        var firstError: Error?
        output?.setSampleBufferDelegate(nil, queue: nil)
        session?.stopRunning()
        captureQueue.sync {}
        do { try throwTerminalErrorIfNeeded() } catch { firstError = error }
        do { try writer?.finishAndWait() } catch { if firstError == nil { firstError = error } }
        writer = nil
        output = nil
        session = nil
        controls = nil
        if let firstError { throw firstError }
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        do {
            guard let controls else { return }
            let muted = controls.snapshot().microphoneMuted
            guard let controlled = try ControlledSampleBuffer.audio(
                sampleBuffer,
                controls: controls,
                muted: muted
            ) else { return }
            try writer?.append(controlled)
            firstSampleGate.markReady()
            if !muted { onSharedPCMSample?(controlled) }
        } catch {
            recordTerminalError(error)
        }
    }

    private func recordTerminalError(_ error: Error) {
        errorLock.lock()
        if terminalError == nil { terminalError = error }
        errorLock.unlock()
        firstSampleGate.markFailed()
    }

    private func throwTerminalErrorIfNeeded() throws {
        errorLock.lock()
        let error = terminalError
        errorLock.unlock()
        if let error { throw error }
    }
}
