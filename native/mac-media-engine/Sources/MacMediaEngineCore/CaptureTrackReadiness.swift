import Foundation

public enum CaptureTrackRequirementPolicy {
    public static func requiredTracks(
        capturesCamera: Bool,
        capturesMicrophone: Bool
    ) -> Set<RecordingTrackKind> {
        var tracks: Set<RecordingTrackKind> = [.screen]
        if capturesCamera { tracks.insert(.camera) }
        if capturesMicrophone { tracks.insert(.microphone) }
        return tracks
    }
}

public enum FirstMediaSampleOutcome: Equatable, Sendable {
    case ready
    case failed
    case timedOut
}

/// A single-use, thread-safe startup gate shared by an AVFoundation callback
/// queue and the helper command queue. A session is not reported as recording
/// until an enabled device has delivered media into its processing pipeline.
public final class FirstMediaSampleGate: @unchecked Sendable {
    private enum State {
        case pending
        case ready
        case failed
    }

    private let condition = NSCondition()
    private var state: State = .pending

    public init() {}

    public func markReady() {
        resolve(as: .ready)
    }

    public func markFailed() {
        resolve(as: .failed)
    }

    public func wait(timeout: TimeInterval) -> FirstMediaSampleOutcome {
        let deadline = Date(timeIntervalSinceNow: max(0, timeout))
        condition.lock()
        while state == .pending, condition.wait(until: deadline) {}
        let outcome: FirstMediaSampleOutcome
        switch state {
        case .ready: outcome = .ready
        case .failed: outcome = .failed
        case .pending: outcome = .timedOut
        }
        condition.unlock()
        return outcome
    }

    private func resolve(as nextState: State) {
        condition.lock()
        if state == .pending {
            state = nextState
            condition.broadcast()
        }
        condition.unlock()
    }
}
