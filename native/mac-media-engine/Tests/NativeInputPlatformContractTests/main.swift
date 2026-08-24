import CoreGraphics
import Darwin
import Foundation
import MacMediaEngineCore
import MacMediaEnginePlatform

private enum TestFailure: Error {
    case expectation(String)
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    guard try condition() else { throw TestFailure.expectation(message) }
}

private final class LockedBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value

    init(_ value: Value) { self.value = value }

    func withValue<Result>(_ body: (inout Value) throws -> Result) rethrows -> Result {
        lock.lock()
        defer { lock.unlock() }
        return try body(&value)
    }

    var snapshot: Value { withValue { $0 } }
}

private final class FakeClock: NativeInputHostClock, @unchecked Sendable {
    private let value = LockedBox<Int64>(0)
    private let blockNextRead = LockedBox(false)
    private let blockedReadEntered = DispatchSemaphore(value: 0)
    private let blockedReadMayReturn = DispatchSemaphore(value: 0)

    func nowUs() -> Int64 {
        let shouldBlock = blockNextRead.withValue { armed in
            defer { armed = false }
            return armed
        }
        if shouldBlock {
            blockedReadEntered.signal()
            blockedReadMayReturn.wait()
        }
        return value.snapshot
    }

    func set(_ hostUs: Int64) { value.withValue { $0 = hostUs } }

    func blockNextReadUntilReleased() { blockNextRead.withValue { $0 = true } }

    func waitUntilReadIsBlocked() -> Bool {
        blockedReadEntered.wait(timeout: .now() + .seconds(1)) == .success
    }

    func releaseBlockedRead() { blockedReadMayReturn.signal() }
}

private final class FakeTapSession: MacInputEventTapSession, @unchecked Sendable {
    private let handler: @Sendable (MacInputEventTapMessage) -> Void
    private let callbackThreadLock = NSLock()
    private var callbackThread: mach_port_t?
    private(set) var reenableCount = 0
    private(set) var reenabledOnCallbackThread = false
    private(set) var barrierCount = 0
    private(set) var stopCount = 0

    init(handler: @escaping @Sendable (MacInputEventTapMessage) -> Void) {
        self.handler = handler
    }

    func emit(_ message: MacInputEventTapMessage) {
        guard case .disabledByTimeout = message else {
            if case .disabledByUserInput = message {
                emitDisabled(message)
            } else {
                handler(message)
            }
            return
        }
        emitDisabled(message)
    }

    private func emitDisabled(_ message: MacInputEventTapMessage) {
        callbackThreadLock.lock()
        callbackThread = pthread_mach_thread_np(pthread_self())
        callbackThreadLock.unlock()
        handler(message)
        callbackThreadLock.lock()
        callbackThread = nil
        callbackThreadLock.unlock()
    }
    func reenable() {
        callbackThreadLock.lock()
        reenabledOnCallbackThread = callbackThread == pthread_mach_thread_np(pthread_self())
        callbackThreadLock.unlock()
        reenableCount += 1
    }
    func callbackBarrier() { barrierCount += 1 }
    func stop() { stopCount += 1 }
}

private final class FakeTapBackend: MacInputEventTapBackend, @unchecked Sendable {
    var permissionGranted = true
    var startError: MacNativeInputError?
    private(set) var masks: [CGEventMask] = []
    private(set) var sessions: [FakeTapSession] = []
    private(set) var startReturnedReady = false

    func preflightListenEventAccess() -> Bool { permissionGranted }

    func start(
        mask: CGEventMask,
        handler: @escaping @Sendable (MacInputEventTapMessage) -> Void
    ) throws -> any MacInputEventTapSession {
        masks.append(mask)
        if let startError { throw startError }
        let session = FakeTapSession(handler: handler)
        sessions.append(session)
        startReturnedReady = true
        return session
    }
}

private final class FakeDisplayProvider: NativeInputDisplayProviding, @unchecked Sendable {
    let geometries: [NativeDisplayGeometry]
    private(set) var callCount = 0

    init(_ geometries: [NativeDisplayGeometry]) { self.geometries = geometries }
    func activeDisplays() -> [NativeDisplayGeometry] { callCount += 1; return geometries }
}

private final class FakeWindowProvider: NativeInputWindowProviding, @unchecked Sendable {
    var snapshot: NativeActiveWindowSnapshot?
    private(set) var callCount = 0
    private(set) var exclusions: [Set<UInt32>] = []

    func activeWindow(hostUs: Int64, excludingWindowIDs: Set<UInt32>) -> NativeActiveWindowSnapshot? {
        callCount += 1
        exclusions.append(excludingWindowIDs)
        guard let snapshot else { return nil }
        return NativeActiveWindowSnapshot(
            hostUs: hostUs,
            application: snapshot.application,
            bundleIdentifier: snapshot.bundleIdentifier,
            processId: snapshot.processId,
            windowId: snapshot.windowId,
            title: snapshot.title,
            bounds: snapshot.bounds
        )
    }
}

private final class TerminalRuntimeSource: NativeInputRuntimeSource, @unchecked Sendable {
    private let lock = NSLock()
    private var handler: (@Sendable (NativeRawInputEvent) -> Void)?
    private var terminalHandler: (@Sendable (MacNativeInputError) -> Void)?
    private var currentTerminalFailure: MacNativeInputError?
    private let resumeEntered = DispatchSemaphore(value: 0)
    private let resumeMayReturn = DispatchSemaphore(value: 0)
    private var shouldBlockResume = false
    private var eventOnResume: NativeRawInputEvent?
    private var afterResumeEvent: (@Sendable () -> Void)?
    let statistics = NativeInputSourceStatistics(capturedEventCount: 0, coalescedEventCount: 0, droppedEventCount: 0)

