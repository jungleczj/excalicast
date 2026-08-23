import Foundation

public enum HelperState: String, Codable, Sendable {
    case idle
    case recording
    case stopping
}

public enum HelperProtocolError: Error, Equatable, Sendable {
    case unsupportedProtocol(Int)
    case sessionAlreadyActive
}

public struct HelperHandshake: Codable, Equatable, Sendable {
    public static let currentProtocolVersion = 1

    public let protocolVersion: Int
    public let engine: String
    public let state: HelperState

    public static func negotiate(clientProtocolVersion: Int) throws -> HelperHandshake {
        guard clientProtocolVersion == currentProtocolVersion else {
            throw HelperProtocolError.unsupportedProtocol(clientProtocolVersion)
        }
        return HelperHandshake(
            protocolVersion: currentProtocolVersion,
            engine: "mac-media-engine",
            state: .idle
        )
    }
}

public actor HelperLifecycle {
    public private(set) var state: HelperState = .idle
    public private(set) var stopCount = 0
    private var sessionId: String?

    public init() {}

    public func start(sessionId: String) throws {
        guard state == .idle else { throw HelperProtocolError.sessionAlreadyActive }
        self.sessionId = sessionId
        state = .recording
    }

    @discardableResult
    public func beginStopping() -> HelperState {
        guard state == .recording else { return state }
        state = .stopping
        sessionId = nil
        stopCount += 1
        return state
    }

    @discardableResult
    public func finishStopping() -> HelperState {
        guard state == .stopping else { return state }
        state = .idle
        return state
    }

    @discardableResult
    public func stop() -> HelperState {
        _ = beginStopping()
        return finishStopping()
    }
}
