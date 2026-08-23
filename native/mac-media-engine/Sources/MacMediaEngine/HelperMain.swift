import Foundation
import MacMediaEngineCore
import AppKit
@preconcurrency import AVFoundation
import CoreGraphics
@preconcurrency import ScreenCaptureKit

private struct Command: Decodable, Sendable {
    let id: String
    let channel: String
    let protocolVersion: Int?
    let recordingId: String?
    let projectRoot: String?
    let displayID: UInt32?
    let sourceKind: String?
    let sourceID: UInt32?
    let width: Int?
    let height: Int?
    let framesPerSecond: Int?
    let codec: CaptureCodec?
    let captureSystemAudio: Bool?
    let captureMicrophone: Bool?
    let microphoneDeviceID: String?
    let captureCamera: Bool?
    let cameraDeviceID: String?
    let cameraWidth: Int?
    let cameraHeight: Int?
    let cameraFramesPerSecond: Int?
}

private struct Response: Encodable, Sendable {
    let id: String
    let ok: Bool
    let protocolVersion: Int?
    let engine: String?
    let state: HelperState?
    let capability: CapturePreflightReport?
    let sources: CaptureSources?
    let devices: CaptureDevices?
    let permissions: CapturePermissions?
    let pressure: CapturePressureSnapshot?
    let manifest: RecoverableRecordingManifest?
    let validation: RecordingProjectValidationReport?
    let error: String?
    let errorCode: String?
    let errorTrack: RecordingTrackKind?

    init(
        id: String,
        ok: Bool,
        protocolVersion: Int?,
        engine: String?,
        state: HelperState?,
        capability: CapturePreflightReport?,
        sources: CaptureSources?,
        devices: CaptureDevices?,
        permissions: CapturePermissions?,
        pressure: CapturePressureSnapshot?,
        manifest: RecoverableRecordingManifest?,
        validation: RecordingProjectValidationReport? = nil,
        error: String?,
        errorCode: String? = nil,
        errorTrack: RecordingTrackKind? = nil
    ) {
        self.id = id
        self.ok = ok
        self.protocolVersion = protocolVersion
        self.engine = engine
        self.state = state
        self.capability = capability
        self.sources = sources
        self.devices = devices
        self.permissions = permissions
        self.pressure = pressure
        self.manifest = manifest
        self.validation = validation
        self.error = error
        self.errorCode = errorCode
        self.errorTrack = errorTrack
    }
}

private struct CaptureFailureDescriptor {
    let message: String
    let code: String
    let track: RecordingTrackKind?
}

private enum CapturePermissionState: String, Encodable, Sendable {
    case granted
    case denied
    case restricted
    case notDetermined = "not-determined"
}

private struct CapturePermissions: Encodable, Sendable {
    let screen: CapturePermissionState
    let microphone: CapturePermissionState
    let camera: CapturePermissionState
}

private struct CaptureDisplaySource: Encodable, Sendable {
    let displayID: UInt32
    let width: Int
    let height: Int
}

private struct CaptureWindowSource: Encodable, Sendable {
    let windowID: UInt32
    let title: String
    let applicationName: String
    let width: Int
    let height: Int
}

private struct CaptureSources: Encodable, Sendable {
    let displays: [CaptureDisplaySource]
    let windows: [CaptureWindowSource]
}

private struct CaptureDeviceSource: Encodable, Sendable {
    let id: String
    let name: String
    let isDefault: Bool
}

private struct CaptureDevices: Encodable, Sendable {
    let microphones: [CaptureDeviceSource]
    let cameras: [CaptureDeviceSource]
}

private enum HelperServerError: Error {
    case unsupportedChannel(String)
    case missingCaptureParameters
    case captureAlreadyActive
    case captureAlreadyStopping
    case recoveryWhileCaptureActive
}