    var terminalFailure: MacNativeInputError? {
        lock.lock()
        defer { lock.unlock() }
        return currentTerminalFailure
    }

    func start(handler: @escaping @Sendable (NativeRawInputEvent) -> Void) throws { self.handler = handler }
    func stop() { handler = nil }
    func setTerminalHandler(_ handler: @escaping @Sendable (MacNativeInputError) -> Void) {
        lock.lock()
        terminalHandler = handler
        lock.unlock()
    }
    func drainEnqueuedCallbacks() {}
    func suspendCallbacksAndWait() {}
    func commitCallbackResume(_ commit: @Sendable () -> Void) throws {
        lock.lock()
        let block = shouldBlockResume
        lock.unlock()
        if block {
            resumeEntered.signal()
            resumeMayReturn.wait()
        }
        lock.lock()
        if let currentTerminalFailure {
            lock.unlock()
            throw currentTerminalFailure
        }
        commit()
        let event = eventOnResume
        eventOnResume = nil
        let afterEvent = afterResumeEvent
        afterResumeEvent = nil
        let activeHandler = handler
        lock.unlock()
        if let event { activeHandler?(event) }
        afterEvent?()
    }

    func blockNextResume() {
        lock.lock()
        shouldBlockResume = true
        lock.unlock()
    }

    func waitUntilResumeEntered() -> Bool {
        resumeEntered.wait(timeout: .now() + .seconds(1)) == .success
    }

    func releaseResume() { resumeMayReturn.signal() }

    func emitOnNextResume(
        _ event: NativeRawInputEvent,
        afterEmission: @escaping @Sendable () -> Void
    ) {
        lock.lock()
        eventOnResume = event
        afterResumeEvent = afterEmission
        lock.unlock()
    }

    func fail(_ error: MacNativeInputError) {
        lock.lock()
        currentTerminalFailure = error
        let callback = terminalHandler
        lock.unlock()
        callback?(error)
    }
}

private final class LockOrderingRuntimeSource: NativeInputRuntimeSource, @unchecked Sendable {
    private let sourceGate = DispatchSemaphore(value: 1)
    private let commitEntered = DispatchSemaphore(value: 0)
    private let commitMayContinue = DispatchSemaphore(value: 0)
    private let observedTerminalReadEntered = DispatchSemaphore(value: 0)
    private let observeTerminalRead = LockedBox(false)
    private let terminalReadTimedOut = LockedBox(false)

    let statistics = NativeInputSourceStatistics(
        capturedEventCount: 0,
        coalescedEventCount: 0,
        droppedEventCount: 0
    )

    var terminalFailure: MacNativeInputError? {
        let isObservedRead = observeTerminalRead.withValue { value in
            defer { value = false }
            return value
        }
        if isObservedRead {
            observedTerminalReadEntered.signal()
            guard sourceGate.wait(timeout: .now() + .milliseconds(250)) == .success else {
                terminalReadTimedOut.withValue { $0 = true }
                return nil
            }
        } else {
            sourceGate.wait()
        }
        sourceGate.signal()
        return nil
    }

    func start(handler: @escaping @Sendable (NativeRawInputEvent) -> Void) throws {}
    func stop() {}
    func setTerminalHandler(_ handler: @escaping @Sendable (MacNativeInputError) -> Void) {}
    func drainEnqueuedCallbacks() {}
    func suspendCallbacksAndWait() {}

    func commitCallbackResume(_ commit: @Sendable () -> Void) throws {
        sourceGate.wait()
        commitEntered.signal()
        commitMayContinue.wait()
        commit()
        sourceGate.signal()
    }

    func waitUntilCommitEntered() -> Bool {
        commitEntered.wait(timeout: .now() + .seconds(1)) == .success
    }

    func observeNextTerminalRead() {
        observeTerminalRead.withValue { $0 = true }
    }

    func waitUntilObservedTerminalReadEntered() -> Bool {
        observedTerminalReadEntered.wait(timeout: .now() + .seconds(1)) == .success
    }

    func releaseCommit() { commitMayContinue.signal() }

    var detectedLockInversion: Bool { terminalReadTimedOut.snapshot }
}

private final class ManualScheduler: @unchecked Sendable {
    private let handler = LockedBox<(@Sendable () -> Void)?>(nil)
    private(set) var intervalUs: Int64?
    private(set) var cancelCount = 0

    var scheduling: NativeInputRuntimeScheduling {
        NativeInputRuntimeScheduling { [weak self] intervalUs, handler in
            self?.intervalUs = intervalUs
            self?.handler.withValue { $0 = handler }
            return { [weak self] in self?.cancelCount += 1 }
        }
    }

    func fire() { handler.snapshot?() }
}

private enum PersistenceFailure: Error { case requested }

private final class PersistedPayloads: @unchecked Sendable {
    private let values = LockedBox<[Data]>([])
    private let fail = LockedBox(false)
    func failNext() { fail.withValue { $0 = true } }
    func persist(_ data: Data) throws {
        let shouldFail = fail.withValue { value in defer { value = false }; return value }
        if shouldFail { throw PersistenceFailure.requested }
        values.withValue { $0.append(data) }
    }
    var payloads: [Data] { values.snapshot }
}

