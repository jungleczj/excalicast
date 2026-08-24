import Foundation

public enum HelperState: String, Codable, Sendable {
    case idle
    case recording
    case paused
    case stopping
}

public enum HelperProtocolError: Error, Equatable, Sendable {
    case unsupportedProtocol(Int)
    case sessionAlreadyActive
}

public enum HelperCaptureCommandAdmissionState: Equatable, Sendable {
    case idle
    case starting
    case active
    case stopping
}

public enum HelperCaptureCommandAdmissionError: Error, Equatable, Sendable {
    case startInProgress
    case captureAlreadyActive
    case stopInProgress
}

public struct HelperCaptureCommandAdmission: Sendable {
    public private(set) var state: HelperCaptureCommandAdmissionState = .idle

    public init() {}

    public mutating func beginStart() throws {
        switch state {
        case .idle:
            state = .starting
        case .starting:
            throw HelperCaptureCommandAdmissionError.startInProgress
        case .active, .stopping:
            throw HelperCaptureCommandAdmissionError.captureAlreadyActive
        }
    }

    public mutating func startSucceeded() {
        guard state == .starting else { return }
        state = .active
    }

    public mutating func startFailed() {
        guard state == .starting else { return }
        state = .idle
    }

    public mutating func beginStop() throws {
        switch state {
        case .idle:
            return
        case .starting:
            throw HelperCaptureCommandAdmissionError.startInProgress
        case .active:
            state = .stopping
        case .stopping:
            throw HelperCaptureCommandAdmissionError.stopInProgress
        }
    }

    public mutating func stopFinished() {
        state = .idle
    }
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
        guard state == .recording || state == .paused else { return state }
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

    @discardableResult
    public func pause() -> HelperState {
        guard state == .recording else { return state }
        state = .paused
        return state
    }

    @discardableResult
    public func resume() -> HelperState {
        guard state == .paused else { return state }
        state = .recording
        return state
    }
}