@available(macOS 13.0, *)
private actor HelperServer {
    private let lifecycle = HelperLifecycle()
    private var captureEngine: NativeCaptureSession?
    private var pressureMonitor: Task<Void, Never>?
    private var isStoppingCapture = false
    private var lastCaptureError: String?
    private var lastCaptureErrorCode: String?
    private var lastCaptureErrorTrack: RecordingTrackKind?
    private var lastPressureSnapshot: CapturePressureSnapshot?

    func handle(_ command: Command) async -> Response {
        do {
            switch command.channel {
            case "helper.handshake.v1":
                let handshake = try HelperHandshake.negotiate(
                    clientProtocolVersion: command.protocolVersion ?? 0
                )
                return Response(
                    id: command.id,
                    ok: true,
                    protocolVersion: handshake.protocolVersion,
                    engine: handshake.engine,
                    state: await lifecycle.state,
                    capability: nil,
                    sources: nil,
                    devices: nil,
                    permissions: nil,
                    pressure: nil,
                    manifest: nil,
                    error: nil
                )
            case "capture.permissions.v1":
                return await permissionResponse(command.id)
            case "capture.request-permissions.v1":
                _ = CGRequestScreenCaptureAccess()
                if command.captureMicrophone ?? false,
                   AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
                    _ = await AVCaptureDevice.requestAccess(for: .audio)
                }
                if command.captureCamera ?? false,
                   AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined {
                    _ = await AVCaptureDevice.requestAccess(for: .video)
                }
                return await permissionResponse(command.id)
            case "capture.sources.v1":
                let content = try await SCShareableContent.excludingDesktopWindows(
                    false,
                    onScreenWindowsOnly: true
                )
                let sources = CaptureSources(
                    displays: content.displays.map {
                        CaptureDisplaySource(
                            displayID: $0.displayID,
                            width: $0.width,
                            height: $0.height
                        )
                    },
                    windows: content.windows.compactMap { window in
                        guard window.frame.width > 1, window.frame.height > 1 else { return nil }
                        return CaptureWindowSource(
                            windowID: window.windowID,
                            title: window.title ?? "",
                            applicationName: window.owningApplication?.applicationName ?? "",
                            width: Int(window.frame.width),
                            height: Int(window.frame.height)
                        )
                    }
                )
                return Response(
                    id: command.id,
                    ok: true,
                    protocolVersion: HelperHandshake.currentProtocolVersion,
                    engine: "mac-media-engine",
                    state: await lifecycle.state,
                    capability: nil,
                    sources: sources,
                    devices: nil,
                    permissions: nil,
                    pressure: nil,
                    manifest: nil,
                    error: nil
                )
            case "capture.devices.v1":
                return Response(
                    id: command.id,
                    ok: true,
                    protocolVersion: HelperHandshake.currentProtocolVersion,
                    engine: "mac-media-engine",
                    state: await lifecycle.state,
                    capability: nil,
                    sources: nil,
                    devices: captureDevices(),
                    permissions: nil,
                    pressure: nil,
                    manifest: nil,
                    error: nil
                )
            case "project.recover.v1":
                guard await lifecycle.state == .idle else {
                    throw HelperServerError.recoveryWhileCaptureActive
                }
                guard let projectRoot = command.projectRoot else {
                    throw HelperServerError.missingCaptureParameters
                }
                let manifest = try SegmentedRecordingStore.recoverAndCheckpoint(
                    root: URL(fileURLWithPath: projectRoot, isDirectory: true)
                )
                return Response(
                    id: command.id,
                    ok: true,
                    protocolVersion: HelperHandshake.currentProtocolVersion,
                    engine: "mac-media-engine",
                    state: await lifecycle.state,
                    capability: nil,
                    sources: nil,
                    devices: nil,
                    permissions: nil,
                    pressure: nil,
                    manifest: manifest,
                    error: nil
                )
            case "project.validate.v1":
                guard await lifecycle.state == .idle else {
                    throw HelperServerError.recoveryWhileCaptureActive
                }
                guard let projectRoot = command.projectRoot else {
                    throw HelperServerError.missingCaptureParameters
                }
                let validation = try await RecordingProjectValidator.validate(
                    root: URL(fileURLWithPath: projectRoot, isDirectory: true)
                )
                return Response(
                    id: command.id,
                    ok: true,
                    protocolVersion: HelperHandshake.currentProtocolVersion,
                    engine: "mac-media-engine",
                    state: await lifecycle.state,
                    capability: nil,
                    sources: nil,
                    devices: nil,
                    permissions: nil,
                    pressure: nil,
                    manifest: nil,
                    validation: validation,
                    error: nil
                )
            case "capture.preflight.v1":
                let parameters = try captureParameters(from: command)
                let availableBytes = try availableBytes(at: parameters.projectRoot)
                let report = try CapturePreflight.evaluateSystem(
                    requested: parameters.request,
                    availableBytes: availableBytes
                )
                return success(command.id, state: await lifecycle.state, capability: report)
            case "capture.start.v1":
                guard captureEngine == nil, !isStoppingCapture else {
                    throw HelperServerError.captureAlreadyActive
                }
                let parameters = try captureParameters(from: command)
                let engine = NativeCaptureSession()
                try await lifecycle.start(sessionId: parameters.recordingId)
                do {
                    let report = try await engine.start(
                        configuration: NativeCaptureSession.Configuration(
                            recordingId: parameters.recordingId,
                            projectRoot: parameters.projectRoot,
                            source: parameters.source,
                            request: parameters.request,
                            captureSystemAudio: parameters.captureSystemAudio,
                            captureMicrophone: parameters.captureMicrophone,
                            microphoneDeviceID: parameters.microphoneDeviceID,
                            captureCamera: parameters.captureCamera,
                            cameraDeviceID: parameters.cameraDeviceID,
                            cameraRequest: parameters.cameraRequest
                        )
                    )
                    captureEngine = engine
                    lastCaptureError = nil
                    lastCaptureErrorCode = nil
                    lastCaptureErrorTrack = nil
                    lastPressureSnapshot = engine.pressureSnapshot()
                    startPressureMonitor(engine)
                    return success(command.id, state: .recording, capability: report)
                } catch {
                    _ = await lifecycle.stop()
                    throw error
                }
            case "capture.stop.v1":
                guard !isStoppingCapture else { throw HelperServerError.captureAlreadyStopping }
                pressureMonitor?.cancel()
                pressureMonitor = nil
                isStoppingCapture = true
                _ = await lifecycle.beginStopping()
                var stopError: Error?
                do { if let captureEngine { try await captureEngine.stop() } }
                catch { stopError = error }
                captureEngine = nil
                isStoppingCapture = false
                let state = await lifecycle.finishStopping()
                if let stopError {
                    let failure = captureFailureDescriptor(stopError)
                    lastCaptureError = failure.message
                    lastCaptureErrorCode = failure.code
                    lastCaptureErrorTrack = failure.track
                    throw stopError
                }
                lastCaptureError = nil
                lastCaptureErrorCode = nil
                lastCaptureErrorTrack = nil
                return success(command.id, state: state, capability: nil)
            case "capture.status.v1":
                let pressure = isStoppingCapture
                    ? lastPressureSnapshot
                    : captureEngine?.pressureSnapshot() ?? lastPressureSnapshot
                if let pressure { lastPressureSnapshot = pressure }
                return Response(
                    id: command.id,
                    ok: true,
                    protocolVersion: HelperHandshake.currentProtocolVersion,
                    engine: "mac-media-engine",
                    state: await lifecycle.state,
                    capability: nil,
                    sources: nil,
                    devices: nil,
                    permissions: nil,
                    pressure: pressure,
                    manifest: nil,
                    error: lastCaptureError,
                    errorCode: lastCaptureErrorCode,
                    errorTrack: lastCaptureErrorTrack
                )
            default:
                throw HelperServerError.unsupportedChannel(command.channel)
            }
        } catch {
            let failure = captureFailureDescriptor(error)
            return Response(
                id: command.id,
                ok: false,
                protocolVersion: nil,
                engine: nil,
                state: await lifecycle.state,
                capability: nil,
                sources: nil,
                devices: nil,
                permissions: nil,
                pressure: isStoppingCapture ? lastPressureSnapshot : captureEngine?.pressureSnapshot(),
                manifest: nil,
                error: failure.message,
                errorCode: failure.code,
                errorTrack: failure.track
            )
        }
    }

    func shutdown() async {
        pressureMonitor?.cancel()
        pressureMonitor = nil
        _ = await lifecycle.beginStopping()
        try? await captureEngine?.stop(interrupted: true)
        captureEngine = nil
        isStoppingCapture = false
        _ = await lifecycle.finishStopping()
    }

    private func startPressureMonitor(_ engine: NativeCaptureSession) {
        pressureMonitor?.cancel()
        pressureMonitor = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                guard !Task.isCancelled else { return }
                await self?.handlePressureTick(engine)
            }
        }
    }

    private func handlePressureTick(_ engine: NativeCaptureSession) async {
        guard captureEngine === engine, !isStoppingCapture else { return }
        let pressure = engine.pressureSnapshot()
        lastPressureSnapshot = pressure
        guard pressure.diskPressure == .critical else { return }
        isStoppingCapture = true
        pressureMonitor?.cancel()
        pressureMonitor = nil
        _ = await lifecycle.beginStopping()
        var reason = "critical_disk_space"
        do {
            try await engine.stop(interrupted: true)
        } catch {
            reason = "critical_disk_space: \(error)"
        }
        captureEngine = nil
        lastCaptureError = reason
        lastCaptureErrorCode = "critical_disk_space"
        lastCaptureErrorTrack = nil
        isStoppingCapture = false
        _ = await lifecycle.finishStopping()
    }

    private struct CaptureParameters {
        let recordingId: String
        let projectRoot: URL
        let source: CaptureSourceSelection
        let request: CaptureRequest
        let captureSystemAudio: Bool
        let captureMicrophone: Bool
        let microphoneDeviceID: String?
        let captureCamera: Bool
        let cameraDeviceID: String?
        let cameraRequest: CaptureRequest
    }

    private func captureParameters(from command: Command) throws -> CaptureParameters {
        guard let recordingId = command.recordingId,
              let projectRoot = command.projectRoot,
              let width = command.width,
              let height = command.height,
              let framesPerSecond = command.framesPerSecond,
              let codec = command.codec else {
            throw HelperServerError.missingCaptureParameters
        }
        guard let sourceID = command.sourceID ?? command.displayID else {
            throw HelperServerError.missingCaptureParameters
        }
        let source: CaptureSourceSelection
        switch command.sourceKind ?? "display" {
        case "display": source = .display(sourceID)
        case "window": source = .window(sourceID)
        default: throw HelperServerError.missingCaptureParameters
        }
        return CaptureParameters(
            recordingId: recordingId,
            projectRoot: URL(fileURLWithPath: projectRoot, isDirectory: true),
            source: source,
            request: CaptureRequest(
                width: width,
                height: height,
                framesPerSecond: framesPerSecond,
                codec: codec
            ),
            captureSystemAudio: command.captureSystemAudio ?? false,
            captureMicrophone: command.captureMicrophone ?? false,
            microphoneDeviceID: command.microphoneDeviceID,
            captureCamera: command.captureCamera ?? false,
            cameraDeviceID: command.cameraDeviceID,
            cameraRequest: CaptureRequest(
                width: command.cameraWidth ?? 1_280,
                height: command.cameraHeight ?? 720,
                framesPerSecond: command.cameraFramesPerSecond ?? 24,
                codec: .h264
            )
        )
    }

    private func availableBytes(at projectRoot: URL) throws -> Int64 {
        let values = try projectRoot.deletingLastPathComponent()
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values.volumeAvailableCapacityForImportantUsage ?? 0
    }

    private func success(
        _ id: String,
        state: HelperState,
        capability: CapturePreflightReport?
    ) -> Response {
        Response(
            id: id,
            ok: true,
            protocolVersion: HelperHandshake.currentProtocolVersion,
            engine: "mac-media-engine",
            state: state,
            capability: capability,
            sources: nil,
            devices: nil,
            permissions: nil,
            pressure: nil,
            manifest: nil,
            error: nil
        )
    }

    private func permissionResponse(_ id: String) async -> Response {
        Response(
            id: id,
            ok: true,
            protocolVersion: HelperHandshake.currentProtocolVersion,
            engine: "mac-media-engine",
            state: await lifecycle.state,
            capability: nil,
            sources: nil,
            devices: nil,
            permissions: CapturePermissions(
                screen: CGPreflightScreenCaptureAccess() ? .granted : .notDetermined,
                microphone: permissionState(for: .audio),
                camera: permissionState(for: .video)
            ),
            pressure: nil,
            manifest: nil,
            error: nil
        )
    }

    private func permissionState(for mediaType: AVMediaType) -> CapturePermissionState {
        switch AVCaptureDevice.authorizationStatus(for: mediaType) {
        case .authorized: return .granted
        case .denied: return .denied
        case .restricted: return .restricted
        case .notDetermined: return .notDetermined
        @unknown default: return .denied
        }
    }

    private func captureDevices() -> CaptureDevices {
        let microphoneDefaultID = AVCaptureDevice.default(for: .audio)?.uniqueID
        let microphones = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInMicrophone, .externalUnknown],
            mediaType: .audio,
            position: .unspecified
        ).devices.map {
            CaptureDeviceSource(
                id: $0.uniqueID,
                name: $0.localizedName,
                isDefault: $0.uniqueID == microphoneDefaultID
            )
        }
        var cameraTypes: [AVCaptureDevice.DeviceType] = [.builtInWideAngleCamera, .externalUnknown]
        if #available(macOS 14.0, *) { cameraTypes.append(.continuityCamera) }
        let cameraDefaultID = AVCaptureDevice.default(for: .video)?.uniqueID
        let cameras = AVCaptureDevice.DiscoverySession(
            deviceTypes: cameraTypes,
            mediaType: .video,
            position: .unspecified
        ).devices.map {
            CaptureDeviceSource(
                id: $0.uniqueID,
                name: $0.localizedName,
                isDefault: $0.uniqueID == cameraDefaultID
            )
        }
        return CaptureDevices(
            microphones: microphones.sorted(by: deviceSort),
            cameras: cameras.sorted(by: deviceSort)
        )
    }

    private func deviceSort(_ lhs: CaptureDeviceSource, _ rhs: CaptureDeviceSource) -> Bool {
        if lhs.isDefault != rhs.isDefault { return lhs.isDefault }
        return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
    }

    private func captureFailureDescriptor(_ error: Error) -> CaptureFailureDescriptor {
        switch error {
        case NativeCaptureError.mediaTrackNotReady(let track):
            return CaptureFailureDescriptor(
                message: "The enabled \(track.rawValue) track did not deliver encodable media before startup timed out.",
                code: "capture_track_not_ready",
                track: track
            )
        case RecordingStoreError.missingRequiredTrack(let track):
            return CaptureFailureDescriptor(
                message: "The enabled \(track.rawValue) track produced no recoverable media segment.",
                code: "capture_required_track_empty",
                track: track
            )
        case NativeCaptureError.cameraPermissionRequired:
            return CaptureFailureDescriptor(
                message: "Camera permission is required before camera recording can start.",
                code: "camera_permission_required",
                track: .camera
            )
        case NativeCaptureError.microphonePermissionRequired:
            return CaptureFailureDescriptor(
                message: "Microphone permission is required before microphone recording can start.",
                code: "microphone_permission_required",
                track: .microphone
            )
        case NativeCaptureError.captureSourceUnavailableOrProtected:
            return CaptureFailureDescriptor(
                message: "The selected screen source is unavailable or protected.",
                code: "capture_source_unavailable_or_protected",
                track: .screen
            )
        default:
            return CaptureFailureDescriptor(
                message: String(describing: error),
                code: "native_capture_failed",
                track: nil
            )
        }
    }
}

@main
private struct MacMediaEngineMain {
    @MainActor
    static func main() {
        guard #available(macOS 13.0, *) else { return }
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        let server = HelperServer()
        Task.detached(priority: .userInitiated) {
            await runCommandLoop(server: server)
            await server.shutdown()
            await MainActor.run { NSApplication.shared.terminate(nil) }
        }
        application.run()
    }

    @available(macOS 13.0, *)
    private static func runCommandLoop(server: HelperServer) async {
        let decoder = JSONDecoder()
        let encoder = JSONEncoder()

        while let line = readLine() {
            let response: Response
            do {
                let command = try decoder.decode(Command.self, from: Data(line.utf8))
                response = await server.handle(command)
            } catch {
                response = Response(
                    id: "unknown",
                    ok: false,
                    protocolVersion: nil,
                    engine: nil,
                    state: nil,
                    capability: nil,
                    sources: nil,
                    devices: nil,
                    permissions: nil,
                    pressure: nil,
                    manifest: nil,
                    error: "invalid_command"
                )
            }
            do {
                let data = try encoder.encode(response)
                print(String(decoding: data, as: UTF8.self))
                fflush(stdout)
            } catch {
                break
            }
        }
    }
}
