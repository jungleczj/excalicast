import Foundation
import MacMediaEngineCore

private enum ContractFailure: Error {
    case expectation(String)
}

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw ContractFailure.expectation(message) }
}

@main
struct MacMediaEngineContractTests {
    static func main() async throws {
        let handshake = try HelperHandshake.negotiate(clientProtocolVersion: 1)
        try expect(handshake.protocolVersion == 1, "protocol version")
        try expect(handshake.engine == "mac-media-engine", "engine name")
        try expect(handshake.state == .idle, "initial state")

        do {
            _ = try HelperHandshake.negotiate(clientProtocolVersion: 2)
            throw ContractFailure.expectation("unsupported protocol must fail")
        } catch HelperProtocolError.unsupportedProtocol(2) {
            // expected
        }

        let lifecycle = HelperLifecycle()
        try await lifecycle.start(sessionId: "recording-1")
        let first = await lifecycle.stop()
        let second = await lifecycle.stop()
        let stopCount = await lifecycle.stopCount
        try expect(first == .idle, "first stop")
        try expect(second == .idle, "idempotent stop")
        try expect(stopCount == 1, "single finalize")

        var queue = LatestFrameQueue<Int>(capacity: 2)
        queue.offer(1)
        queue.offer(2)
        queue.offer(3)
        try expect(queue.count == 2, "bounded frame count")
        try expect(queue.droppedCount == 1, "oldest frame dropped")
        try expect(queue.popOldest() == 2, "kept second frame")
        try expect(queue.popOldest() == 3, "kept latest frame")

        let temporaryRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("excalicast-contract-\(UUID().uuidString)", isDirectory: true)
        let store = try SegmentedRecordingStore(root: temporaryRoot, recordingId: "recording-1")
        try store.appendFinalizedSegment(track: .screen, index: 0, data: Data([1, 2, 3]), startUs: 0, durationUs: 2_000_000)
        try store.appendFinalizedSegment(track: .microphone, index: 0, data: Data([4, 5]), startUs: 0, durationUs: 2_000_000)
        let recovered = try SegmentedRecordingStore.recover(root: temporaryRoot)
        try expect(recovered.state == .interrupted, "unfinished project recovers as interrupted")
        try expect(recovered.tracks[.screen]?.count == 1, "screen segment recovered")
        try expect(recovered.tracks[.microphone]?.count == 1, "audio segment recovered")
        try? FileManager.default.removeItem(at: temporaryRoot)

        let h264Preflight = try CapturePreflight.evaluate(
            requested: CaptureRequest(width: 3840, height: 2160, framesPerSecond: 60, codec: .h264),
            hardwareProbe: { codec in codec == .h264 },
            availableBytes: 100 * 1_024 * 1_024 * 1_024
        )
        try expect(h264Preflight.hardwareEncodingConfirmed, "hardware encoder confirmed")
        try expect(h264Preflight.effective == h264Preflight.requested, "quality is not silently reduced")

        do {
            _ = try CapturePreflight.evaluate(
                requested: CaptureRequest(width: 3840, height: 2160, framesPerSecond: 60, codec: .h264),
                hardwareProbe: { _ in false },
                availableBytes: 100 * 1_024 * 1_024 * 1_024
            )
            throw ContractFailure.expectation("software fallback must not be silent")
        } catch CapturePreflightError.hardwareEncoderUnavailable(.h264) {
            // expected
        }

        print("MacMediaEngine contract tests passed")
    }
}
