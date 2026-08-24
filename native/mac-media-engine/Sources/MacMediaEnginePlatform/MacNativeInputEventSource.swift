import CoreGraphics
import Foundation
import MacMediaEngineCore

public enum MacNativeInputError: String, Error, Codable, Equatable, Sendable {
    case inputMonitoringPermissionRequired = "input_monitoring_permission_required"
    case inputEventTapCreationFailed = "input_event_tap_creation_failed"
    case inputTelemetryBufferOverflow = "input_telemetry_buffer_overflow"
    case inputTelemetryWriteFailed = "input_telemetry_write_failed"
}

public protocol NativeInputHostClock: AnyObject, Sendable {
    func nowUs() -> Int64
}

public struct MacInputEventPrimitive: @unchecked Sendable {
    public let type: CGEventType
    public let x: Double
    public let y: Double
    public let buttonNumber: Int64
    public let scrollDeltaX: Double
    public let scrollDeltaY: Double

    public init(
        type: CGEventType,
        x: Double,
        y: Double,
        buttonNumber: Int64 = 0,
        scrollDeltaX: Double = 0,
        scrollDeltaY: Double = 0
    ) {
        self.type = type
        self.x = x
        self.y = y
        self.buttonNumber = buttonNumber
        self.scrollDeltaX = scrollDeltaX
        self.scrollDeltaY = scrollDeltaY
    }
}

public enum MacInputEventTapMessage: @unchecked Sendable {
    case event(MacInputEventPrimitive)
    case disabledByTimeout
    case disabledByUserInput
}

public protocol MacInputEventTapSession: AnyObject, Sendable {
    func reenable()
    func callbackBarrier()
    func stop()
}

public protocol MacInputEventTapBackend: AnyObject, Sendable {
    func preflightListenEventAccess() -> Bool
    func start(
        mask: CGEventMask,
        handler: @escaping @Sendable (MacInputEventTapMessage) -> Void
    ) throws -> any MacInputEventTapSession
}

public struct NativeInputSourceStatistics: Equatable, Sendable {
    public let capturedEventCount: Int64
    public let coalescedEventCount: Int64
    public let droppedEventCount: Int64

    public init(capturedEventCount: Int64, coalescedEventCount: Int64, droppedEventCount: Int64) {
        self.capturedEventCount = capturedEventCount
        self.coalescedEventCount = coalescedEventCount
        self.droppedEventCount = droppedEventCount
    }
}

public protocol NativeInputRuntimeSource: NativeInputTelemetrySource {
    func setTerminalHandler(_ handler: @escaping @Sendable (MacNativeInputError) -> Void)
    func drainEnqueuedCallbacks()
    func suspendCallbacksAndWait()
    func commitCallbackResume(_ commit: @Sendable () -> Void) throws
    var terminalFailure: MacNativeInputError? { get }
    var statistics: NativeInputSourceStatistics { get }
}

public final class MacNativeInputEventSource: NativeInputRuntimeSource, @unchecked Sendable {
    private enum State { case stopped, starting, running }
    private struct QueuedEvent: @unchecked Sendable {
        let primitive: MacInputEventPrimitive
        let hostUs: Int64
    }

    public static let requiredEventMask: CGEventMask = [
        CGEventType.mouseMoved,
        .leftMouseDown, .leftMouseUp,
        .rightMouseDown, .rightMouseUp,
        .otherMouseDown, .otherMouseUp,
        .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
        .scrollWheel,
    ].reduce(0) { $0 | (CGEventMask(1) << CGEventMask($1.rawValue)) }

    private let backend: any MacInputEventTapBackend
    private let clock: any NativeInputHostClock
    private let lock = NSLock()
    private let lifecycleLock = NSRecursiveLock()
    private let processingQueue = DispatchQueue(
        label: "com.excalicast.native-input.delivery",
        qos: .userInteractive
    )
    private var state: State = .stopped
    private var session: (any MacInputEventTapSession)?
    private var handler: (@Sendable (NativeRawInputEvent) -> Void)?
    private var terminalHandler: (@Sendable (MacNativeInputError) -> Void)?
    private var acceptingCallbacks = false
    private var didAttemptReenable = false
    private var pendingReenable = false
    private var currentTerminalFailure: MacNativeInputError?
    private var pendingEvents: [QueuedEvent] = []
    private var pendingCursorIndex: Int?
    private var drainScheduled = false
    private var pendingDisabledNotifications = 0
    private var disabledDrainScheduled = false
    private var capturedEventCount: Int64 = 0
    private var coalescedEventCount: Int64 = 0
    private var droppedEventCount: Int64 = 0

