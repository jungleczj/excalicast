import Foundation
#if canImport(MacMediaEngineFinalRenderJobController)
import MacMediaEngineFinalRenderJobController
#endif

private enum ContractFailure: Error {
    case expectation(String)
}

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw ContractFailure.expectation(message) }
}

private actor AsyncGate {
    private var isOpen = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        guard !isOpen else { return }
        await withCheckedContinuation { continuation in
            waiters.append(continuation)
        }
    }

    func open() {
        isOpen = true
        let pending = waiters
        waiters.removeAll()
        pending.forEach { $0.resume() }
    }
}

private actor Observation {
    private var observed = false

    func markObserved() {
        observed = true
    }

    func value() -> Bool {
        observed
    }
}

private actor Counter {
    private var count = 0

    func increment() {
        count += 1
    }

    func value() -> Int {
        count
    }
}

private enum SyntheticRenderError: Error {
    case encodingFailed
}

private func waitUntil(
    _ message: String,
    attempts: Int = 2_000,
    condition: @escaping @Sendable () async -> Bool
) async throws {
    for _ in 0..<attempts {
        if await condition() { return }
        try await Task.sleep(for: .milliseconds(1))
    }
    throw ContractFailure.expectation(message)
}

@main
struct NativeFinalRenderJobControllerContractTests {
    static func main() async throws {
        let gate = AsyncGate()
        let renderCount = Counter()
        let request = NativeFinalRenderJobRequest(
            requestID: "render-001",
            requestSHA256: String(repeating: "a", count: 64)
        )
        let controller = NativeFinalRenderJobController(
            render: { _, _ in
                await renderCount.increment()
                await gate.wait()
                return .init(outputIdentity: String(repeating: "b", count: 64))
            },
            adoptCheckpoint: { nil }
        )

        let started = try await controller.start(request)
        try expect(started == .rendering(request), "start returns while injected rendering remains blocked")
        let renderingStatus = await controller.status()
        try expect(renderingStatus == .rendering(request), "encoding exposes a rendering status")
        let duplicateStart = try await controller.start(request)
        try expect(duplicateStart == .rendering(request), "same active request is idempotent")
        try await waitUntil("the renderer did not begin") { await renderCount.value() == 1 }
        let activeRenderCount = await renderCount.value()
        try expect(activeRenderCount == 1, "same request has exactly one background renderer")
        let otherRequest = NativeFinalRenderJobRequest(
            requestID: "render-other",
            requestSHA256: String(repeating: "9", count: 64)
        )
        do {
            _ = try await controller.start(otherRequest)
            throw ContractFailure.expectation("different active request unexpectedly started")
        } catch let error as NativeFinalRenderJobControllerError {
            try expect(
                error == .busy(activeRequestID: "render-001"),
                "different request reports the active singleflight owner"
            )
        }

        await gate.open()
        let ready = try await controller.waitUntilTerminal(for: request)
        try expect(
            ready == .ready(request, .init(outputIdentity: String(repeating: "b", count: 64))),
            "completed rendering publishes a stable ready status"
        )
        let revisedRequest = NativeFinalRenderJobRequest(
            requestID: request.requestID,
            requestSHA256: String(repeating: "0", count: 64)
        )
        _ = try await controller.start(revisedRequest)
        let revisedReady = try await controller.waitUntilTerminal(for: revisedRequest)
        try expect(
            revisedReady == .ready(
                revisedRequest,
                .init(outputIdentity: String(repeating: "b", count: 64))
            ),
            "same ID with a new digest starts after the old terminal task drains"
        )
        let revisedRenderCount = await renderCount.value()
        try expect(revisedRenderCount == 2, "new immutable digest replaces old terminal state exactly once")

        var busyAfterTerminalCount = 0
        for iteration in 0..<2_000 {
            let terminalRequest = NativeFinalRenderJobRequest(
                requestID: "terminal-race-\(iteration)",
                requestSHA256: String(repeating: "a", count: 64)
            )
            let nextRevision = NativeFinalRenderJobRequest(
                requestID: terminalRequest.requestID,
                requestSHA256: String(repeating: "b", count: 64)
            )
            let terminalController = NativeFinalRenderJobController(
                render: { _, _ in
                    .init(outputIdentity: String(repeating: "c", count: 64))
                },
                adoptCheckpoint: { nil }
            )
            _ = try await terminalController.start(terminalRequest)
            try await waitUntil("terminal status was not published") {
                switch await terminalController.status() {
                case .ready, .failed, .cancelled:
                    true
                case .idle, .rendering:
                    false
                }
            }
            do {
                _ = try await terminalController.start(nextRevision)
            } catch NativeFinalRenderJobControllerError.busy {
                busyAfterTerminalCount += 1
            }
        }
        try expect(
            busyAfterTerminalCount == 0,
            "a terminal status releases its generation atomically; busy=\(busyAfterTerminalCount)"
        )

        var staleWaitResultCount = 0
        for iteration in 0..<500 {
            let oldGate = AsyncGate()
            let newGate = AsyncGate()
            let oldRequest = NativeFinalRenderJobRequest(
                requestID: "wait-race-\(iteration)",
                requestSHA256: String(repeating: "d", count: 64)
            )
            let newRequest = NativeFinalRenderJobRequest(
                requestID: oldRequest.requestID,
                requestSHA256: String(repeating: "e", count: 64)
            )
            let raceController = NativeFinalRenderJobController(
                render: { request, _ in
                    if request == oldRequest { await oldGate.wait() }
                    else { await newGate.wait() }
                    return .init(outputIdentity: String(repeating: "f", count: 64))
                },
                adoptCheckpoint: { nil }
            )
            _ = try await raceController.start(oldRequest)
            let revisionStarter = Task.detached(priority: .high) {
                try await Task.sleep(for: .milliseconds(1))
                await oldGate.open()
                try await waitUntil("old terminal status was not published") {
                    switch await raceController.status() {
                    case .ready(let request, _), .failed(let request, _), .cancelled(let request):
                        request == oldRequest
                    case .idle, .rendering:
                        false
                    }
                }
                return try await raceController.start(newRequest)
            }
            let waited = try await raceController.waitUntilTerminal(for: oldRequest)
            _ = try await revisionStarter.value
            if waited != .ready(oldRequest, .init(outputIdentity: String(repeating: "f", count: 64))) {
                staleWaitResultCount += 1
            }
            await newGate.open()
            _ = try await raceController.waitUntilTerminal(for: newRequest)
        }
        try expect(
            staleWaitResultCount == 0,
            "an old waiter returns only its request-bound terminal snapshot; stale=\(staleWaitResultCount)"
        )

        let drainGate = AsyncGate()
        let cancellationObserved = Observation()
        let cancelRequest = NativeFinalRenderJobRequest(
            requestID: "render-cancel",
            requestSHA256: String(repeating: "c", count: 64)
        )
        let cancelController = NativeFinalRenderJobController(
            render: { _, token in
                while !token.isCancelled {
                    await Task.yield()
                }
                await cancellationObserved.markObserved()
                await drainGate.wait()
                return .init(outputIdentity: String(repeating: "d", count: 64))
            },
            adoptCheckpoint: { nil }
        )
        _ = try await cancelController.start(cancelRequest)
        let cancellation = Task {
            try await cancelController.cancel(cancelRequest)
        }
        try await waitUntil("cancel token was not delivered to the active render") {
            await cancellationObserved.value()
        }
        let drainingStatus = await cancelController.status()
        try expect(
            drainingStatus == .rendering(cancelRequest),
            "cancel keeps the job rendering until its task really drains"
        )
        await drainGate.open()
        let cancelled = try await cancellation.value
        try expect(cancelled == .cancelled(cancelRequest), "cancel returns only after actual task drain")
        let stableCancelled = await cancelController.status()
        try expect(stableCancelled == .cancelled(cancelRequest), "cancelled remains a stable terminal status")

        let stuckGate = AsyncGate()
        let stuckCancellationObserved = Observation()
        let stuckRequest = NativeFinalRenderJobRequest(
            requestID: "render-stuck",
            requestSHA256: String(repeating: "e", count: 64)
        )
        let replacementRequest = NativeFinalRenderJobRequest(
            requestID: "render-replacement",
            requestSHA256: String(repeating: "f", count: 64)
        )
        let stuckController = NativeFinalRenderJobController(
            render: { _, token in
                while !token.isCancelled {
                    await Task.yield()
                }
                await stuckCancellationObserved.markObserved()
                await stuckGate.wait()
                return .init(outputIdentity: String(repeating: "1", count: 64))
            },
            adoptCheckpoint: { nil }
        )
        _ = try await stuckController.start(stuckRequest)
        do {
            _ = try await stuckController.captureWillStart(drainTimeout: .milliseconds(20))
            throw ContractFailure.expectation("capture start unexpectedly released a running render")
        } catch let error as NativeFinalRenderJobControllerError {
            try expect(
                error == .drainTimedOut(requestID: "render-stuck"),
                "capture drain timeout identifies the still-running request"
            )
        }
        try await waitUntil("capture start did not cancel the old render first") {
            await stuckCancellationObserved.value()
        }
        let stillRendering = await stuckController.status()
        try expect(
            stillRendering == .rendering(stuckRequest),
            "timeout does not release a render task that has not drained"
        )
        do {
            _ = try await stuckController.start(replacementRequest)
            throw ContractFailure.expectation("replacement render bypassed the active job")
        } catch let error as NativeFinalRenderJobControllerError {
            try expect(
                error == .busy(activeRequestID: "render-stuck"),
                "different request stays busy after a drain timeout"
            )
        }
        await stuckGate.open()
        let drained = try await stuckController.waitUntilTerminal(for: stuckRequest)
        try expect(drained == .cancelled(stuckRequest), "timed-out cancellation settles only after later drain")

        let cooperativeRequest = NativeFinalRenderJobRequest(
            requestID: "render-cooperative-capture",
            requestSHA256: String(repeating: "a", count: 64)
        )
        let cooperativeController = NativeFinalRenderJobController(
            render: { _, token in
                while !token.isCancelled {
                    await Task.yield()
                }
                return .init(outputIdentity: String(repeating: "b", count: 64))
            },
            adoptCheckpoint: { nil }
        )
        _ = try await cooperativeController.start(cooperativeRequest)
        let captureSafe = try await cooperativeController.captureWillStart(drainTimeout: .seconds(1))
        try expect(
            captureSafe == .cancelled(cooperativeRequest),
            "capture start succeeds only after cooperative renderer drain"
        )

        let failedRequest = NativeFinalRenderJobRequest(
            requestID: "render-failed",
            requestSHA256: String(repeating: "2", count: 64)
        )
        let failedController = NativeFinalRenderJobController(
            render: { _, _ in throw SyntheticRenderError.encodingFailed },
            adoptCheckpoint: { nil }
        )
        _ = try await failedController.start(failedRequest)
        let failed = try await failedController.waitUntilTerminal(for: failedRequest)
        try expect(
            failed == .failed(failedRequest, code: "render-failed"),
            "renderer errors publish a stable non-ready failure"
        )
        let failedReplay = try await failedController.start(failedRequest)
        try expect(failedReplay == failed, "failed request replay remains terminal and idempotent")

        let mappedFailureController = NativeFinalRenderJobController(
            render: { _, _ in throw SyntheticRenderError.encodingFailed },
            adoptCheckpoint: { nil },
            mapRenderError: { _ in "encoder-disk-full" }
        )
        let mappedRequest = NativeFinalRenderJobRequest(
            requestID: "render-mapped-failure",
            requestSHA256: String(repeating: "5", count: 64)
        )
        _ = try await mappedFailureController.start(mappedRequest)
        let mappedFailure = try await mappedFailureController.waitUntilTerminal(for: mappedRequest)
        try expect(
            mappedFailure == .failed(mappedRequest, code: "encoder-disk-full"),
            "injected error mapping preserves a stable diagnostic code"
        )

        let invalidRequest = NativeFinalRenderJobRequest(
            requestID: "../escaped",
            requestSHA256: String(repeating: "A", count: 64)
        )
        do {
            _ = try await failedController.start(invalidRequest)
            throw ContractFailure.expectation("unsafe request identity unexpectedly started")
        } catch let error as NativeFinalRenderJobControllerError {
            try expect(error == .invalidRequestIdentity, "request identity and digest fail closed")
        }

        let invalidOutputRequest = NativeFinalRenderJobRequest(
            requestID: "render-invalid-output",
            requestSHA256: String(repeating: "6", count: 64)
        )
        let invalidOutputController = NativeFinalRenderJobController(
            render: { _, _ in .init(outputIdentity: "not-a-canonical-sha") },
            adoptCheckpoint: { nil }
        )
        _ = try await invalidOutputController.start(invalidOutputRequest)
        let invalidOutput = try await invalidOutputController.waitUntilTerminal(for: invalidOutputRequest)
        try expect(
            invalidOutput == .failed(invalidOutputRequest, code: "invalid-output-identity"),
            "renderer cannot publish ready with a non-canonical output identity"
        )

        let adoptedRequest = NativeFinalRenderJobRequest(
            requestID: "render-adopted",
            requestSHA256: String(repeating: "3", count: 64)
        )
        let adoptedResult = NativeFinalRenderJobResult(
            outputIdentity: String(repeating: "4", count: 64)
        )
        let restartedRenderCount = Counter()
        let restartedController = NativeFinalRenderJobController(
            render: { _, _ in
                await restartedRenderCount.increment()
                return adoptedResult
            },
            adoptCheckpoint: {
                .init(request: adoptedRequest, result: adoptedResult)
            }
        )
        let adopted = try await restartedController.restoreFromCheckpoint()
        try expect(
            adopted == .ready(adoptedRequest, adoptedResult),
            "restarted controller adopts a verified checkpoint as ready"
        )
        let adoptedReplay = try await restartedController.start(adoptedRequest)
        try expect(adoptedReplay == adopted, "adopted ready request remains idempotent")
        let adoptedRenderCount = await restartedRenderCount.value()
        try expect(adoptedRenderCount == 0, "adopted ready output is never rendered twice")

        let cancelledReplay = try await cancelController.start(cancelRequest)
        try expect(cancelledReplay == .cancelled(cancelRequest), "cancelled request replay remains terminal")

        let rejectedAdopter = NativeFinalRenderJobController(
            render: { _, _ in adoptedResult },
            adoptCheckpoint: {
                .init(
                    request: adoptedRequest,
                    result: .init(outputIdentity: "unverified-output")
                )
            }
        )
        do {
            _ = try await rejectedAdopter.restoreFromCheckpoint()
            throw ContractFailure.expectation("unverified checkpoint unexpectedly became ready")
        } catch let error as NativeFinalRenderJobControllerError {
            try expect(error == .checkpointAdoptionRejected, "checkpoint adoption validates ready identity")
        }
        let rejectedStatus = await rejectedAdopter.status()
        try expect(rejectedStatus == .idle, "rejected checkpoint never mutates controller state")

        let lifecycleCancellationObserved = Observation()
        let lifecycleRequest = NativeFinalRenderJobRequest(
            requestID: "render-lifecycle",
            requestSHA256: String(repeating: "7", count: 64)
        )
        var lifecycleController: NativeFinalRenderJobController? = NativeFinalRenderJobController(
            render: { _, token in
                while !token.isCancelled {
                    await Task.yield()
                }
                await lifecycleCancellationObserved.markObserved()
                return .init(outputIdentity: String(repeating: "8", count: 64))
            },
            adoptCheckpoint: { nil }
        )
        _ = try await lifecycleController?.start(lifecycleRequest)
        lifecycleController = nil
        try await waitUntil("controller deinit left an orphan render running") {
            await lifecycleCancellationObserved.value()
        }
    }
}
