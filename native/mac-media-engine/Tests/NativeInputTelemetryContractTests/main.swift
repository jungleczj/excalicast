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
    var startCount = 0
    var stopCount = 0
    private var handler: (@Sendable (NativeRawInputEvent) -> Void)?

    func start(handler: @escaping @Sendable (NativeRawInputEvent) -> Void) throws {
        startCount += 1
        if let startError { throw startError }
        self.handler = handler
    }

    func stop() {
        stopCount += 1
        handler = nil
    }

    func emit(_ event: NativeRawInputEvent) {
        handler?(event)
    }
}

private final class CapturingSink: NativeInputTelemetrySink, @unchecked Sendable {
    private(set) var events: [NativeMappedInputEvent] = []

    func consume(_ event: NativeMappedInputEvent) throws {
        events.append(event)
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

        let coalescer = NativeInputTelemetryCoalescer(maximumLosslessEvents: 4)
        try coalescer.offer(try mapper.map(.cursor(hostUs: 10_000, x: 1, y: 1)))
        try coalescer.offer(try mapper.map(.cursor(hostUs: 11_000, x: 2, y: 2)))
        try coalescer.offer(try mapper.map(.cursor(hostUs: 12_000, x: 3, y: 3)))
        try coalescer.offer(secondaryDown)
        let coalesced = coalescer.drain()
        try expect(coalesced.map(\.kind) == ["cursor", "click"], "latest cursor is coalesced before lossless click")
        try expect(coalesced[0].payload["x"] == .number(3), "coalescer retains the latest cursor")

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

        let controls = CaptureControlState()
        let timeline = RecordingTimeline(originUs: 1_000_000)
        let coordinator = InputTelemetryCoordinator(sessionId: "lesson")
        var persisted: [Data] = []
        let coordinatorSink = NativeInputTelemetryCoordinatorSink(
            sessionId: "lesson",
            producerEpoch: "native-epoch",
            controls: controls,
            timeline: timeline,
            coordinator: coordinator,
            persist: { _, _, _, data in persisted.append(data) }
        )
        try coordinatorSink.consume(try mapper.map(.cursor(hostUs: 1_100_000, x: 10, y: 20)))
        _ = controls.pause(atUs: 1_200_000)
        try coordinatorSink.consume(try mapper.map(.button(hostUs: 1_300_000, x: 10, y: 20, button: .primary, phase: .down)))
        _ = controls.resume(atUs: 1_500_000)
        try coordinatorSink.consume(try mapper.map(.scroll(hostUs: 1_600_000, x: 10, y: 20, deltaX: 0, deltaY: 3)))
        try expect(persisted.count == 2, "paused native events are ignored without renderer mediation")
        let decoded = try JSONSerialization.jsonObject(with: persisted[0]) as? [String: Any]
        let events = decoded?["events"] as? [[String: Any]]
        try expect(events?.first?["producerId"] as? String == "native-input", "native producer identity is owned by the helper")
        try expect(events?.first?["atUs"] as? Int == 100_000, "native input uses the media timeline clock")

        print("Native input telemetry contract tests passed")
    }
}