private func eventMask(_ types: [CGEventType]) -> CGEventMask {
    types.reduce(0) { $0 | (CGEventMask(1) << CGEventMask($1.rawValue)) }
}

private func makeRuntime(
    clock: FakeClock,
    backend: FakeTapBackend,
    displays: FakeDisplayProvider,
    windows: FakeWindowProvider,
    scheduler: ManualScheduler,
    controls: CaptureControlState,
    persistence: PersistedPayloads,
    terminal: LockedBox<[MacNativeInputError]>
) -> NativeInputCaptureRuntime {
    let source = MacNativeInputEventSource(backend: backend, clock: clock)
    let coordinator = InputTelemetryCoordinator(sessionId: "platform-contract")
    let sink = NativeInputTelemetryCoordinatorSink(
        sessionId: "platform-contract",
        producerEpoch: "platform-epoch",
        controls: controls,
        timeline: RecordingTimeline(originUs: 1_000_000),
        coordinator: coordinator,
        persist: { _, _, _, data in try persistence.persist(data) }
    )
    return NativeInputCaptureRuntime(
        source: source,
        displays: displays,
        windows: windows,
        clock: clock,
        controls: controls,
        sink: sink,
        excludedWindowIDs: [77, 88],
        scheduling: scheduler.scheduling,
        onTerminal: { error, _ in terminal.withValue { values in values.append(error) } }
    )
}

