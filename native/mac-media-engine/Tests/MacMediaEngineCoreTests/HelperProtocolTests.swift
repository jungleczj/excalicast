import Foundation
import MacMediaEngineCore

private enum ContractFailure: Error {
    case expectation(String)
}

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw ContractFailure.expectation(message) }
}

@main
struct MacMediaEngineContractTests {
    static func main() async throws {
        let handshake = try HelperHandshake.negotiate(clientProtocolVersion: 1)
        try expect(handshake.protocolVersion == 1, "protocol version")
        try expect(handshake.engine == "mac-media-engine", "engine name")
        try expect(handshake.state == .idle, "initial state")

        do {
            _ = try HelperHandshake.negotiate(clientProtocolVersion: 2)
            throw ContractFailure.expectation("unsupported protocol must fail")
        } catch HelperProtocolError.unsupportedProtocol(2) {
            // expected
        }

        let lifecycle = HelperLifecycle()
        try await lifecycle.start(sessionId: "recording-1")
        let first = await lifecycle.stop()
        let second = await lifecycle.stop()
        let stopCount = await lifecycle.stopCount
        try expect(first == .idle, "first stop")
        try expect(second == .idle, "idempotent stop")
        try expect(stopCount == 1, "single finalize")

        print("MacMediaEngine contract tests passed")
    }
}
