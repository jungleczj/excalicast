import Foundation

public enum CameraHardwareState: String, Codable, Sendable {
    case active
    case off
}

public struct CaptureControlSnapshot: Codable, Equatable, Sendable {
    public let paused: Bool
    public let microphoneMuted: Bool
    public let systemAudioMuted: Bool
    public let cameraHidden: Bool
    public let cameraHardwareState: CameraHardwareState
    /** True only while the AVCaptureSession camera device is running. */
    public let cameraPhysicallyPowered: Bool
}

public final class CaptureControlState: @unchecked Sendable {
    private let lock = NSLock()
    private var paused = false
    private var pauseStartedUs: Int64 = 0
    private var pausedTotalUs: Int64 = 0
    private var resumeCutoffUs: Int64 = 0
    private var microphoneMuted = false
    private var systemAudioMuted = false
    private var cameraHidden = false
    private var cameraHardwareState: CameraHardwareState = .active

    public init() {}

    @discardableResult
    public func pause(atUs: Int64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !paused else { return false }
        paused = true
        pauseStartedUs = max(0, atUs)
        return true
    }

    @discardableResult
    public func resume(atUs: Int64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard paused else { return false }
        let resumedAt = max(pauseStartedUs, atUs)
        pausedTotalUs += resumedAt - pauseStartedUs
        resumeCutoffUs = resumedAt
        pauseStartedUs = 0
        paused = false
        return true
    }

    /** Returns a compacted source timestamp, or nil while paused/pre-resume queued. */
    public func adjustedPresentationUs(_ sourceUs: Int64) -> Int64? {
        lock.lock()
        defer { lock.unlock() }
        guard !paused, sourceUs >= resumeCutoffUs else { return nil }
        return max(0, sourceUs - pausedTotalUs)
    }

    public func setMicrophoneMuted(_ value: Bool) {
        lock.lock(); microphoneMuted = value; lock.unlock()
    }

    public func setSystemAudioMuted(_ value: Bool) {
        lock.lock(); systemAudioMuted = value; lock.unlock()
    }

    public func setCameraHidden(_ value: Bool) {
        lock.lock(); cameraHidden = value; lock.unlock()
    }

    public func setCameraHardwareEnabled(_ enabled: Bool) {
        lock.lock(); cameraHardwareState = enabled ? .active : .off; lock.unlock()
    }

    public func snapshot() -> CaptureControlSnapshot {
        lock.lock()
        defer { lock.unlock() }
        return CaptureControlSnapshot(
            paused: paused,
            microphoneMuted: microphoneMuted,
            systemAudioMuted: systemAudioMuted,
            cameraHidden: cameraHidden,
            cameraHardwareState: cameraHardwareState,
            cameraPhysicallyPowered: cameraHardwareState == .active
        )
    }
}
