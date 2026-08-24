import Foundation
import MacMediaEngineCore

public protocol NativeInputDisplayProviding: AnyObject, Sendable {
    func activeDisplays() -> [NativeDisplayGeometry]
}

public protocol NativeInputWindowProviding: AnyObject, Sendable {
    func activeWindow(hostUs: Int64, excludingWindowIDs: Set<UInt32>) -> NativeActiveWindowSnapshot?
}

public struct NativeInputRuntimeScheduling: Sendable {
    public typealias Cancellation = @Sendable () -> Void
    private let scheduleImpl: @Sendable (
        _ intervalUs: Int64,
        _ handler: @escaping @Sendable () -> Void
    ) -> Cancellation

    public init(
        _ schedule: @escaping @Sendable (
            _ intervalUs: Int64,
            _ handler: @escaping @Sendable () -> Void
        ) -> Cancellation
    ) {
        scheduleImpl = schedule
    }

    public func schedule(
        intervalUs: Int64,
        handler: @escaping @Sendable () -> Void
    ) -> Cancellation {
        scheduleImpl(intervalUs, handler)
    }

    public static let dispatch = NativeInputRuntimeScheduling { intervalUs, handler in
        let timer = DispatchSource.makeTimerSource(
            queue: DispatchQueue(label: "com.excalicast.native-input.runtime", qos: .userInitiated)
        )
        timer.schedule(
            deadline: .now() + .microseconds(Int(intervalUs)),
            repeating: .microseconds(Int(intervalUs)),
            leeway: .milliseconds(5)
        )
        timer.setEventHandler(handler: handler)
        timer.resume()
        return { timer.cancel() }
    }
}

private final class NativeInputDisplayCache: @unchecked Sendable {
    private let lock = NSLock()
    private var value: [NativeDisplayGeometry] = []

    func replace(with displays: [NativeDisplayGeometry]) {
        lock.lock()
        value = displays
        lock.unlock()
    }