    public init(backend: any MacInputEventTapBackend, clock: any NativeInputHostClock) {
        self.backend = backend
        self.clock = clock
    }

    public func setTerminalHandler(_ handler: @escaping @Sendable (MacNativeInputError) -> Void) {
        lock.lock()
        terminalHandler = handler
        lock.unlock()
    }

    public func start(handler: @escaping @Sendable (NativeRawInputEvent) -> Void) throws {
        lifecycleLock.lock()
        defer { lifecycleLock.unlock() }
        lock.lock()
        guard state == .stopped else { lock.unlock(); return }
        state = .starting
        self.handler = handler
        acceptingCallbacks = true
        didAttemptReenable = false
        pendingReenable = false
        currentTerminalFailure = nil
        pendingEvents.removeAll(keepingCapacity: true)
        pendingCursorIndex = nil
        drainScheduled = false
        pendingDisabledNotifications = 0
        disabledDrainScheduled = false
        lock.unlock()

        guard backend.preflightListenEventAccess() else {
            resetAfterFailedStart()
            throw MacNativeInputError.inputMonitoringPermissionRequired
        }

        do {
            let started = try backend.start(mask: Self.requiredEventMask) { [weak self] message in
                self?.receive(message)
            }
            lock.lock()
            session = started
            state = .running
            let shouldReenable = pendingReenable
            pendingReenable = false
            lock.unlock()
            if shouldReenable { started.reenable() }
        } catch let error as MacNativeInputError {
            resetAfterFailedStart()
            throw error
        } catch {
            resetAfterFailedStart()
            throw MacNativeInputError.inputEventTapCreationFailed
        }
    }

    public func drainEnqueuedCallbacks() {
        processingQueue.sync {}
    }

    public func suspendCallbacksAndWait() {
        lock.lock()
        acceptingCallbacks = false
        let activeSession = session
        lock.unlock()
        activeSession?.callbackBarrier()
        drainEnqueuedCallbacks()
    }

    public func commitCallbackResume(_ commit: @Sendable () -> Void) throws {
        lock.lock()
        defer { lock.unlock() }
        if let currentTerminalFailure {
            throw currentTerminalFailure
        }
        guard state == .running else {
            throw MacNativeInputError.inputEventTapCreationFailed
        }
        // This lock is the resume transaction boundary: terminal recording
        // cannot win after the caller publishes its non-fallible state, and
        // callbacks open only after runtime state and shared controls agree.
        commit()
        acceptingCallbacks = true
    }

    public func stop() {
        lifecycleLock.lock()
        defer { lifecycleLock.unlock() }
        lock.lock()
        guard state != .stopped else { lock.unlock(); return }
        acceptingCallbacks = false
        let activeSession = session
        lock.unlock()
        activeSession?.stop()
        drainEnqueuedCallbacks()
        lock.lock()
        state = .stopped
        handler = nil
        session = nil
        lock.unlock()
    }

    public var terminalFailure: MacNativeInputError? {
        lock.lock()
        defer { lock.unlock() }
        return currentTerminalFailure
    }

    public var statistics: NativeInputSourceStatistics {
        lock.lock()
        defer { lock.unlock() }
        return NativeInputSourceStatistics(
            capturedEventCount: capturedEventCount,
            coalescedEventCount: coalescedEventCount,
            droppedEventCount: droppedEventCount
        )
    }

    private func receive(_ message: MacInputEventTapMessage) {
        switch message {
        case .disabledByTimeout, .disabledByUserInput:
            enqueueDisabledTapNotification()
        case let .event(primitive):
            enqueue(primitive)
        }
    }

    private func enqueueDisabledTapNotification() {
        lock.lock()
        guard currentTerminalFailure == nil, state == .starting || state == .running else {
            lock.unlock()
            return
        }
        // Two notifications are sufficient to preserve the bounded policy:
        // first re-enable, second terminal failure. Further disabled callbacks
        // cannot add information and never grow the callback queue.
        pendingDisabledNotifications = min(2, pendingDisabledNotifications + 1)
        let shouldSchedule = !disabledDrainScheduled
        disabledDrainScheduled = true
        lock.unlock()
        if shouldSchedule {
            processingQueue.async { [weak self] in self?.drainDisabledTapNotifications() }
        }
    }

