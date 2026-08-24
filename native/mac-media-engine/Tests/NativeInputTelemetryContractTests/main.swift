import Foundation
import MacMediaEngineCore

private enum TestFailure: Error {
    case expectation(String)
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    guard try condition() else { throw TestFailure.expectation(message) }
}

private final class FakeSource: NativeInputTelemetrySource, @unchecked Sendable {
    var startError: NativeInputTelemetryMonitorError?
    var eventDuringStart: NativeRawInputEvent?
    var onStart: (() -> Void)?
    var onStop: (() -> Void)?
    var startCount = 0
    var stopCount = 0
    private var handler: (@Sendable (NativeRawInputEvent) -> Void)?

    func start(handler: @escaping @Sendable (NativeRawInputEvent) -> Void) throws {
        startCount += 1
        if let startError { throw startError }
        self.handler = handler
        if let eventDuringStart { handler(eventDuringStart) }
        onStart?()
    }

    func stop() {
        stopCount += 1
        handler = nil
        onStop?()
    }

    func emit(_ event: NativeRawInputEvent) {
        handler?(event)
    }
}

private enum PersistenceFailure: Error {
    case requested
}

private final class PersistedBatches: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [Data] = []
    private var shouldFail = false

    func failNext() {
        lock.lock()
        shouldFail = true
        lock.unlock()
    }

    func persist(_ data: Data) throws {
        lock.lock()
        let fail = shouldFail
        shouldFail = false
        if !fail { values.append(data) }
        lock.unlock()
        if fail { throw PersistenceFailure.requested }
    }

    var batches: [Data] {
        lock.lock()
        defer { lock.unlock() }
        return values
    }
}

private final class CapturingSink: NativeInputTelemetrySink, @unchecked Sendable {
    private(set) var events: [NativeMappedInputEvent] = []

    func consume(_ event: NativeMappedInputEvent) throws {
        events.append(event)
    }
}

private final class FailingCapturingSink: NativeInputTelemetrySink, @unchecked Sendable {
    private(set) var events: [NativeMappedInputEvent] = []
    private var failsAfterSuccessfulEvents: Int

    init(failsAfterSuccessfulEvents: Int) {
        self.failsAfterSuccessfulEvents = failsAfterSuccessfulEvents
    }

    func consume(_ event: NativeMappedInputEvent) throws {
        if events.count == failsAfterSuccessfulEvents {
            failsAfterSuccessfulEvents = .max
            throw PersistenceFailure.requested
        }
        events.append(event)
    }
}

private final class ConcurrentWindowEvents: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [[NativeMappedInputEvent]] = []

    func append(_ events: [NativeMappedInputEvent]) {
        lock.lock()
        values.append(events)
        lock.unlock()
    }

    var flattened: [NativeMappedInputEvent] {
        lock.lock()
        defer { lock.unlock() }
        return values.flatMap { $0 }
    }
}