    var snapshot: [NativeDisplayGeometry] {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

public final class NativeInputCaptureRuntime: @unchecked Sendable {
    private enum State { case stopped, running, paused, stopping }

    private let source: any NativeInputRuntimeSource
    private let displays: any NativeInputDisplayProviding
    private let windows: any NativeInputWindowProviding
    private let clock: any NativeInputHostClock
    private let controls: CaptureControlState
    private let scheduling: NativeInputRuntimeScheduling
    private let onTerminal: @Sendable (
        MacNativeInputError,
        NativeInputTelemetryCaptureMetadata
    ) -> Void
    private let monitor: NativeInputTelemetryMonitor
    private let displayCache: NativeInputDisplayCache
    private let lock = NSLock()
    private let lifecycleLock = NSRecursiveLock()
    private var state: State = .stopped
    private var cancellation: NativeInputRuntimeScheduling.Cancellation?
    private var tickCount = 0
    private var currentTerminalFailure: MacNativeInputError?

    public init(
        source: any NativeInputRuntimeSource,
        displays: any NativeInputDisplayProviding,
        windows: any NativeInputWindowProviding,
        clock: any NativeInputHostClock,
        controls: CaptureControlState,
        sink: any NativeInputTelemetrySink,
        excludedWindowIDs: Set<UInt32>,
        scheduling: NativeInputRuntimeScheduling = .dispatch,
        onTerminal: @escaping @Sendable (
            MacNativeInputError,
            NativeInputTelemetryCaptureMetadata
        ) -> Void
    ) {
        self.source = source
        self.displays = displays
        self.windows = windows
        self.clock = clock
        self.controls = controls
        self.scheduling = scheduling
        self.onTerminal = onTerminal
        let displayCache = NativeInputDisplayCache()
        self.displayCache = displayCache
        let mapper = NativeInputTelemetryMapper(displays: { displayCache.snapshot })
        self.monitor = NativeInputTelemetryMonitor(
            source: source,
            mapper: mapper,
            sink: sink,
            activeWindowSnapshot: {
                windows.activeWindow(
                    hostUs: clock.nowUs(),
                    excludingWindowIDs: excludedWindowIDs
                )
            }
        )
        source.setTerminalHandler { [weak self] error in self?.recordTerminal(error) }
    }

    public func start() throws {
        lifecycleLock.lock()
        defer { lifecycleLock.unlock() }
        lock.lock()
        guard state == .stopped else { lock.unlock(); return }
        currentTerminalFailure = nil
        tickCount = 0
        lock.unlock()

        displayCache.replace(with: displays.activeDisplays())
        do {
            try monitor.start()
            lock.lock()
            state = .running
            lock.unlock()
            try monitor.sampleActiveWindow()
            let scheduled = scheduling.schedule(intervalUs: 100_000) { [weak self] in
                self?.timerTick()
            }
            lock.lock()
            cancellation = scheduled
            lock.unlock()
        } catch {
            monitor.stop()
            lock.lock()
            state = .stopped
            lock.unlock()
            throw stableError(for: error)
        }
    }

    public func pause() throws {
        lifecycleLock.lock()
        defer { lifecycleLock.unlock() }
        lock.lock()
        guard state == .running else { lock.unlock(); return }
        lock.unlock()
        source.suspendCallbacksAndWait()
        do {
            try monitor.flush()
        } catch {
            let stable = stableError(for: error)
            recordTerminal(stable)
            throw stable
        }
        let pauseHostUs = clock.nowUs()
        _ = controls.pause(atUs: pauseHostUs)
        lock.lock()
        state = .paused
        lock.unlock()
    }

    public func resume() {
        lifecycleLock.lock()
        defer { lifecycleLock.unlock() }
        lock.lock()
        guard state == .paused, currentTerminalFailure == nil else { lock.unlock(); return }
        lock.unlock()
        let resumeHostUs = clock.nowUs()
        _ = controls.resume(atUs: resumeHostUs)
        source.resumeCallbacks()
        lock.lock()
        state = .running
        lock.unlock()
    }

    public func stop() throws {
        lifecycleLock.lock()
        defer { lifecycleLock.unlock() }
        lock.lock()
        guard state != .stopped else {
            let terminal = currentTerminalFailure
            lock.unlock()
            if let terminal { throw terminal }
            return
        }
        state = .stopping
        let cancel = cancellation
        cancellation = nil
        lock.unlock()
        cancel?()

        source.suspendCallbacksAndWait()
        monitor.stop()
        var flushFailure: MacNativeInputError?
        do { try monitor.flush() }
        catch { flushFailure = stableError(for: error) }

        lock.lock()
        state = .stopped
        let terminal = currentTerminalFailure ?? source.terminalFailure ?? flushFailure
        lock.unlock()
        if let terminal { throw terminal }
    }

    public var terminalFailure: MacNativeInputError? {
        lock.lock()
        defer { lock.unlock() }
        return currentTerminalFailure ?? source.terminalFailure
    }

    public var captureMetadata: NativeInputTelemetryCaptureMetadata {
        let sourceStatistics = source.statistics
        let terminal = terminalFailure
        return NativeInputTelemetryCaptureMetadata(
            requested: true,
            available: terminal == nil,
            producerSchemaVersion: 1,
            coordinateSpaceVersion: NativeInputTelemetryMapper.coordinateSpaceVersion,
            terminalError: terminal?.rawValue,
            capturedEventCount: sourceStatistics.capturedEventCount,
            coalescedEventCount: sourceStatistics.coalescedEventCount
                + monitor.coalescerStatistics.coalescedEventCount,
            droppedEventCount: sourceStatistics.droppedEventCount
        )
    }

    private func timerTick() {
        lifecycleLock.lock()
        defer { lifecycleLock.unlock() }
        lock.lock()
        guard state == .running, currentTerminalFailure == nil else { lock.unlock(); return }
        tickCount += 1
        let shouldSampleWindow = tickCount.isMultiple(of: 2)
        lock.unlock()
        do {
            source.drainEnqueuedCallbacks()
            if shouldSampleWindow {
                displayCache.replace(with: displays.activeDisplays())
                try monitor.sampleActiveWindow()
            }
            try monitor.flush()
        } catch {
            recordTerminal(stableError(for: error))
        }
    }

    private func recordTerminal(_ error: MacNativeInputError) {
        lock.lock()
        guard currentTerminalFailure == nil else { lock.unlock(); return }
        currentTerminalFailure = error
        let cancel = cancellation
        cancellation = nil
        lock.unlock()
        cancel?()
        onTerminal(error, captureMetadata)
    }

    private func stableError(for error: Error) -> MacNativeInputError {
        if let stable = error as? MacNativeInputError { return stable }
        if let monitorError = error as? NativeInputTelemetryMonitorError {
            switch monitorError {
            case .losslessOverflow, .mappingFailed:
                return .inputTelemetryBufferOverflow
            case .inputMonitoringPermissionRequired:
                return .inputMonitoringPermissionRequired
            case .deliveryInProgress:
                return .inputTelemetryWriteFailed
            }
        }
        return .inputTelemetryWriteFailed
    }
}

public enum NativeInputSessionStartup {
    public static func start(
        startMedia: @escaping @Sendable () async throws -> Void,
        startInput: @escaping @Sendable () throws -> Void,
        stopMedia: @escaping @Sendable () async -> Void,
        markInterrupted: @escaping @Sendable () -> Void
    ) async throws {
        do {
            try await startMedia()
            try startInput()
        } catch {
            await stopMedia()
            markInterrupted()
            throw error
        }
    }
}