@main
private struct NativeInputPlatformContractTests {
    static func main() async throws {
        let requiredTypes: [CGEventType] = [
            .mouseMoved,
            .leftMouseDown, .leftMouseUp,
            .rightMouseDown, .rightMouseUp,
            .otherMouseDown, .otherMouseUp,
            .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
            .scrollWheel,
        ]
        try expect(
            MacNativeInputEventSource.requiredEventMask == eventMask(requiredTypes),
            "event tap mask includes move, every down/up, every drag, and scroll exactly"
        )

        let deniedBackend = FakeTapBackend()
        deniedBackend.permissionGranted = false
        let deniedSource = MacNativeInputEventSource(backend: deniedBackend, clock: FakeClock())
        do {
            try deniedSource.start { _ in }
            throw TestFailure.expectation("permission denial must fail before tap creation")
        } catch MacNativeInputError.inputMonitoringPermissionRequired {
            try expect(deniedBackend.masks.isEmpty, "permission denial never attempts tap creation")
        }

        let failedBackend = FakeTapBackend()
        failedBackend.startError = .inputEventTapCreationFailed
        do {
            try MacNativeInputEventSource(backend: failedBackend, clock: FakeClock()).start { _ in }
            throw TestFailure.expectation("tap creation failure must be explicit")
        } catch MacNativeInputError.inputEventTapCreationFailed {
            // Expected.
        }

        let lifecycleClock = FakeClock()
        let lifecycleBackend = FakeTapBackend()
        let lifecycleEvents = LockedBox<[NativeRawInputEvent]>([])
        let lifecycleTerminal = LockedBox<[MacNativeInputError]>([])
        let lifecycleDeliveryUsedTapThread = LockedBox<[Bool]>([])
        let fakeTapThread = pthread_mach_thread_np(pthread_self())
        let lifecycleSource = MacNativeInputEventSource(backend: lifecycleBackend, clock: lifecycleClock)
        lifecycleSource.setTerminalHandler { error in
            lifecycleTerminal.withValue { values in values.append(error) }
        }
        try lifecycleSource.start { event in
            lifecycleDeliveryUsedTapThread.withValue { values in
                values.append(pthread_mach_thread_np(pthread_self()) == fakeTapThread)
            }
            lifecycleEvents.withValue { values in values.append(event) }
        }
        try lifecycleSource.start { _ in }
        try expect(lifecycleBackend.startReturnedReady, "source start returns only after backend readiness")
        try expect(lifecycleBackend.sessions.count == 1, "source start is idempotent")
        let tap = lifecycleBackend.sessions[0]

        lifecycleClock.set(1_010_000)
        tap.emit(.event(MacInputEventPrimitive(type: .mouseMoved, x: -300, y: 1_200)))
        lifecycleClock.set(1_020_000)
        tap.emit(.event(MacInputEventPrimitive(type: .leftMouseDown, x: 10, y: 20)))
        lifecycleClock.set(1_030_000)
        tap.emit(.event(MacInputEventPrimitive(type: .rightMouseUp, x: 10, y: 20)))
        lifecycleClock.set(1_040_000)
        tap.emit(.event(MacInputEventPrimitive(type: .otherMouseDown, x: 10, y: 20, buttonNumber: 2)))
        lifecycleClock.set(1_050_000)
        tap.emit(.event(MacInputEventPrimitive(type: .otherMouseUp, x: 10, y: 20, buttonNumber: 7)))
        lifecycleClock.set(1_060_000)
        tap.emit(.event(MacInputEventPrimitive(type: .leftMouseDragged, x: 11, y: 21)))
        lifecycleClock.set(1_070_000)
        tap.emit(.event(MacInputEventPrimitive(type: .scrollWheel, x: 11, y: 21, scrollDeltaX: 2.5, scrollDeltaY: -4)))
        lifecycleSource.suspendCallbacksAndWait()
        try lifecycleSource.commitCallbackResume {}

        let raw = lifecycleEvents.snapshot
        try expect(raw.count == 6, "required callback families enqueue losslessly while cursor motion coalesces")
        try expect(lifecycleDeliveryUsedTapThread.snapshot.allSatisfy { !$0 }, "event-tap callback only copies primitives and enqueues delivery off the tap thread")
        try expect(lifecycleSource.statistics.capturedEventCount == 7 && lifecycleSource.statistics.coalescedEventCount == 1, "captured and coalesced callback counts remain observable")
        if case let .button(_, _, _, button, phase) = raw[0] {
            try expect(button == .primary && phase == .down, "left down preserves primary/down")
        } else { throw TestFailure.expectation("left down did not map to button input") }
        if case let .button(_, _, _, button, phase) = raw[1] {
            try expect(button == .secondary && phase == .up, "right up preserves secondary/up")
        } else { throw TestFailure.expectation("right up did not map to button input") }
        if case let .button(_, _, _, button, _) = raw[2] {
            try expect(button == .middle, "other button two maps to middle")
        } else { throw TestFailure.expectation("middle down did not map to button input") }
        if case let .button(_, _, _, button, _) = raw[3] {
            try expect(button == .other, "non-middle other button remains other")
        } else { throw TestFailure.expectation("other up did not map to button input") }
        if case .cursor = raw[4] {} else {
            throw TestFailure.expectation("dragged input preserves cursor telemetry")
        }
        if case let .scroll(_, _, _, dx, dy) = raw[5] {
            try expect(dx == 2.5 && dy == -4, "horizontal and vertical scroll deltas are preserved")
        } else { throw TestFailure.expectation("scroll did not map to scroll input") }

        tap.emit(.disabledByTimeout)
        lifecycleSource.drainEnqueuedCallbacks()
        try expect(tap.reenableCount == 1 && !tap.reenabledOnCallbackThread && lifecycleTerminal.snapshot.isEmpty, "first disabled callback enqueues exactly one off-callback re-enable")
        tap.emit(.disabledByUserInput)
        lifecycleSource.drainEnqueuedCallbacks()
        try expect(
            lifecycleTerminal.snapshot == [.inputEventTapCreationFailed],
            "a second disabled callback is terminal and observable"
        )
        lifecycleSource.stop()
        lifecycleSource.stop()
        try expect(tap.stopCount == 1, "source stop is idempotent and waits for the backend stop barrier")

        let selected = MacActiveWindowSelector.select(
            frontmost: MacFrontmostApplication(processId: 501, application: "Slides", bundleIdentifier: "com.example.slides"),
            windows: [
                MacWindowSnapshot(processId: 999, windowId: 1, layer: 0, isOnscreen: true, title: "Other", bounds: NativeGlobalRect(x: 0, y: 0, width: 300, height: 200)),
                MacWindowSnapshot(processId: 501, windowId: 77, layer: 0, isOnscreen: true, title: "Ink", bounds: NativeGlobalRect(x: 10, y: 10, width: 300, height: 200)),
                MacWindowSnapshot(processId: 501, windowId: 3, layer: 1, isOnscreen: true, title: "Menu", bounds: NativeGlobalRect(x: 20, y: 20, width: 300, height: 200)),
                MacWindowSnapshot(processId: 501, windowId: 4, layer: 0, isOnscreen: true, title: "Lesson", bounds: NativeGlobalRect(x: -800, y: 100, width: 700, height: 500)),
            ],
            excludingWindowIDs: [77],
            hostUs: 2_000_000
        )
        try expect(selected?.windowId == 4 && selected?.title == "Lesson", "selector returns only the valid frontmost PID layer-zero non-overlay window")

        let displays = FakeDisplayProvider([
            NativeDisplayGeometry(displayId: 7, bounds: NativeGlobalRect(x: -1_440, y: -900, width: 1_440, height: 900), scale: 2),
            NativeDisplayGeometry(displayId: 9, bounds: NativeGlobalRect(x: 0, y: 0, width: 1_920, height: 1_080), scale: 1),
        ])
        let geometryMapper = NativeInputTelemetryMapper(displays: { displays.activeDisplays() })
        let verticalPoint = try geometryMapper.map(.cursor(hostUs: 2_100_000, x: -720, y: -450))
        try expect(verticalPoint.payload["displayId"] == .integer(7), "negative vertical mixed-scale display geometry is retained")
        try expect(verticalPoint.payload["scale"] == .number(2), "mixed Retina scale remains point metadata")

        let runtimeClock = FakeClock()
        runtimeClock.set(1_100_000)
        let runtimeBackend = FakeTapBackend()
        let runtimeWindows = FakeWindowProvider()
        runtimeWindows.snapshot = NativeActiveWindowSnapshot(
            hostUs: 0,
            application: "Slides",
            bundleIdentifier: "com.example.slides",
            processId: 501,
            windowId: 4,
            title: "Lesson",
            bounds: NativeGlobalRect(x: 0, y: 0, width: 1_000, height: 700)
        )
        let runtimeScheduler = ManualScheduler()
        let runtimeControls = CaptureControlState()
        let runtimePersistence = PersistedPayloads()
        let runtimeTerminal = LockedBox<[MacNativeInputError]>([])
        let runtimeDisplays = FakeDisplayProvider(displays.geometries)
        let runtime = makeRuntime(
            clock: runtimeClock,
            backend: runtimeBackend,
            displays: runtimeDisplays,
            windows: runtimeWindows,
            scheduler: runtimeScheduler,
            controls: runtimeControls,
            persistence: runtimePersistence,
            terminal: runtimeTerminal
        )
        try runtime.start()
        try expect(runtimeScheduler.intervalUs == 100_000, "runtime timer cadence is exactly 100ms")
        try expect(runtimeWindows.callCount == 1, "start immediately samples the active window")
        let runtimeTap = runtimeBackend.sessions[0]
        runtimeClock.set(1_110_000)
        runtimeTap.emit(.event(MacInputEventPrimitive(type: .mouseMoved, x: 20, y: 30)))
        try expect(runtimeDisplays.callCount == 1 && runtimeWindows.callCount == 1 && runtimePersistence.payloads.isEmpty, "event callback performs no provider, window, or persistence work")
        runtimeClock.set(1_200_000)
        runtimeScheduler.fire()
        try expect(runtimePersistence.payloads.count == 1, "100ms tick flushes one native batch instead of persisting per event")
        try expect(runtimeWindows.callCount == 1, "active window is not sampled at 100ms")
        runtimeClock.set(1_300_000)
        runtimeScheduler.fire()
        try expect(runtimeWindows.callCount == 2, "active window is sampled every 200ms")
        try expect(runtimeWindows.exclusions.allSatisfy { $0 == [77, 88] }, "every window sample excludes capture overlays")

        runtimeClock.set(1_350_000)
        runtimeTap.emit(.event(MacInputEventPrimitive(type: .leftMouseDown, x: 40, y: 50)))
        runtimeClock.set(1_400_000)
        try runtime.pause()
        try expect(runtimeTap.barrierCount == 1, "pause blocks callbacks and drains a callback barrier")
        try expect(runtimeControls.snapshot().paused, "controls pause only after pre-pause input flushes")
        runtimeClock.set(1_500_000)
        runtimeTap.emit(.event(MacInputEventPrimitive(type: .leftMouseUp, x: 40, y: 50)))
        runtimeClock.set(1_600_000)
        try runtime.resume()
        runtimeClock.set(1_700_000)
        runtimeTap.emit(.event(MacInputEventPrimitive(type: .scrollWheel, x: 40, y: 50, scrollDeltaY: 3)))
        try runtime.stop()
        try expect(runtimeScheduler.cancelCount == 1 && runtimeTap.stopCount == 1, "stop cancels timer, blocks callbacks, waits, and stops the tap")
        try expect(runtimePersistence.payloads.count == 3, "pause and stop each perform a final bounded flush")
        let allEvents = try runtimePersistence.payloads.flatMap { data -> [[String: Any]] in
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            return object?["events"] as? [[String: Any]] ?? []
        }
        let runtimeEventTimes = allEvents.map { $0["atUs"] as? Int }
        try expect(runtimeEventTimes == [100_000, 100_001, 110_000, 350_000, 500_000], "pause interval is compacted and paused callbacks never enter project time: \(runtimeEventTimes)")

        let failingClock = FakeClock()
        failingClock.set(1_100_000)
        let failingBackend = FakeTapBackend()
        let failingPersistence = PersistedPayloads()
        failingPersistence.failNext()
        let failingScheduler = ManualScheduler()
        let failureTerminal = LockedBox<[MacNativeInputError]>([])
        let failingRuntime = makeRuntime(
            clock: failingClock,
            backend: failingBackend,
            displays: FakeDisplayProvider(displays.geometries),
            windows: FakeWindowProvider(),
            scheduler: failingScheduler,
            controls: CaptureControlState(),
            persistence: failingPersistence,
            terminal: failureTerminal
        )
        try failingRuntime.start()
        failingBackend.sessions[0].emit(.event(MacInputEventPrimitive(type: .leftMouseDown, x: 10, y: 10)))
        failingClock.set(1_200_000)
        failingScheduler.fire()
        try expect(failureTerminal.snapshot == [.inputTelemetryWriteFailed], "timer write failure becomes a stable terminal session error")
        try expect(failingRuntime.terminalFailure == .inputTelemetryWriteFailed, "terminal failure is queryable and cannot report healthy")
        do {
            try failingRuntime.stop()
            throw TestFailure.expectation("terminal input failure must fail stop and prevent ready finalization")
        } catch MacNativeInputError.inputTelemetryWriteFailed {
            // Expected.
        }

        let finalFlushClock = FakeClock()
        finalFlushClock.set(1_100_000)
        let finalFlushBackend = FakeTapBackend()
        let finalFlushPersistence = PersistedPayloads()
        let finalFlushTerminal = LockedBox<[MacNativeInputError]>([])
        let finalFlushScheduler = ManualScheduler()
        let finalFlushRuntime = makeRuntime(
            clock: finalFlushClock,
            backend: finalFlushBackend,
            displays: FakeDisplayProvider(displays.geometries),
            windows: FakeWindowProvider(),
            scheduler: finalFlushScheduler,
            controls: CaptureControlState(),
            persistence: finalFlushPersistence,
            terminal: finalFlushTerminal
        )
        try finalFlushRuntime.start()
        finalFlushBackend.sessions[0].emit(.event(MacInputEventPrimitive(type: .leftMouseDown, x: 10, y: 10)))
        finalFlushPersistence.failNext()
        do {
            try finalFlushRuntime.stop()
            throw TestFailure.expectation("final flush persistence failure must fail stop")
        } catch MacNativeInputError.inputTelemetryWriteFailed {
            // Expected.
        }
        try expect(finalFlushTerminal.snapshot == [.inputTelemetryWriteFailed], "final flush failure is recorded through the terminal callback")
        try expect(finalFlushRuntime.terminalFailure == .inputTelemetryWriteFailed, "final flush failure remains queryable after stop")
        try expect(!finalFlushRuntime.captureMetadata.available && finalFlushRuntime.captureMetadata.terminalError == MacNativeInputError.inputTelemetryWriteFailed.rawValue, "final flush metadata cannot report native telemetry healthy")

        let terminalResumeSource = TerminalRuntimeSource()
        let terminalResumeControls = CaptureControlState()
        let terminalResumeClock = FakeClock()
        terminalResumeClock.set(2_000_000)
        let terminalResumeSink = NativeInputTelemetryCoordinatorSink(
            sessionId: "terminal-resume",
            producerEpoch: "terminal-resume-epoch",
            controls: terminalResumeControls,
            timeline: RecordingTimeline(originUs: 2_000_000),
            coordinator: InputTelemetryCoordinator(sessionId: "terminal-resume"),
            persist: { _, _, _, _ in }
        )
        let terminalResumeScheduler = ManualScheduler()
        let terminalResumeRuntime = NativeInputCaptureRuntime(
            source: terminalResumeSource,
            displays: FakeDisplayProvider(displays.geometries),
            windows: FakeWindowProvider(),
            clock: terminalResumeClock,
            controls: terminalResumeControls,
            sink: terminalResumeSink,
            excludedWindowIDs: [],
            scheduling: terminalResumeScheduler.scheduling,
            onTerminal: { _, _ in }
        )
        try terminalResumeRuntime.start()
        terminalResumeClock.set(2_100_000)
        try terminalResumeRuntime.pause()
        terminalResumeSource.fail(.inputEventTapCreationFailed)
        do {
            try terminalResumeRuntime.resume()
            throw TestFailure.expectation("resume must surface an existing terminal native-input failure")
        } catch MacNativeInputError.inputEventTapCreationFailed {
            // Expected.
        }
        try expect(terminalResumeControls.snapshot().paused, "terminal resume keeps shared capture controls paused")
        try? terminalResumeRuntime.stop()

        let racingResumeSource = TerminalRuntimeSource()
        racingResumeSource.blockNextResume()
        let racingResumeControls = CaptureControlState()
        let racingResumeClock = FakeClock()
        racingResumeClock.set(3_000_000)
        let racingResumeScheduler = ManualScheduler()
        let racingResumeSink = NativeInputTelemetryCoordinatorSink(
            sessionId: "racing-resume",
            producerEpoch: "racing-resume-epoch",
            controls: racingResumeControls,
            timeline: RecordingTimeline(originUs: 3_000_000),
            coordinator: InputTelemetryCoordinator(sessionId: "racing-resume"),
            persist: { _, _, _, _ in }
        )
        let racingResumeRuntime = NativeInputCaptureRuntime(
            source: racingResumeSource,
            displays: FakeDisplayProvider(displays.geometries),
            windows: FakeWindowProvider(),
            clock: racingResumeClock,
            controls: racingResumeControls,
            sink: racingResumeSink,
            excludedWindowIDs: [],
            scheduling: racingResumeScheduler.scheduling,
            onTerminal: { _, _ in }
        )
        try racingResumeRuntime.start()
        racingResumeClock.set(3_100_000)
        try racingResumeRuntime.pause()
        let racingResumeTask = Task.detached { () -> MacNativeInputError? in
            do {
                try racingResumeRuntime.resume()
                return nil
            } catch let error as MacNativeInputError {
                return error
            } catch {
                return .inputTelemetryWriteFailed
            }
        }
        let enteredResume = racingResumeSource.waitUntilResumeEntered()
        racingResumeSource.fail(.inputEventTapCreationFailed)
        racingResumeSource.releaseResume()
        let racingResumeFailure = await racingResumeTask.value
        try expect(enteredResume, "resume race source enters the controlled resume critical section")
        try expect(racingResumeFailure == .inputEventTapCreationFailed, "a source failure during resume is returned to the runtime caller")
        try expect(racingResumeControls.snapshot().paused, "a rejected source resume cannot advance shared capture controls")
        try? racingResumeRuntime.stop()

        let mediaResumeSource = TerminalRuntimeSource()
        mediaResumeSource.blockNextResume()
        let mediaResumeControls = CaptureControlState()
        let mediaResumeClock = FakeClock()
        mediaResumeClock.set(4_000_000)
        let mediaResumeScheduler = ManualScheduler()
        let mediaResumeSink = NativeInputTelemetryCoordinatorSink(
            sessionId: "media-resume",
            producerEpoch: "media-resume-epoch",
            controls: mediaResumeControls,
            timeline: RecordingTimeline(originUs: 4_000_000),
            coordinator: InputTelemetryCoordinator(sessionId: "media-resume"),
            persist: { _, _, _, _ in }
        )
        let mediaResumeRuntime = NativeInputCaptureRuntime(
            source: mediaResumeSource,
            displays: FakeDisplayProvider(displays.geometries),
            windows: FakeWindowProvider(),
            clock: mediaResumeClock,
            controls: mediaResumeControls,
            sink: mediaResumeSink,
            excludedWindowIDs: [],
            scheduling: mediaResumeScheduler.scheduling,
            onTerminal: { _, _ in }
        )
        try mediaResumeRuntime.start()
        mediaResumeClock.set(4_100_000)
        try mediaResumeRuntime.pause()
        mediaResumeClock.set(4_200_000)
        let mediaResumeTask = Task.detached { () -> MacNativeInputError? in
            do {
                try mediaResumeRuntime.resume()
                return nil
            } catch let error as MacNativeInputError {
                return error
            } catch {
                return .inputTelemetryWriteFailed
            }
        }
        let enteredBlockedMediaResume = mediaResumeSource.waitUntilResumeEntered()
        let persistedMediaSamples = LockedBox<[Int64]>([])
        let adjustedDuringBlockedResume = mediaResumeControls.adjustedPresentationUs(4_250_000)
        if let adjustedDuringBlockedResume {
            persistedMediaSamples.withValue { $0.append(adjustedDuringBlockedResume) }
        }
        mediaResumeSource.fail(.inputEventTapCreationFailed)
        mediaResumeSource.releaseResume()
        let mediaResumeFailure = await mediaResumeTask.value
        try expect(enteredBlockedMediaResume, "resume reaches the blocked source commit before the media callback")
        try expect(adjustedDuringBlockedResume == nil && persistedMediaSamples.snapshot.isEmpty, "media callbacks remain paused and cannot persist while source resume is uncommitted")
        try expect(mediaResumeFailure == .inputEventTapCreationFailed, "failed source commit rejects the media-safe resume transaction")
        try expect(mediaResumeControls.snapshot().paused, "failed media-safe resume leaves shared controls paused")
        try? mediaResumeRuntime.stop()

        let lockOrderingSource = LockOrderingRuntimeSource()
        let lockOrderingControls = CaptureControlState()
        let lockOrderingClock = FakeClock()
        lockOrderingClock.set(4_500_000)
        let lockOrderingScheduler = ManualScheduler()
        let lockOrderingRuntime = NativeInputCaptureRuntime(
            source: lockOrderingSource,
            displays: FakeDisplayProvider(displays.geometries),
            windows: FakeWindowProvider(),
            clock: lockOrderingClock,
            controls: lockOrderingControls,
            sink: NativeInputTelemetryCoordinatorSink(
                sessionId: "lock-ordering-resume",
                producerEpoch: "lock-ordering-resume-epoch",
                controls: lockOrderingControls,
                timeline: RecordingTimeline(originUs: 4_500_000),
                coordinator: InputTelemetryCoordinator(sessionId: "lock-ordering-resume"),
                persist: { _, _, _, _ in }
            ),
            excludedWindowIDs: [],
            scheduling: lockOrderingScheduler.scheduling,
            onTerminal: { _, _ in }
        )
        try lockOrderingRuntime.start()
        lockOrderingClock.set(4_600_000)
        try lockOrderingRuntime.pause()
        lockOrderingClock.set(4_700_000)
        let lockOrderingResumeTask = Task.detached {
            try lockOrderingRuntime.resume()
        }
        let enteredLockedCommit = lockOrderingSource.waitUntilCommitEntered()
        lockOrderingSource.observeNextTerminalRead()
        let terminalReadTask = Task.detached { lockOrderingRuntime.terminalFailure }
        let enteredCompetingTerminalRead = lockOrderingSource.waitUntilObservedTerminalReadEntered()
        lockOrderingSource.releaseCommit()
        try await lockOrderingResumeTask.value
        _ = await terminalReadTask.value
        try expect(enteredLockedCommit && enteredCompetingTerminalRead, "lock-ordering contract overlaps source commit and runtime terminal inspection")
        try expect(!lockOrderingSource.detectedLockInversion, "resume commit does not invert source and runtime locks")
        try? lockOrderingRuntime.stop()

        let returnWindowSource = TerminalRuntimeSource()
        let returnWindowControls = CaptureControlState()
        let returnWindowClock = FakeClock()
        returnWindowClock.set(5_000_000)
        let returnWindowScheduler = ManualScheduler()
        let returnWindowSink = NativeInputTelemetryCoordinatorSink(
            sessionId: "return-window-resume",
            producerEpoch: "return-window-resume-epoch",
            controls: returnWindowControls,
            timeline: RecordingTimeline(originUs: 5_000_000),
            coordinator: InputTelemetryCoordinator(sessionId: "return-window-resume"),
            persist: { _, _, _, _ in }
        )
        let returnWindowRuntime = NativeInputCaptureRuntime(
            source: returnWindowSource,
            displays: FakeDisplayProvider(displays.geometries),
            windows: FakeWindowProvider(),
            clock: returnWindowClock,
            controls: returnWindowControls,
            sink: returnWindowSink,
            excludedWindowIDs: [],
            scheduling: returnWindowScheduler.scheduling,
            onTerminal: { _, _ in }
        )
        try returnWindowRuntime.start()
        returnWindowClock.set(5_100_000)
        try returnWindowRuntime.pause()
        returnWindowClock.set(5_200_000)
        returnWindowClock.blockNextReadUntilReleased()
        let returnWindowResumeTask = Task.detached { () -> MacNativeInputError? in
            do {
                try returnWindowRuntime.resume()
                return nil
            } catch let error as MacNativeInputError {
                return error
            } catch {
                return .inputTelemetryWriteFailed
            }
        }
        let enteredOldReturnWindow = returnWindowClock.waitUntilReadIsBlocked()
        returnWindowSource.fail(.inputEventTapCreationFailed)
        returnWindowClock.releaseBlockedRead()
        let returnWindowFailure = await returnWindowResumeTask.value
        let returnWindowRemainedPaused = returnWindowControls.snapshot().paused
        try? returnWindowRuntime.stop()

        let firstEventSource = TerminalRuntimeSource()
        let firstEventControls = CaptureControlState()
        let firstEventClock = FakeClock()
        firstEventClock.set(6_000_000)
        let firstEventScheduler = ManualScheduler()
        let firstEventPersistence = PersistedPayloads()
        let firstEventSink = NativeInputTelemetryCoordinatorSink(
            sessionId: "first-resumed-event",
            producerEpoch: "first-resumed-event-epoch",
            controls: firstEventControls,
            timeline: RecordingTimeline(originUs: 6_000_000),
            coordinator: InputTelemetryCoordinator(sessionId: "first-resumed-event"),
            persist: { _, _, _, data in try firstEventPersistence.persist(data) }
        )
        let firstEventRuntime = NativeInputCaptureRuntime(
            source: firstEventSource,
            displays: FakeDisplayProvider(displays.geometries),
            windows: FakeWindowProvider(),
            clock: firstEventClock,
            controls: firstEventControls,
            sink: firstEventSink,
            excludedWindowIDs: [],
            scheduling: firstEventScheduler.scheduling,
            onTerminal: { _, _ in }
        )
        try firstEventRuntime.start()
        firstEventClock.set(6_100_000)
        try firstEventRuntime.pause()
        firstEventClock.set(6_200_000)
        firstEventSource.emitOnNextResume(
            .button(hostUs: 6_200_000, x: 10, y: 20, button: .primary, phase: .down),
            afterEmission: { firstEventClock.set(6_210_000) }
        )
        try firstEventRuntime.resume()
        try firstEventRuntime.stop()
        let firstResumedEvents = try firstEventPersistence.payloads.flatMap { data -> [[String: Any]] in
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            return object?["events"] as? [[String: Any]] ?? []
        }

        try expect(enteredOldReturnWindow, "resume reaches the controlled source-return to controls window")
        try expect(returnWindowFailure == .inputEventTapCreationFailed && returnWindowRemainedPaused, "a terminal failure winning the old return window rejects resume and restores paused state")
        try expect(firstResumedEvents.map { $0["kind"] as? String } == ["click"], "the first callback accepted after resume is retained")
        try expect(firstResumedEvents.first?["atUs"] as? Int == 100_000, "the first resumed event uses the compacted session timeline")

        let startupCalls = LockedBox<[String]>([])
        do {
            try await NativeInputSessionStartup.start(
                startMedia: { startupCalls.withValue { $0.append("media-start") } },
                startInput: {
                    startupCalls.withValue { $0.append("input-start") }
                    throw MacNativeInputError.inputEventTapCreationFailed
                },
                stopInput: { startupCalls.withValue { $0.append("input-stop") } },
                stopMedia: { startupCalls.withValue { $0.append("media-stop") } },
                markInterrupted: { startupCalls.withValue { $0.append("interrupted") } }
            )
            throw TestFailure.expectation("input startup failure must roll media back")
        } catch MacNativeInputError.inputEventTapCreationFailed {
            try expect(startupCalls.snapshot == ["media-start", "input-start", "input-stop", "media-stop", "interrupted"], "startup rollback stops input before media and marks the project interrupted")
        }

        let oldManifestJSON = #"{"schemaVersion":1,"recordingId":"old","state":"interrupted","tracks":{},"capture":{"screen":{"width":1920,"height":1080,"framesPerSecond":30,"codec":"h264"},"capturesSystemAudio":false,"capturesMicrophone":false,"hardwareEncodingConfirmed":true,"initialAvailableBytes":100}}"#
        let oldManifest = try JSONDecoder().decode(RecoverableRecordingManifest.self, from: Data(oldManifestJSON.utf8))
        try expect(oldManifest.capture?.inputTelemetry == nil, "old manifests decode without native telemetry metadata")

        let telemetryMetadata = NativeInputTelemetryCaptureMetadata(
            requested: true,
            available: false,
            producerSchemaVersion: 1,
            coordinateSpaceVersion: 1,
            terminalError: MacNativeInputError.inputTelemetryBufferOverflow.rawValue,
            capturedEventCount: 120,
            coalescedEventCount: 80,
            droppedEventCount: 2
        )
        let newMetadata = RecordingCaptureMetadata(
            screen: CaptureRequest(width: 1_920, height: 1_080, framesPerSecond: 30, codec: .h264),
            camera: nil,
            capturesSystemAudio: false,
            capturesMicrophone: false,
            hardwareEncodingConfirmed: true,
            initialAvailableBytes: 100,
            finalPressure: nil,
            inputTelemetry: telemetryMetadata
        )
        let roundTrip = try JSONDecoder().decode(RecordingCaptureMetadata.self, from: JSONEncoder().encode(newMetadata))
        try expect(roundTrip.inputTelemetry == telemetryMetadata, "new telemetry capability and count metadata round-trips")
        try expect(MacNativeInputError.inputMonitoringPermissionRequired.rawValue == "input_monitoring_permission_required", "permission error code is stable")
        try expect(MacNativeInputError.inputEventTapCreationFailed.rawValue == "input_event_tap_creation_failed", "tap error code is stable")
        try expect(MacNativeInputError.inputTelemetryBufferOverflow.rawValue == "input_telemetry_buffer_overflow", "overflow error code is stable")
        try expect(MacNativeInputError.inputTelemetryWriteFailed.rawValue == "input_telemetry_write_failed", "write error code is stable")

        print("Native input platform contract tests passed")
    }
}
