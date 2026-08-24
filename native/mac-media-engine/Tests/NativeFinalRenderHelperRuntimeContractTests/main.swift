import Foundation
import MacMediaEngineFinalRenderHelperRuntime
import MacMediaEngineFinalRenderJobController

private enum ContractFailure: Error {
    case expectation(String)
}

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw ContractFailure.expectation(message) }
}

private actor AsyncGate {
    private var open = false

    func wait() async {
        while !open { await Task.yield() }
    }

    func release() { open = true }
}

private func waitUntil(
    _ message: String,
    condition: @escaping @Sendable () async -> Bool
) async throws {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: .seconds(2))
    while !(await condition()) {
        guard clock.now < deadline else { throw ContractFailure.expectation(message) }
        try await Task.sleep(for: .milliseconds(1))
    }
}

@main
private struct NativeFinalRenderHelperRuntimeContractTests {
    static func main() async throws {
        let request = NativeFinalRenderJobRequest(
            requestID: "render_async",
            requestSHA256: String(repeating: "a", count: 64)
        )
        let renderGate = AsyncGate()
        let runtime = NativeFinalRenderHelperRuntime(
            render: { _, token in
                while !token.isCancelled { await Task.yield() }
                await renderGate.wait()
                return .init(outputIdentity: String(repeating: "b", count: 64))
            },
            adoptCheckpoint: { nil }
        )

        let clock = ContinuousClock()
        let startedAt = clock.now
        let started = try await runtime.start(request)
        try expect(clock.now - startedAt < .milliseconds(100), "start must return before rendering completes")
        try expect(started == .rendering(request), "start exposes rendering immediately")

        let cancelling = Task { try await runtime.cancel(request) }
        try await Task.sleep(for: .milliseconds(10))
        let statusDuringCancel = await runtime.status()
        try expect(statusDuringCancel == .rendering(request), "status remains reachable while cancel drains")
        await renderGate.release()
        let cancelled = try await cancelling.value
        try expect(cancelled == .cancelled(request), "cancel waits for actual renderer drain")

        let captureRequest = NativeFinalRenderJobRequest(
            requestID: "render_before_capture",
            requestSHA256: String(repeating: "c", count: 64)
        )
        let captureGate = AsyncGate()
        let captureRuntime = NativeFinalRenderHelperRuntime(
            render: { _, token in
                while !token.isCancelled { await Task.yield() }
                await captureGate.wait()
                return .init(outputIdentity: String(repeating: "d", count: 64))
            },
            adoptCheckpoint: { nil }
        )
        _ = try await captureRuntime.start(captureRequest)
        let reserving = Task {
            try await captureRuntime.prepareCaptureStart(drainTimeout: .seconds(1))
        }
        try await Task.sleep(for: .milliseconds(10))
        await captureGate.release()
        _ = try await reserving.value
        let statusAfterCaptureReservation = await captureRuntime.status()
        try expect(
            statusAfterCaptureReservation == .cancelled(captureRequest),
            "capture reservation cancels and fully drains the active render"
        )
        do {
            _ = try await captureRuntime.start(.init(
                requestID: "render_during_capture",
                requestSHA256: String(repeating: "e", count: 64)
            ))
            throw ContractFailure.expectation("capture reservation accepted a new render")
        } catch NativeFinalRenderHelperRuntimeError.captureActive {
            // expected
        }
        await captureRuntime.captureDidStop()

        let production = NativeFinalRenderHelperRuntime.productionUnsupported()
        let unsupportedRequest = NativeFinalRenderJobRequest(
            requestID: "production_unwired",
            requestSHA256: String(repeating: "f", count: 64)
        )
        _ = try await production.start(unsupportedRequest)
        try await waitUntil("unsupported production renderer did not settle explicitly") {
            if case .failed(let settled, code: "production-renderer-unavailable") = await production.status() {
                return settled == unsupportedRequest
            }
            return false
        }
        if case .ready = await production.status() {
            throw ContractFailure.expectation("unsupported production renderer exposed fake playable media")
        }

        print("native final render helper runtime contract tests passed")
    }
}
