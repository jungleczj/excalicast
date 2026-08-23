import Foundation
import MacMediaEngineCore

private struct Command: Decodable {
    let id: String
    let channel: String
    let protocolVersion: Int?
}

private struct Response: Encodable {
    let id: String
    let ok: Bool
    let protocolVersion: Int?
    let engine: String?
    let state: HelperState?
    let error: String?
}

private let decoder = JSONDecoder()
private let encoder = JSONEncoder()

while let line = readLine() {
    let response: Response
    do {
        let command = try decoder.decode(Command.self, from: Data(line.utf8))
        guard command.channel == "helper.handshake.v1" else {
            response = Response(id: command.id, ok: false, protocolVersion: nil, engine: nil, state: nil, error: "unsupported_channel")
            let data = try encoder.encode(response)
            print(String(decoding: data, as: UTF8.self))
            fflush(stdout)
            continue
        }
        let handshake = try HelperHandshake.negotiate(clientProtocolVersion: command.protocolVersion ?? 0)
        response = Response(id: command.id, ok: true, protocolVersion: handshake.protocolVersion, engine: handshake.engine, state: handshake.state, error: nil)
    } catch let error as HelperProtocolError {
        response = Response(id: "unknown", ok: false, protocolVersion: nil, engine: nil, state: nil, error: String(describing: error))
    } catch {
        response = Response(id: "unknown", ok: false, protocolVersion: nil, engine: nil, state: nil, error: "invalid_command")
    }
    let data = try encoder.encode(response)
    print(String(decoding: data, as: UTF8.self))
    fflush(stdout)
}