    private func drainDisabledTapNotifications() {
        while true {
            lock.lock()
            guard pendingDisabledNotifications > 0 else {
                disabledDrainScheduled = false
                lock.unlock()
                return
            }
            pendingDisabledNotifications -= 1
            lock.unlock()
            handleDisabledTap()
        }
    }

    private func enqueue(_ primitive: MacInputEventPrimitive) {
        lock.lock()
        guard acceptingCallbacks, currentTerminalFailure == nil,
              state == .starting || state == .running else {
            droppedEventCount += 1
            lock.unlock()
            return
        }
        capturedEventCount += 1
        let isCursor = Self.isCursor(primitive.type)
        let queued = QueuedEvent(primitive: primitive, hostUs: clock.nowUs())
        if isCursor, let pendingCursorIndex {
            pendingEvents.remove(at: pendingCursorIndex)
            self.pendingCursorIndex = pendingEvents.count
            pendingEvents.append(queued)
            coalescedEventCount += 1
        } else if pendingEvents.count < NativeInputTelemetryBatchAccumulator.maximumEventCount {
            if isCursor { pendingCursorIndex = pendingEvents.count }
            pendingEvents.append(queued)
        } else {
            droppedEventCount += 1
            lock.unlock()
            recordTerminal(.inputTelemetryBufferOverflow)
            return
        }
        let shouldSchedule = !drainScheduled
        drainScheduled = true
        lock.unlock()
        if shouldSchedule {
            processingQueue.async { [weak self] in self?.drainPendingEvents() }
        }
    }

    private func drainPendingEvents() {
        while true {
            lock.lock()
            guard !pendingEvents.isEmpty else {
                drainScheduled = false
                lock.unlock()
                return
            }
            let events = pendingEvents
            pendingEvents.removeAll(keepingCapacity: true)
            pendingCursorIndex = nil
            let activeHandler = handler
            lock.unlock()
            guard let activeHandler else { continue }
            for event in events {
                if let raw = map(event.primitive, hostUs: event.hostUs) { activeHandler(raw) }
            }
        }
    }

    private func handleDisabledTap() {
        lock.lock()
        if !didAttemptReenable {
            didAttemptReenable = true
            if let session {
                lock.unlock()
                session.reenable()
            } else {
                pendingReenable = true
                lock.unlock()
            }
            return
        }
        lock.unlock()
        recordTerminal(.inputEventTapCreationFailed, notificationIsAlreadyEnqueued: true)
    }

    private func recordTerminal(
        _ error: MacNativeInputError,
        notificationIsAlreadyEnqueued: Bool = false
    ) {
        lock.lock()
        guard currentTerminalFailure == nil else { lock.unlock(); return }
        currentTerminalFailure = error
        acceptingCallbacks = false
        let callback = terminalHandler
        lock.unlock()
        if let callback {
            if notificationIsAlreadyEnqueued { callback(error) }
            else { processingQueue.async { callback(error) } }
        }
    }

    private static func isCursor(_ type: CGEventType) -> Bool {
        type == .mouseMoved || type == .leftMouseDragged
            || type == .rightMouseDragged || type == .otherMouseDragged
    }

    private func map(_ event: MacInputEventPrimitive, hostUs: Int64) -> NativeRawInputEvent? {
        switch event.type {
        case .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged:
            return .cursor(hostUs: hostUs, x: event.x, y: event.y)
        case .leftMouseDown:
            return .button(hostUs: hostUs, x: event.x, y: event.y, button: .primary, phase: .down)
        case .leftMouseUp:
            return .button(hostUs: hostUs, x: event.x, y: event.y, button: .primary, phase: .up)
        case .rightMouseDown:
            return .button(hostUs: hostUs, x: event.x, y: event.y, button: .secondary, phase: .down)
        case .rightMouseUp:
            return .button(hostUs: hostUs, x: event.x, y: event.y, button: .secondary, phase: .up)
        case .otherMouseDown, .otherMouseUp:
            let button: NativePointerButton = event.buttonNumber == 2 ? .middle : .other
            let phase: NativePointerButtonPhase = event.type == .otherMouseDown ? .down : .up
            return .button(hostUs: hostUs, x: event.x, y: event.y, button: button, phase: phase)
        case .scrollWheel:
            return .scroll(
                hostUs: hostUs,
                x: event.x,
                y: event.y,
                deltaX: event.scrollDeltaX,
                deltaY: event.scrollDeltaY
            )
        default:
            return nil
        }
    }

    private func resetAfterFailedStart() {
        lock.lock()
        state = .stopped
        handler = nil
        acceptingCallbacks = false
        session = nil
        lock.unlock()
    }
}
