import Foundation

public enum NativeInputJSONValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case integer(Int)
    case bool(Bool)
    case null
    case array([NativeInputJSONValue])
    case object([String: NativeInputJSONValue])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Int.self) { self = .integer(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([NativeInputJSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: NativeInputJSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .string(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .integer(value): try container.encode(value)
        case let .bool(value): try container.encode(value)
        case .null: try container.encodeNil()
        case let .array(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        }
    }

    fileprivate var foundationValue: Any {
        switch self {
        case let .string(value): value
        case let .number(value): value
        case let .integer(value): value
        case let .bool(value): value
        case .null: NSNull()
        case let .array(value): value.map(\.foundationValue)
        case let .object(value): value.mapValues(\.foundationValue)
        }
    }
}

public struct NativeGlobalRect: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    fileprivate func contains(x pointX: Double, y pointY: Double) -> Bool {
        pointX >= x && pointX < x + width && pointY >= y && pointY < y + height
    }

    fileprivate var payload: [String: NativeInputJSONValue] {
        ["x": .number(x), "y": .number(y), "width": .number(width), "height": .number(height)]
    }
}

public struct NativeDisplayGeometry: Codable, Equatable, Sendable {
    public let displayId: Int
    public let bounds: NativeGlobalRect
    public let scale: Double

    public init(displayId: Int, bounds: NativeGlobalRect, scale: Double) {
        self.displayId = displayId
        self.bounds = bounds
        self.scale = scale
    }
}

public enum NativePointerButton: String, Codable, Equatable, Sendable {
    case primary
    case secondary
    case middle
    case other
}

public enum NativePointerButtonPhase: String, Codable, Equatable, Sendable {
    case down
    case up
}

public enum NativeRawInputEvent: Sendable {
    case cursor(hostUs: Int64, x: Double, y: Double)
    case button(hostUs: Int64, x: Double, y: Double, button: NativePointerButton, phase: NativePointerButtonPhase)
    case scroll(hostUs: Int64, x: Double, y: Double, deltaX: Double, deltaY: Double)

    public var hostUs: Int64 {
        switch self {
        case let .cursor(hostUs, _, _), let .button(hostUs, _, _, _, _), let .scroll(hostUs, _, _, _, _): hostUs
        }
    }
}

public struct NativeMappedInputEvent: Codable, Equatable, Sendable {
    public let hostUs: Int64
    public let kind: String
    public let payload: [String: NativeInputJSONValue]

    public init(hostUs: Int64, kind: String, payload: [String: NativeInputJSONValue]) {
        self.hostUs = hostUs
        self.kind = kind
        self.payload = payload
    }
}

public enum NativeInputTelemetryMappingError: Error, Equatable, Sendable {
    case invalidHostTimestamp
    case noDisplayForPoint
}

public final class NativeInputTelemetryMapper: @unchecked Sendable {
    public static let sourceCoordinateSpace = "macos-global-display-points-v1"
    public static let coordinateSpaceVersion = 1

    private let displays: @Sendable () -> [NativeDisplayGeometry]

    public init(displays: @escaping @Sendable () -> [NativeDisplayGeometry]) {
        self.displays = displays
    }

    public func map(_ event: NativeRawInputEvent) throws -> NativeMappedInputEvent {
        guard event.hostUs >= 0 else { throw NativeInputTelemetryMappingError.invalidHostTimestamp }
        switch event {
        case let .cursor(hostUs, x, y):
            return NativeMappedInputEvent(hostUs: hostUs, kind: "cursor", payload: try pointPayload(x: x, y: y))
        case let .button(hostUs, x, y, button, phase):
            var payload = try pointPayload(x: x, y: y)
            payload["button"] = .string(button.rawValue)
            payload["phase"] = .string(phase.rawValue)
            return NativeMappedInputEvent(hostUs: hostUs, kind: "click", payload: payload)
        case let .scroll(hostUs, x, y, deltaX, deltaY):
            var payload = try pointPayload(x: x, y: y)
            payload["deltaX"] = .number(deltaX)
            payload["deltaY"] = .number(deltaY)
            return NativeMappedInputEvent(hostUs: hostUs, kind: "scroll", payload: payload)
        }
    }

    fileprivate func windowBoundsEvent(hostUs: Int64, bounds: NativeGlobalRect) -> NativeMappedInputEvent {
        NativeMappedInputEvent(hostUs: hostUs, kind: "window-bounds", payload: bounds.payload)
    }

    private func pointPayload(x: Double, y: Double) throws -> [String: NativeInputJSONValue] {
        guard let display = displays().first(where: { $0.bounds.contains(x: x, y: y) }) else {
            throw NativeInputTelemetryMappingError.noDisplayForPoint
        }
        return [
            "x": .number(x),
            "y": .number(y),
            "sourceCoordinateSpace": .string(Self.sourceCoordinateSpace),
            "coordinateSpaceVersion": .integer(Self.coordinateSpaceVersion),
            "displayId": .integer(display.displayId),
            "scale": .number(display.scale),
        ]
    }
}

public struct NativeActiveWindowSnapshot: Equatable, Sendable {
    public let hostUs: Int64
    public let application: String
    public let bundleIdentifier: String
    public let processId: Int
    public let windowId: Int
    public let title: String
    public let bounds: NativeGlobalRect

    public init(hostUs: Int64, application: String, bundleIdentifier: String, processId: Int, windowId: Int, title: String, bounds: NativeGlobalRect) {
        self.hostUs = hostUs
        self.application = application
        self.bundleIdentifier = bundleIdentifier
        self.processId = processId
        self.windowId = windowId
        self.title = title
        self.bounds = bounds
    }
}

public final class NativeActiveWindowChangeMapper: @unchecked Sendable {
    private let mapper: NativeInputTelemetryMapper
    private let lock = NSLock()
    private var previous: NativeActiveWindowSnapshot?

    public init(mapper: NativeInputTelemetryMapper) {
        self.mapper = mapper
    }

    public func mapChanged(_ snapshot: NativeActiveWindowSnapshot) -> [NativeMappedInputEvent] {
        lock.lock()
        let old = previous
        previous = snapshot
        lock.unlock()

        let identityChanged = old.map {
            $0.application != snapshot.application || $0.bundleIdentifier != snapshot.bundleIdentifier ||
            $0.processId != snapshot.processId || $0.windowId != snapshot.windowId || $0.title != snapshot.title
        } ?? true
        let boundsChanged = old?.bounds != snapshot.bounds
        var result: [NativeMappedInputEvent] = []
        if identityChanged {
            result.append(NativeMappedInputEvent(hostUs: snapshot.hostUs, kind: "active-window", payload: [
                "application": .string(snapshot.application),
                "bundleIdentifier": .string(snapshot.bundleIdentifier),
                "processId": .integer(snapshot.processId),
                "windowId": .integer(snapshot.windowId),
                "title": .string(snapshot.title),
            ]))
        }
        if identityChanged || boundsChanged {
            result.append(mapper.windowBoundsEvent(hostUs: snapshot.hostUs, bounds: snapshot.bounds))
        }
        return result
    }
}

public enum NativeInputTelemetryCoalescerError: Error, Equatable, Sendable {
    case losslessOverflow
    case eventLimitExceeded
    case drainInProgress
    case unexpectedDrain
}

public final class NativeInputTelemetryCoalescer: @unchecked Sendable {
    private let maximumLosslessEvents: Int
    private let maximumEventCount = NativeInputTelemetryBatchAccumulator.maximumEventCount
    private let lock = NSLock()
    private var events: [NativeMappedInputEvent] = []
    private var cursorIndex: Int?
    private var losslessCount = 0
    private var inFlightEvents: [NativeMappedInputEvent]?

    public init(maximumLosslessEvents: Int = 256) {
        self.maximumLosslessEvents = min(max(0, maximumLosslessEvents), NativeInputTelemetryBatchAccumulator.maximumEventCount)
    }

    public func offer(_ event: NativeMappedInputEvent) throws {
        lock.lock()
        defer { lock.unlock() }
        guard inFlightEvents == nil else { throw NativeInputTelemetryCoalescerError.drainInProgress }
        if event.kind == "cursor" {
            if let cursorIndex { events.remove(at: cursorIndex) }
            else if events.count >= maximumEventCount { throw NativeInputTelemetryCoalescerError.eventLimitExceeded }
            cursorIndex = events.count
            events.append(event)
            return
        }
        guard losslessCount < maximumLosslessEvents, events.count < maximumEventCount else {
            throw NativeInputTelemetryCoalescerError.losslessOverflow
        }
        events.append(event)
        losslessCount += 1
    }

    public func prepareDrain() throws -> [NativeMappedInputEvent] {
        lock.lock()
        defer { lock.unlock() }
        guard inFlightEvents == nil else { throw NativeInputTelemetryCoalescerError.drainInProgress }
        guard !events.isEmpty else { return [] }
        let result = events
        events.removeAll(keepingCapacity: true)
        cursorIndex = nil
        losslessCount = 0
        inFlightEvents = result
        return result
    }

    public func acknowledgeDelivered(_ delivered: [NativeMappedInputEvent]) throws {
        lock.lock()
        defer { lock.unlock() }
        guard inFlightEvents == delivered else { throw NativeInputTelemetryCoalescerError.unexpectedDrain }
        inFlightEvents = nil
    }

    public func restore(_ failedDelivery: [NativeMappedInputEvent]) throws {
        lock.lock()
        defer { lock.unlock() }
        guard inFlightEvents == failedDelivery else { throw NativeInputTelemetryCoalescerError.unexpectedDrain }
        events = failedDelivery
        cursorIndex = events.lastIndex(where: { $0.kind == "cursor" })
        losslessCount = events.reduce(into: 0) { count, event in if event.kind != "cursor" { count += 1 } }
        inFlightEvents = nil
    }

    public func drain() -> [NativeMappedInputEvent] {
        lock.lock()
        defer { lock.unlock() }
        precondition(inFlightEvents == nil, "A prepared input telemetry delivery must be acknowledged or restored")
        let result = events
        events.removeAll(keepingCapacity: true)
        cursorIndex = nil
        losslessCount = 0
        return result
    }
}

public enum NativeInputTelemetryBatchAccumulatorError: Error, Equatable, Sendable {
    case losslessOverflow
    case eventLimitExceeded
    case nonMonotonicHostTimestamp
    case invalidConfiguration
    case drainInProgress
    case unexpectedBatch
}

public enum NativeInputTelemetryFlushDecision: Equatable, Sendable {
    case notDue
    case eventCountLimit
    case payloadByteLimit
    case maximumAge
}

public struct NativeInputTelemetryBatch: Equatable, Sendable {
    public let events: [NativeMappedInputEvent]
    public let serializedPayload: Data
    public let firstHostUs: Int64
    public let lastHostUs: Int64
}

private struct NativeInputTelemetryBatchWireEnvelope: Codable {
    let schemaVersion: Int
    let events: [NativeMappedInputEvent]
}

public final class NativeInputTelemetryBatchAccumulator: @unchecked Sendable {
    public static let maximumEventCount = 256
    public static let maximumPayloadBytes = 256 * 1_024
    public static let maximumAgeUs: Int64 = 100_000

    private let maximumEventCount: Int
    private let maximumPayloadBytes: Int
    private let maximumAgeUs: Int64
    private let lock = NSLock()
    private var events: [NativeMappedInputEvent] = []
    private var cursorIndex: Int?
    private var inFlightBatch: NativeInputTelemetryBatch?

    public init(maximumEventCount: Int = 256, maximumPayloadBytes: Int = 256 * 1_024, maximumAgeUs: Int64 = 100_000) {
        self.maximumEventCount = min(max(1, maximumEventCount), Self.maximumEventCount)
        self.maximumPayloadBytes = min(max(1, maximumPayloadBytes), Self.maximumPayloadBytes)
        self.maximumAgeUs = min(max(0, maximumAgeUs), Self.maximumAgeUs)
    }

    public func offer(_ event: NativeMappedInputEvent) throws {
        lock.lock()
        defer { lock.unlock() }
        guard inFlightBatch == nil else { throw NativeInputTelemetryBatchAccumulatorError.drainInProgress }
        if let last = events.last, event.hostUs < last.hostUs {
            throw NativeInputTelemetryBatchAccumulatorError.nonMonotonicHostTimestamp
        }
        var candidate = events
        var candidateCursorIndex = cursorIndex
        if event.kind == "cursor", let oldCursorIndex = candidateCursorIndex {
            candidate.remove(at: oldCursorIndex)
            candidateCursorIndex = candidate.count
            candidate.append(event)
        } else {
            candidate.append(event)
            if event.kind == "cursor" { candidateCursorIndex = candidate.count - 1 }
        }
        guard candidate.count <= maximumEventCount, try serializedPayload(for: candidate).count <= maximumPayloadBytes else {
            if event.kind == "cursor" { throw NativeInputTelemetryBatchAccumulatorError.eventLimitExceeded }
            throw NativeInputTelemetryBatchAccumulatorError.losslessOverflow
        }
        events = candidate
        cursorIndex = candidateCursorIndex
    }

    public func flushDecision(atHostUs: Int64) -> NativeInputTelemetryFlushDecision {
        lock.lock()
        defer { lock.unlock() }
        guard let first = events.first else { return .notDue }
        if events.count >= maximumEventCount { return .eventCountLimit }
        if (try? serializedPayload(for: events).count) ?? 0 >= maximumPayloadBytes { return .payloadByteLimit }
        if atHostUs - first.hostUs >= maximumAgeUs { return .maximumAge }
        return .notDue
    }

    public func drain() throws -> NativeInputTelemetryBatch? {
        lock.lock()
        defer { lock.unlock() }
        guard inFlightBatch == nil else { throw NativeInputTelemetryBatchAccumulatorError.drainInProgress }
        guard let first = events.first, let last = events.last else { return nil }
        let batch = NativeInputTelemetryBatch(
            events: events,
            serializedPayload: try serializedPayload(for: events),
            firstHostUs: first.hostUs,
            lastHostUs: last.hostUs
        )
        events.removeAll(keepingCapacity: true)
        cursorIndex = nil
        inFlightBatch = batch
        return batch
    }

    public func restore(_ batch: NativeInputTelemetryBatch) throws {
        lock.lock()
        defer { lock.unlock() }
        guard inFlightBatch == batch else { throw NativeInputTelemetryBatchAccumulatorError.unexpectedBatch }
        events = batch.events
        cursorIndex = events.lastIndex(where: { $0.kind == "cursor" })
        inFlightBatch = nil
    }

    public func acknowledgePersisted(_ batch: NativeInputTelemetryBatch) throws {
        lock.lock()
        defer { lock.unlock() }
        guard inFlightBatch == batch else { throw NativeInputTelemetryBatchAccumulatorError.unexpectedBatch }
        inFlightBatch = nil
    }

    private func serializedPayload(for events: [NativeMappedInputEvent]) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(NativeInputTelemetryBatchWireEnvelope(schemaVersion: 1, events: events))
    }
}

public protocol NativeInputTelemetrySource: AnyObject, Sendable {
    func start(handler: @escaping @Sendable (NativeRawInputEvent) -> Void) throws
    func stop()
}

public protocol NativeInputTelemetrySink: AnyObject, Sendable {
    func consume(_ event: NativeMappedInputEvent) throws
}

public protocol NativeInputTelemetryBatchSink: NativeInputTelemetrySink {
    func consumeBatch(_ events: [NativeMappedInputEvent]) throws
}

public enum NativeInputTelemetryMonitorError: Error, Equatable, Sendable {
    case inputMonitoringPermissionRequired
    case losslessOverflow
    case mappingFailed(NativeInputTelemetryMappingError)
    case deliveryInProgress
}

public enum NativeInputTelemetryMonitorState: Equatable, Sendable {
    case stopped
    case starting
    case running
    case failed
}

public final class NativeInputTelemetryMonitor: @unchecked Sendable {
    private let source: any NativeInputTelemetrySource
    private let mapper: NativeInputTelemetryMapper
    private let sink: any NativeInputTelemetrySink
    private let activeWindowSnapshot: @Sendable () -> NativeActiveWindowSnapshot?
    private let windowMapper: NativeActiveWindowChangeMapper
    private let coalescer: NativeInputTelemetryCoalescer
    private let lock = NSLock()
    private var currentState: NativeInputTelemetryMonitorState = .stopped
    private var pendingError: NativeInputTelemetryMonitorError?
    private var stopRequestedDuringStart = false

    public init(source: any NativeInputTelemetrySource, mapper: NativeInputTelemetryMapper, sink: any NativeInputTelemetrySink, activeWindowSnapshot: @escaping @Sendable () -> NativeActiveWindowSnapshot?) {
        self.source = source
        self.mapper = mapper
        self.sink = sink
        self.activeWindowSnapshot = activeWindowSnapshot
        self.windowMapper = NativeActiveWindowChangeMapper(mapper: mapper)
        self.coalescer = NativeInputTelemetryCoalescer()
    }

    public var state: NativeInputTelemetryMonitorState {
        lock.lock()
        defer { lock.unlock() }
        return currentState
    }

    public func start() throws {
        lock.lock()
        guard currentState == .stopped || currentState == .failed else { lock.unlock(); return }
        currentState = .starting
        pendingError = nil
        stopRequestedDuringStart = false
        lock.unlock()
        do {
            try source.start { [weak self] event in self?.receive(event) }
            lock.lock()
            let shouldStop = stopRequestedDuringStart
            currentState = shouldStop ? .stopped : .running
            stopRequestedDuringStart = false
            lock.unlock()
            if shouldStop { source.stop() }
        } catch {
            lock.lock()
            currentState = stopRequestedDuringStart ? .stopped : .failed
            stopRequestedDuringStart = false
            lock.unlock()
            throw error
        }
    }

    public func stop() {
        lock.lock()
        if currentState == .starting {
            stopRequestedDuringStart = true
            lock.unlock()
            return
        }
        guard currentState == .running else { lock.unlock(); return }
        currentState = .stopped
        lock.unlock()
        source.stop()
    }

    public func sampleActiveWindow() throws {
        guard state == .running, let snapshot = activeWindowSnapshot() else { return }
        for event in windowMapper.mapChanged(snapshot) { try coalescer.offer(event) }
    }

    public func flush() throws {
        lock.lock()
        let error = pendingError
        lock.unlock()
        if let error { throw error }
        let prepared = try coalescer.prepareDrain()
        guard !prepared.isEmpty else { return }
        do {
            if let batchSink = sink as? any NativeInputTelemetryBatchSink {
                try batchSink.consumeBatch(prepared)
            } else {
                for event in prepared { try sink.consume(event) }
            }
            try coalescer.acknowledgeDelivered(prepared)
        } catch {
            do {
                try coalescer.restore(prepared)
            } catch {
                recordTerminal(.deliveryInProgress)
            }
            throw error
        }
    }

    private func receive(_ event: NativeRawInputEvent) {
        lock.lock()
        let acceptsEvent = currentState == .starting || currentState == .running
        let terminalError = pendingError
        lock.unlock()
        guard acceptsEvent, terminalError == nil else { return }
        do {
            let mapped = try mapper.map(event)
            try coalescer.offer(mapped)
        } catch let error as NativeInputTelemetryMappingError {
            recordTerminal(.mappingFailed(error))
        } catch {
            recordTerminal(.losslessOverflow)
        }
    }

    private func recordTerminal(_ error: NativeInputTelemetryMonitorError) {
        lock.lock()
        if pendingError == nil { pendingError = error }
        lock.unlock()
    }
}

public final class NativeInputTelemetryCoordinatorSink: NativeInputTelemetryBatchSink, @unchecked Sendable {
    private let sessionId: String
    private let producerEpoch: String
    private let controls: CaptureControlState
    private let timeline: RecordingTimeline
    private let coordinator: InputTelemetryCoordinator
    private let persist: @Sendable (_ index: Int, _ startUs: Int64, _ durationUs: Int64, _ data: Data) throws -> Void
    private let accumulator = NativeInputTelemetryBatchAccumulator()
    private let lock = NSLock()
    private var nextSequence = 0
    private var writeInFlight = false
    private var retryingEvents: [NativeMappedInputEvent]?

    public init(sessionId: String, producerEpoch: String, controls: CaptureControlState, timeline: RecordingTimeline, coordinator: InputTelemetryCoordinator, persist: @escaping @Sendable (_ index: Int, _ startUs: Int64, _ durationUs: Int64, _ data: Data) throws -> Void) {
        self.sessionId = sessionId
        self.producerEpoch = producerEpoch
        self.controls = controls
        self.timeline = timeline
        self.coordinator = coordinator
        self.persist = persist
    }

    public func consume(_ event: NativeMappedInputEvent) throws {
        guard let adjustedHostUs = controls.adjustedPresentationUs(event.hostUs) else { return }
        lock.lock()
        guard !writeInFlight, retryingEvents == nil else { lock.unlock(); throw InputTelemetryBatchError.busy }
        lock.unlock()
        try accumulator.offer(NativeMappedInputEvent(
            hostUs: timeline.relativeUs(for: adjustedHostUs),
            kind: event.kind,
            payload: event.payload
        ))
    }

    public func consumeBatch(_ events: [NativeMappedInputEvent]) throws {
        lock.lock()
        let retry = retryingEvents
        lock.unlock()
        if let retry {
            guard retry == events else { throw InputTelemetryBatchError.busy }
            try flush()
            lock.lock()
            retryingEvents = nil
            lock.unlock()
            return
        }
        do {
            for event in events { try consume(event) }
            try flush()
        } catch {
            lock.lock()
            retryingEvents = events
            lock.unlock()
            throw error
        }
    }

    public func flush() throws {
        lock.lock()
        guard !writeInFlight else { lock.unlock(); throw InputTelemetryBatchError.busy }
        writeInFlight = true
        let sequence = nextSequence
        lock.unlock()
        defer {
            lock.lock()
            writeInFlight = false
            lock.unlock()
        }
        guard let batch = try accumulator.drain() else { return }
        let rawEvents: [[String: Any]] = batch.events.enumerated().map { offset, event in
            [
                "schemaVersion": 1,
                "sessionId": sessionId,
                "producerId": "native-input",
                "producerEpoch": producerEpoch,
                "producerSequence": sequence + offset,
                "surfaceId": "macos-global",
                "kind": event.kind,
                "payload": event.payload
                    .mapValues(\.foundationValue)
                    .merging(["nativeProjectAtUs": event.hostUs]) { _, nativeTimestamp in nativeTimestamp },
            ]
        }
        do {
            let payload = try JSONSerialization.data(withJSONObject: ["schemaVersion": 1, "events": rawEvents], options: [.sortedKeys])
            guard payload.count <= NativeInputTelemetryBatchAccumulator.maximumPayloadBytes else {
                throw NativeInputTelemetryBatchAccumulatorError.losslessOverflow
            }
            _ = try coordinator.append(payload: payload, projectAtUs: batch.firstHostUs, persist: persist)
            try accumulator.acknowledgePersisted(batch)
        } catch {
            try accumulator.restore(batch)
            throw error
        }
        lock.lock()
        nextSequence += batch.events.count
        lock.unlock()
    }
}
