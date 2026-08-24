import CoreGraphics
import Foundation

public final class MacCGEventTapBackend: MacInputEventTapBackend, @unchecked Sendable {
    public init() {}

    public func preflightListenEventAccess() -> Bool {
        CGPreflightListenEventAccess()
    }

    public func start(
        mask: CGEventMask,
        handler: @escaping @Sendable (MacInputEventTapMessage) -> Void
    ) throws -> any MacInputEventTapSession {
        let session = CGEventTapRunLoopSession(mask: mask, handler: handler)
        try session.start()
        return session
    }
}

private final class CGEventTapRunLoopSession: MacInputEventTapSession, @unchecked Sendable {
    private let mask: CGEventMask
    private let handler: @Sendable (MacInputEventTapMessage) -> Void
    private let lock = NSLock()
    private let lifecycleLock = NSLock()
    private let ready = DispatchSemaphore(value: 0)
    private let finished = DispatchSemaphore(value: 0)
    private var runLoop: CFRunLoop?
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var startError: MacNativeInputError?
    private var running = false

    init(mask: CGEventMask, handler: @escaping @Sendable (MacInputEventTapMessage) -> Void) {
        self.mask = mask
        self.handler = handler
    }

    func start() throws {
        let thread = Thread { [self] in runEventTapThread() }
        thread.name = "com.excalicast.native-input.event-tap"
        thread.qualityOfService = .userInteractive
        thread.start()
        ready.wait()
        lock.lock()
        let error = startError
        lock.unlock()
        if let error { throw error }
    }

    func reenable() {
        lock.lock()
        let activeTap = tap
        lock.unlock()
        if let activeTap { CGEvent.tapEnable(tap: activeTap, enable: true) }
    }

    func callbackBarrier() {
        lifecycleLock.lock()
        lock.lock()
        let activeRunLoop = running ? runLoop : nil
        lock.unlock()
        guard let activeRunLoop else { lifecycleLock.unlock(); return }
        let barrier = DispatchSemaphore(value: 0)
        CFRunLoopPerformBlock(activeRunLoop, CFRunLoopMode.commonModes.rawValue) {
            barrier.signal()
        }
        CFRunLoopWakeUp(activeRunLoop)
        barrier.wait()
        lifecycleLock.unlock()
    }

    func stop() {
        lifecycleLock.lock()
        lock.lock()
        guard running, let activeRunLoop = runLoop else {
            lock.unlock()
            lifecycleLock.unlock()
            return
        }
        running = false
        let activeTap = tap
        let activeSource = source
        lock.unlock()

        if let activeTap { CGEvent.tapEnable(tap: activeTap, enable: false) }
        CFRunLoopPerformBlock(activeRunLoop, CFRunLoopMode.commonModes.rawValue) {
            if let activeSource {
                CFRunLoopRemoveSource(activeRunLoop, activeSource, CFRunLoopMode.commonModes)
            }
            CFRunLoopStop(activeRunLoop)
        }
        CFRunLoopWakeUp(activeRunLoop)
        finished.wait()
        lifecycleLock.unlock()
    }

    private func runEventTapThread() {
        autoreleasepool {
            guard let createdTap = CGEvent.tapCreate(
                tap: .cgSessionEventTap,
                place: .tailAppendEventTap,
                options: .listenOnly,
                eventsOfInterest: mask,
                callback: cgEventTapCallback,
                userInfo: Unmanaged.passUnretained(self).toOpaque()
            ) else {
                lock.lock()
                startError = .inputEventTapCreationFailed
                lock.unlock()
                ready.signal()
                finished.signal()
                return
            }
            let createdSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, createdTap, 0)
            let currentRunLoop = CFRunLoopGetCurrent()
            CFRunLoopAddSource(currentRunLoop, createdSource, .commonModes)
            CGEvent.tapEnable(tap: createdTap, enable: true)

            lock.lock()
            tap = createdTap
            source = createdSource
            runLoop = currentRunLoop
            running = true
            lock.unlock()
            ready.signal()

            CFRunLoopRun()
            CGEvent.tapEnable(tap: createdTap, enable: false)
            CFRunLoopRemoveSource(currentRunLoop, createdSource, .commonModes)
            CFMachPortInvalidate(createdTap)
            lock.lock()
            tap = nil
            source = nil
            runLoop = nil
            running = false
            lock.unlock()
            finished.signal()
        }
    }

    fileprivate func receive(type: CGEventType, event: CGEvent) {
        if type == .tapDisabledByTimeout {
            handler(.disabledByTimeout)
            return
        }
        if type == .tapDisabledByUserInput {
            handler(.disabledByUserInput)
            return
        }
        let location = event.location
        handler(.event(MacInputEventPrimitive(
            type: type,
            x: location.x,
            y: location.y,
            buttonNumber: event.getIntegerValueField(.mouseEventButtonNumber),
            scrollDeltaX: event.getDoubleValueField(.scrollWheelEventPointDeltaAxis2),
            scrollDeltaY: event.getDoubleValueField(.scrollWheelEventPointDeltaAxis1)
        )))
    }
}

private let cgEventTapCallback: CGEventTapCallBack = { _, type, event, userInfo in
    guard let userInfo else { return Unmanaged.passUnretained(event) }
    let session = Unmanaged<CGEventTapRunLoopSession>.fromOpaque(userInfo).takeUnretainedValue()
    session.receive(type: type, event: event)
    return Unmanaged.passUnretained(event)
}
