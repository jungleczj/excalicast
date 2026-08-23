import Foundation
import MacMediaEngineCore
@preconcurrency import ScreenCaptureKit

private struct Command: Decodable {
    let id: String
    let channel: String
    let protocolVersion: Int?
    let recordingId: String?
    let projectRoot: String?
    let displayID: UInt32?
    let width: Int?
    let height: Int?
    let framesPerSecond: Int?
    let codec: CaptureCodec?
}

private struct Response: Encodable {
    let id: String
    let ok: Bool
    let protocolVersion: Int?
    let engine: String?
    let state: HelperState?
    let capability: CapturePreflightReport?
    let sources: CaptureSources?
    let error: String?
}

private struct CaptureDisplaySource: Encodable {
    let displayID: UInt32
    let width: Int
    let height: Int
}

private struct CaptureWindowSource: Encodable {
    let windowID: UInt32
    let title: String
    let applicationName: String
    let width: Int
    let height: Int
}

private struct CaptureSources: Encodable {
    let displays: [CaptureDisplaySource]
    let windows: [CaptureWindowSource]
}

private enum HelperServerError: Error {
    case unsupportedChannel(String)
    case missingCaptureParameters
    case captureAlreadyActive
}

@available(macOS 13.0, *)
private actor HelperServer {
    private let lifecycle = HelperLifecycle()
    private var captureEngine: ScreenCaptureEngine?

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
                    error: nil
                )
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
                guard captureEngine == nil else { throw HelperServerError.captureAlreadyActive }
                let parameters = try captureParameters(from: command)
                let engine = ScreenCaptureEngine()
                try await lifecycle.start(sessionId: parameters.recordingId)
                do {
                    let report = try await engine.start(
                        displayID: parameters.displayID,
                        request: parameters.request,
                        projectRoot: parameters.projectRoot,
                        recordingId: parameters.recordingId
                    )
                    captureEngine = engine
                    return success(command.id, state: .recording, capability: report)
                } catch {
                    _ = await lifecycle.stop()
                    throw error
                }
            case "capture.stop.v1":
                if let captureEngine { try await captureEngine.stop() }
                captureEngine = nil
                let state = await lifecycle.stop()
                return success(command.id, state: state, capability: nil)
            case "capture.status.v1":
                return success(command.id, state: await lifecycle.state, capability: nil)
            default:
                throw HelperServerError.unsupportedChannel(command.channel)
            }
        } catch {
            return Response(
                id: command.id,
                ok: false,
                protocolVersion: nil,
                engine: nil,
                state: await lifecycle.state,
                capability: nil,
                sources: nil,
                error: String(describing: error)
            )
        }
    }

    func shutdown() async {
        try? await captureEngine?.stop()
        captureEngine = nil
        _ = await lifecycle.stop()
    }

    private struct CaptureParameters {
        let recordingId: String
        let projectRoot: URL
        let displayID: UInt32
        let request: CaptureRequest
    }

    private func captureParameters(from command: Command) throws -> CaptureParameters {
        guard let recordingId = command.recordingId,
              let projectRoot = command.projectRoot,
              let displayID = command.displayID,
              let width = command.width,
              let height = command.height,
              let framesPerSecond = command.framesPerSecond,
              let codec = command.codec else {
            throw HelperServerError.missingCaptureParameters
        }
        return CaptureParameters(
            recordingId: recordingId,
            projectRoot: URL(fileURLWithPath: projectRoot, isDirectory: true),
            displayID: displayID,
            request: CaptureRequest(
                width: width,
                height: height,
                framesPerSecond: framesPerSecond,
                codec: codec
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
            error: nil
        )
    }
}

@main
private struct MacMediaEngineMain {
    static func main() async {
        guard #available(macOS 13.0, *) else { return }
        let server = HelperServer()
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
        await server.shutdown()
    }
}