@main
struct NativeInputTelemetryContractTests {
    static func main() throws {
        let displays = [
            NativeDisplayGeometry(
                displayId: 7,
                bounds: NativeGlobalRect(x: -1_440, y: 0, width: 1_440, height: 900),
                scale: 2
            ),
            NativeDisplayGeometry(
                displayId: 9,
                bounds: NativeGlobalRect(x: 0, y: 0, width: 1_920, height: 1_080),
                scale: 1
            ),
        ]
        let mapper = NativeInputTelemetryMapper(displays: { displays })
        let cursor = try mapper.map(.cursor(hostUs: 1_000, x: -720, y: 450))
        try expect(cursor.kind == "cursor", "cursor kind is preserved")
        try expect(cursor.payload["x"] == .number(-720), "global point x is not converted to pixels")
        try expect(cursor.payload["displayId"] == .integer(7), "secondary display identity is retained")
        try expect(cursor.payload["scale"] == .number(2), "retina scale is metadata, not coordinate multiplication")
        try expect(
            cursor.payload["sourceCoordinateSpace"] == .string("macos-global-display-points-v1"),
            "coordinate space is versioned"
        )

        let secondaryDown = try mapper.map(.button(
            hostUs: 2_000,
            x: 100,
            y: 200,
            button: .secondary,
            phase: .down
        ))
        try expect(secondaryDown.kind == "click", "button event maps to click")
        try expect(secondaryDown.payload["button"] == .string("secondary"), "secondary button is not collapsed")
        try expect(secondaryDown.payload["phase"] == .string("down"), "button phase is lossless")

        let scroll = try mapper.map(.scroll(hostUs: 3_000, x: 120, y: 220, deltaX: 1.5, deltaY: -8))
        try expect(scroll.payload["deltaX"] == .number(1.5), "horizontal scroll is retained")
        try expect(scroll.payload["deltaY"] == .number(-8), "vertical scroll is retained")

        let windowMapper = NativeActiveWindowChangeMapper(mapper: mapper)
        let initialWindow = NativeActiveWindowSnapshot(
            hostUs: 4_000,
            application: "Keynote",
            bundleIdentifier: "com.apple.iWork.Keynote",
            processId: 44,
            windowId: 55,
            title: "Lesson",
            bounds: NativeGlobalRect(x: 40, y: 50, width: 800, height: 600)
        )
        let initial = windowMapper.mapChanged(initialWindow)
        try expect(initial.map(\.kind) == ["active-window", "window-bounds"], "initial foreground window emits identity and bounds")
        try expect(windowMapper.mapChanged(initialWindow).isEmpty, "unchanged polling does not duplicate events")
        let moved = NativeActiveWindowSnapshot(
            hostUs: 5_000,
            application: initialWindow.application,
            bundleIdentifier: initialWindow.bundleIdentifier,
            processId: initialWindow.processId,
            windowId: initialWindow.windowId,
            title: initialWindow.title,
            bounds: NativeGlobalRect(x: 50, y: 60, width: 800, height: 600)
        )
        try expect(windowMapper.mapChanged(moved).map(\.kind) == ["window-bounds"], "bounds-only changes do not repeat active app")

        let concurrentWindowMapper = NativeActiveWindowChangeMapper(mapper: mapper)
        let concurrentEvents = ConcurrentWindowEvents()
        let concurrentWindow = NativeActiveWindowSnapshot(
            hostUs: 5_500,
            application: "Preview",
            bundleIdentifier: "com.apple.Preview",
            processId: 45,
            windowId: 56,
            title: "Reference",
            bounds: NativeGlobalRect(x: 70, y: 80, width: 600, height: 400)
        )
        let concurrentGroup = DispatchGroup()
        for _ in 0..<2 {
            concurrentGroup.enter()
            DispatchQueue.global().async {
                concurrentEvents.append(concurrentWindowMapper.mapChanged(concurrentWindow))
                concurrentGroup.leave()
            }
        }
        concurrentGroup.wait()
        try expect(concurrentEvents.flattened.map(\.kind) == ["active-window", "window-bounds"], "concurrent window sampling emits one linearized initial change")

        let coalescer = NativeInputTelemetryCoalescer(maximumLosslessEvents: 4)
        try coalescer.offer(try mapper.map(.cursor(hostUs: 10_000, x: 1, y: 1)))
        try coalescer.offer(try mapper.map(.cursor(hostUs: 11_000, x: 2, y: 2)))
        try coalescer.offer(try mapper.map(.cursor(hostUs: 12_000, x: 3, y: 3)))
        try coalescer.offer(secondaryDown)
        let coalesced = coalescer.drain()
        try expect(coalesced.map(\.kind) == ["cursor", "click"], "latest cursor is coalesced before lossless click")
        try expect(coalesced[0].payload["x"] == .number(3), "coalescer retains the latest cursor")

        let inFlightCoalescer = NativeInputTelemetryCoalescer()
        let inFlightClick = try mapper.map(.button(hostUs: 13_000, x: 3, y: 3, button: .primary, phase: .down))
        try inFlightCoalescer.offer(inFlightClick)
        let inFlightDelivery = try inFlightCoalescer.prepareDrain()
        try inFlightCoalescer.offer(try mapper.map(.cursor(hostUs: 13_001, x: 4, y: 4)))
        try inFlightCoalescer.offer(try mapper.map(.scroll(hostUs: 13_002, x: 4, y: 4, deltaX: 0, deltaY: 1)))
        try inFlightCoalescer.acknowledgeDelivered(inFlightDelivery)
        try expect(try inFlightCoalescer.prepareDrain().map(\.kind) == ["cursor", "scroll"], "new input remains bounded and lossless while an earlier delivery is in flight")

        let accumulator = NativeInputTelemetryBatchAccumulator()
        for sequence in 0..<255 {
            try accumulator.offer(NativeMappedInputEvent(
                hostUs: Int64(30_000 + sequence),
                kind: "click",
                payload: ["sequence": .integer(sequence)]
            ))
        }
        try accumulator.offer(NativeMappedInputEvent(
            hostUs: 30_255,
            kind: "cursor",
            payload: ["x": .number(1), "y": .number(2)]
        ))
        try expect(
            accumulator.flushDecision(atHostUs: 30_255) == .eventCountLimit,
            "a batch at 256 serialized events is due immediately"
        )
        try accumulator.offer(NativeMappedInputEvent(
            hostUs: 30_256,
            kind: "cursor",
            payload: ["x": .number(3), "y": .number(4)]
        ))
        let countBounded = try accumulator.drain()
        try expect(countBounded?.events.count == 256, "cursor replacement never exceeds the event limit")
        try expect(countBounded?.events.last?.payload["x"] == .number(3), "batching retains only the latest cursor")

        let ageBounded = NativeInputTelemetryBatchAccumulator()
        try ageBounded.offer(NativeMappedInputEvent(hostUs: 40_000, kind: "scroll", payload: ["deltaY": .number(1)]))
        try expect(ageBounded.flushDecision(atHostUs: 139_999) == .notDue, "a younger batch is not due")
        try expect(ageBounded.flushDecision(atHostUs: 140_000) == .maximumAge, "a 100ms-old batch is due")

        let clampedAge = NativeInputTelemetryBatchAccumulator(maximumAgeUs: 1_000_000)
        try clampedAge.offer(NativeMappedInputEvent(hostUs: 41_000, kind: "scroll", payload: ["deltaY": .number(1)]))
        try expect(clampedAge.flushDecision(atHostUs: 141_000) == .maximumAge, "public configuration cannot extend the 100ms age maximum")

        let bytesBounded = NativeInputTelemetryBatchAccumulator(maximumPayloadBytes: 256)
        do {
            try bytesBounded.offer(NativeMappedInputEvent(
                hostUs: 50_000,
                kind: "click",
                payload: ["text": .string(String(repeating: "x", count: 512))]
            ))
            throw TestFailure.expectation("oversized lossless payload must fail explicitly")
        } catch NativeInputTelemetryBatchAccumulatorError.losslessOverflow {
            // Expected: lossless data is never silently discarded.
        }

        let hardBytesBounded = NativeInputTelemetryBatchAccumulator(maximumPayloadBytes: 1_000_000)
        do {
            try hardBytesBounded.offer(NativeMappedInputEvent(
                hostUs: 51_000,
                kind: "click",
                payload: ["text": .string(String(repeating: "x", count: 300_000))]
            ))
            throw TestFailure.expectation("public configuration cannot extend the 256KiB payload maximum")
        } catch NativeInputTelemetryBatchAccumulatorError.losslessOverflow {
            // Expected: the hard payload maximum wins over a larger public value.
        }

        let retrySafe = NativeInputTelemetryBatchAccumulator()
        try retrySafe.offer(NativeMappedInputEvent(hostUs: 60_000, kind: "click", payload: ["id": .integer(1)]))
        try retrySafe.offer(NativeMappedInputEvent(hostUs: 60_001, kind: "scroll", payload: ["id": .integer(2)]))
        let failedBatch = try retrySafe.drain()
        try expect(failedBatch?.events.map(\.kind) == ["click", "scroll"], "drain exposes the pending lossless events")
        try retrySafe.restore(failedBatch!)
        let retriedBatch = try retrySafe.drain()
        try expect(retriedBatch?.events == failedBatch?.events, "failed persistence restores the identical batch without gaps or duplicates")

        let failingSource = FakeSource()
        failingSource.startError = .inputMonitoringPermissionRequired
        let failingMonitor = NativeInputTelemetryMonitor(
            source: failingSource,
            mapper: mapper,
            sink: CapturingSink(),
            activeWindowSnapshot: { nil }
        )
        do {
            try failingMonitor.start()
            throw TestFailure.expectation("event tap failure must be explicit")
        } catch NativeInputTelemetryMonitorError.inputMonitoringPermissionRequired {
            // Expected. The monitor never requests permission itself.
        }
        try expect(failingMonitor.state == .failed, "failed event tap cannot claim a running capability")

        let source = FakeSource()
        let sink = CapturingSink()
        let monitor = NativeInputTelemetryMonitor(
            source: source,
            mapper: mapper,
            sink: sink,
            activeWindowSnapshot: { initialWindow }
        )
        try monitor.start()
        try monitor.start()
        source.emit(.cursor(hostUs: 20_000, x: 10, y: 20))
        source.emit(.cursor(hostUs: 21_000, x: 30, y: 40))
        source.emit(.button(hostUs: 22_000, x: 30, y: 40, button: .primary, phase: .up))
        try monitor.sampleActiveWindow()
        try monitor.flush()
        monitor.stop()
        monitor.stop()
        try expect(source.startCount == 1 && source.stopCount == 1, "monitor start and stop are idempotent")
        try expect(monitor.state == .stopped, "stopped lifecycle is observable")
        try expect(sink.events.map(\.kind) == ["cursor", "click", "active-window", "window-bounds"], "monitor merges input and window changes through one sink")

        let partialSource = FakeSource()
        let partialSink = FailingCapturingSink(failsAfterSuccessfulEvents: 1)
        let partialMonitor = NativeInputTelemetryMonitor(
            source: partialSource,
            mapper: mapper,
            sink: partialSink,
            activeWindowSnapshot: { nil }
        )
        try partialMonitor.start()
        partialSource.emit(.cursor(hostUs: 22_500, x: 30, y: 40))
        partialSource.emit(.button(hostUs: 22_501, x: 30, y: 40, button: .primary, phase: .down))
        do {
            try partialMonitor.flush()
            throw TestFailure.expectation("generic sink failure must surface")
        } catch PersistenceFailure.requested {
            // Expected: first event was consumed, remaining suffix stays pending.
        }
        try partialMonitor.flush()
        try expect(partialSink.events.map(\.kind) == ["cursor", "click"], "generic fallback retries only the unconsumed suffix")

        let synchronousSource = FakeSource()
        synchronousSource.eventDuringStart = .cursor(hostUs: 23_000, x: 35, y: 45)
        let synchronousSink = CapturingSink()
        let synchronousMonitor = NativeInputTelemetryMonitor(
            source: synchronousSource,
            mapper: mapper,
            sink: synchronousSink,
            activeWindowSnapshot: { nil }
        )
        try synchronousMonitor.start()
        try synchronousMonitor.flush()
        try expect(synchronousSink.events.map(\.kind) == ["cursor"], "a source event emitted synchronously from start is retained")

        let stoppingSource = FakeSource()
        var stoppingMonitor: NativeInputTelemetryMonitor?
        stoppingSource.onStart = { stoppingMonitor?.stop() }
        stoppingMonitor = NativeInputTelemetryMonitor(
            source: stoppingSource,
            mapper: mapper,
            sink: CapturingSink(),
            activeWindowSnapshot: { nil }
        )
        try stoppingMonitor?.start()
        try expect(stoppingSource.stopCount == 1 && stoppingMonitor?.state == .stopped, "stop during source start completes without a racing restart")

        let raceSource = FakeSource()
        var raceMonitor: NativeInputTelemetryMonitor?
        raceSource.onStop = { try? raceMonitor?.start() }
        let raceSink = CapturingSink()
        raceMonitor = NativeInputTelemetryMonitor(
            source: raceSource,
            mapper: mapper,
            sink: raceSink,
            activeWindowSnapshot: { nil }
        )
        try raceMonitor?.start()
        raceMonitor?.stop()
        raceSource.emit(.cursor(hostUs: 23_500, x: 35, y: 45))
        try raceMonitor?.flush()
        try expect(raceSource.startCount == 2 && raceSource.stopCount == 1 && raceMonitor?.state == .running, "stop overlapping a queued restart cannot shut down the new source generation")
        try expect(raceSink.events.map(\.kind) == ["cursor"], "new source generation remains live after old stop completes")

        let mappingFailureSource = FakeSource()
        let mappingFailureMonitor = NativeInputTelemetryMonitor(
            source: mappingFailureSource,
            mapper: mapper,
            sink: CapturingSink(),
            activeWindowSnapshot: { nil }
        )
        try mappingFailureMonitor.start()
        mappingFailureSource.emit(.cursor(hostUs: 24_000, x: 9_999, y: 9_999))
        do {
            try mappingFailureMonitor.flush()
            throw TestFailure.expectation("unmappable lossless source input must surface to the monitor caller")
        } catch NativeInputTelemetryMonitorError.mappingFailed(.noDisplayForPoint) {
            // Expected: mapping failures are terminal, not ignored with try?.
        }

        let controls = CaptureControlState()
        let timeline = RecordingTimeline(originUs: 1_000_000)
        let coordinator = InputTelemetryCoordinator(sessionId: "lesson")
        let persisted = PersistedBatches()
        let coordinatorSink = NativeInputTelemetryCoordinatorSink(
            sessionId: "lesson",
            producerEpoch: "native-epoch",
            controls: controls,
            timeline: timeline,
            coordinator: coordinator,
            persist: { _, _, _, data in try persisted.persist(data) }
        )
        try coordinatorSink.consume(try mapper.map(.cursor(hostUs: 1_100_000, x: 10, y: 20)))
        _ = controls.pause(atUs: 1_200_000)
        try coordinatorSink.consume(try mapper.map(.button(hostUs: 1_300_000, x: 10, y: 20, button: .primary, phase: .down)))
        _ = controls.resume(atUs: 1_500_000)
        try coordinatorSink.consume(try mapper.map(.scroll(hostUs: 1_600_000, x: 10, y: 20, deltaX: 0, deltaY: 3)))
        try coordinatorSink.flush()
        try expect(persisted.batches.count == 1, "unpaused native events are persisted as one bounded producer batch")
        let decoded = try JSONSerialization.jsonObject(with: persisted.batches[0]) as? [String: Any]
        let events = decoded?["events"] as? [[String: Any]]
        try expect(events?.first?["producerId"] as? String == "native-input", "native producer identity is owned by the helper")
        try expect(events?.first?["atUs"] as? Int == 100_000, "native input uses the media timeline clock")
        try expect(events?.count == 2, "paused native events are omitted from the persisted batch")
        try expect(events?.last?["atUs"] as? Int == 300_000, "batched native input preserves compacted timeline gaps")

        let batchedSource = FakeSource()
        let batchedMonitor = NativeInputTelemetryMonitor(
            source: batchedSource,
            mapper: mapper,
            sink: coordinatorSink,
            activeWindowSnapshot: { nil }
        )
        try batchedMonitor.start()
        batchedSource.emit(.cursor(hostUs: 1_700_000, x: 20, y: 30))
        batchedSource.emit(.button(hostUs: 1_700_001, x: 20, y: 30, button: .primary, phase: .down))
        try batchedMonitor.flush()
        try expect(persisted.batches.count == 2, "monitor flush checkpoints its input through one coordinator batch")
        let monitoredPayload = try JSONSerialization.jsonObject(with: persisted.batches[1]) as? [String: Any]
        try expect((monitoredPayload?["events"] as? [[String: Any]])?.count == 2, "monitor batch retains cursor and click together")

        batchedSource.emit(.scroll(hostUs: 1_800_000, x: 20, y: 30, deltaX: 0, deltaY: 2))
        batchedSource.emit(.button(hostUs: 1_800_001, x: 20, y: 30, button: .primary, phase: .up))
        persisted.failNext()
        do {
            try batchedMonitor.flush()
            throw TestFailure.expectation("a failed coordinator persistence must reach the monitor")
        } catch PersistenceFailure.requested {
            // Expected: monitor restores its drained events and the coordinator restores its pending batch.
        }
        try expect(persisted.batches.count == 2, "failed monitor persistence does not create a segment")
        try batchedMonitor.flush()
        try expect(persisted.batches.count == 3, "retry persists the restored monitor batch exactly once")
        let retriedPayload = try JSONSerialization.jsonObject(with: persisted.batches[2]) as? [String: Any]
        try expect((retriedPayload?["events"] as? [[String: Any]])?.map { $0["kind"] as? String } == ["scroll", "click"], "retry retains current and remaining failed lossless events without duplication")

        let nearLimitCoordinator = InputTelemetryCoordinator(sessionId: "near-limit")
        let nearLimitPersisted = PersistedBatches()
        let nearLimitSink = NativeInputTelemetryCoordinatorSink(
            sessionId: "near-limit",
            producerEpoch: "near-limit-epoch",
            controls: CaptureControlState(),
            timeline: RecordingTimeline(originUs: 0),
            coordinator: nearLimitCoordinator,
            persist: { _, _, _, data in try nearLimitPersisted.persist(data) }
        )
        let nearLimitEvents = [
            NativeMappedInputEvent(hostUs: 10, kind: "click", payload: ["text": .string(String(repeating: "x", count: 260_000))]),
            NativeMappedInputEvent(hostUs: 11, kind: "scroll", payload: ["text": .string(String(repeating: "y", count: 4_096))]),
        ]
        nearLimitPersisted.failNext()
        do {
            try nearLimitSink.consumeBatch(nearLimitEvents)
            throw TestFailure.expectation("near-limit persistence failure must be retryable")
        } catch PersistenceFailure.requested {
            // Expected: the first bounded output batch is restored before the next event is admitted.
        }
        try nearLimitSink.consumeBatch(nearLimitEvents)
        try expect(nearLimitPersisted.batches.count == 2, "near-limit next event remains queued across retry and persists in a later batch")
        try expect(nearLimitPersisted.batches.allSatisfy { $0.count <= 256 * 1_024 }, "every final authoritative native JSON segment stays within 256KiB")
        let nearLimitLast = try JSONSerialization.jsonObject(with: nearLimitPersisted.batches[1]) as? [String: Any]
        try expect((nearLimitLast?["events"] as? [[String: Any]])?.map { $0["kind"] as? String } == ["scroll"], "the event after the near-limit boundary is retained and retried")

        print("Native input telemetry contract tests passed")
    }
}
