import Foundation

public struct NativeFinalRenderJobRequest: Codable, Equatable, Hashable, Sendable {
    public let requestID: String
    public let requestSHA256: String

    public init(requestID: String, requestSHA256: String) {
        self.requestID = requestID
        self.requestSHA256 = requestSHA256
    }
}

public struct NativeFinalRenderJobResult: Codable, Equatable, Sendable {
    public let outputIdentity: String

    public init(outputIdentity: String) {
        self.outputIdentity = outputIdentity
    }
}

public struct NativeFinalRenderCheckpointAdoption: Codable, Equatable, Sendable {
    public let request: NativeFinalRenderJobRequest
    public let result: NativeFinalRenderJobResult

    public init(request: NativeFinalRenderJobRequest, result: NativeFinalRenderJobResult) {
        self.request = request
        self.result = result
    }
}

public enum NativeFinalRenderJobStatus: Equatable, Sendable {
    case idle
    case rendering(NativeFinalRenderJobRequest)
    case ready(NativeFinalRenderJobRequest, NativeFinalRenderJobResult)
    case failed(NativeFinalRenderJobRequest, code: String)
    case cancelled(NativeFinalRenderJobRequest)
}

public final class NativeFinalRenderCancellationToken: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false

    public init() {}

    public var isCancelled: Bool {
        lock.withLock { cancelled }
    }

    fileprivate func cancel() {
        lock.withLock { cancelled = true }
    }
}

public enum NativeFinalRenderJobControllerError: Error, Equatable, Sendable {
    case busy(activeRequestID: String)
    case drainTimedOut(requestID: String)
    case invalidRequestIdentity
    case checkpointAdoptionRejected
}

private enum NativeFinalRenderCompletion: Sendable {
    case success(NativeFinalRenderJobResult)
    case failure(code: String)
}

public actor NativeFinalRenderJobController {
    public typealias Render = @Sendable (
        NativeFinalRenderJobRequest,
        NativeFinalRenderCancellationToken
    ) async throws -> NativeFinalRenderJobResult
    public typealias AdoptCheckpoint = @Sendable () async throws -> NativeFinalRenderCheckpointAdoption?
    public typealias MapRenderError = @Sendable (any Error) -> String

    private let render: Render
    private let adoptCheckpoint: AdoptCheckpoint
    private let mapRenderError: MapRenderError
    private var currentStatus: NativeFinalRenderJobStatus = .idle
    private var task: Task<NativeFinalRenderCompletion, Never>?
    private var token: NativeFinalRenderCancellationToken?
    private var activeGeneration: UInt64 = 0
    private var captureDrainRequestID: String?

    public init(
        render: @escaping Render,
        adoptCheckpoint: @escaping AdoptCheckpoint,
        mapRenderError: @escaping MapRenderError = { _ in "render-failed" }
    ) {
        self.render = render
        self.adoptCheckpoint = adoptCheckpoint
        self.mapRenderError = mapRenderError
    }

    deinit {
        token?.cancel()
        task?.cancel()
    }

    @discardableResult
    public func start(_ request: NativeFinalRenderJobRequest) throws -> NativeFinalRenderJobStatus {
        guard Self.valid(request) else {
            throw NativeFinalRenderJobControllerError.invalidRequestIdentity
        }
        if let captureDrainRequestID {
            throw NativeFinalRenderJobControllerError.busy(activeRequestID: captureDrainRequestID)
        }
        if case .rendering(let activeRequest) = currentStatus {
            guard activeRequest == request else {
                throw NativeFinalRenderJobControllerError.busy(activeRequestID: activeRequest.requestID)
            }
            return currentStatus
        }
        if task != nil {
            if currentStatus.belongs(to: request) {
                return currentStatus
            }
            throw NativeFinalRenderJobControllerError.busy(
                activeRequestID: currentStatus.requestID ?? ""
            )
        }
        if currentStatus.belongs(to: request) {
            return currentStatus
        }

        activeGeneration &+= 1
        let generation = activeGeneration
        let cancellationToken = NativeFinalRenderCancellationToken()
        token = cancellationToken
        currentStatus = .rendering(request)
        let renderTask = Task { [render, mapRenderError] in
            do {
                let result = try await render(request, cancellationToken)
                return NativeFinalRenderCompletion.success(result)
            } catch {
                let candidateCode = mapRenderError(error)
                let mappedCode = Self.validFailureCode(candidateCode)
                    ? candidateCode
                    : "render-failed"
                return NativeFinalRenderCompletion.failure(code: mappedCode)
            }
        }
        task = renderTask
        Task { [weak self] in
            let result = await renderTask.value
            await self?.renderTaskCompleted(
                request: request,
                generation: generation,
                result: result
            )
        }
        return currentStatus
    }

    public func status() -> NativeFinalRenderJobStatus {
        currentStatus
    }

    public func waitUntilTerminal(
        for request: NativeFinalRenderJobRequest
    ) async throws -> NativeFinalRenderJobStatus {
        guard currentStatus.belongs(to: request) else {
            throw NativeFinalRenderJobControllerError.busy(activeRequestID: currentStatus.requestID ?? "")
        }
        if let task {
            let generation = activeGeneration
            let cancellationToken = token
            let result = await task.value
            renderTaskCompleted(request: request, generation: generation, result: result)
            return Self.terminalStatus(
                request: request,
                result: result,
                cancelled: cancellationToken?.isCancelled == true
            )
        }
        return currentStatus
    }

    @discardableResult
    public func cancel(
        _ request: NativeFinalRenderJobRequest
    ) async throws -> NativeFinalRenderJobStatus {
        guard currentStatus.belongs(to: request) else {
            throw NativeFinalRenderJobControllerError.busy(activeRequestID: currentStatus.requestID ?? "")
        }
        guard case .rendering = currentStatus else {
            return currentStatus
        }
        let cancellationToken = token
        cancellationToken?.cancel()
        if let task {
            let generation = activeGeneration
            let result = await task.value
            renderTaskCompleted(request: request, generation: generation, result: result)
            return Self.terminalStatus(request: request, result: result, cancelled: true)
        }
        return currentStatus
    }

    @discardableResult
    public func captureWillStart(
        drainTimeout: Duration
    ) async throws -> NativeFinalRenderJobStatus {
        guard case .rendering(let request) = currentStatus else {
            return currentStatus
        }
        captureDrainRequestID = request.requestID
        defer { captureDrainRequestID = nil }
        token?.cancel()
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: drainTimeout)
        while task != nil {
            guard clock.now < deadline else {
                throw NativeFinalRenderJobControllerError.drainTimedOut(requestID: request.requestID)
            }
            try await Task.sleep(for: .milliseconds(1))
        }
        return currentStatus
    }

    @discardableResult
    public func restoreFromCheckpoint() async throws -> NativeFinalRenderJobStatus {
        guard currentStatus == .idle else { return currentStatus }
        let adoption = try await adoptCheckpoint()
        guard currentStatus == .idle else { return currentStatus }
        if let adoption {
            guard Self.valid(adoption.request), Self.isCanonicalSHA256(adoption.result.outputIdentity) else {
                throw NativeFinalRenderJobControllerError.checkpointAdoptionRejected
            }
            currentStatus = .ready(adoption.request, adoption.result)
        }
        return currentStatus
    }

    private func renderTaskCompleted(
        request: NativeFinalRenderJobRequest,
        generation: UInt64,
        result: NativeFinalRenderCompletion
    ) {
        guard activeGeneration == generation,
              currentStatus == .rendering(request) else { return }
        currentStatus = Self.terminalStatus(
            request: request,
            result: result,
            cancelled: token?.isCancelled == true
        )
        task = nil
        token = nil
    }

    private static func terminalStatus(
        request: NativeFinalRenderJobRequest,
        result: NativeFinalRenderCompletion,
        cancelled: Bool
    ) -> NativeFinalRenderJobStatus {
        if cancelled { return .cancelled(request) }
        switch result {
        case .success(let output):
            return isCanonicalSHA256(output.outputIdentity)
                ? .ready(request, output)
                : .failed(request, code: "invalid-output-identity")
        case .failure(let code):
            return .failed(request, code: code)
        }
    }

    private static func valid(_ request: NativeFinalRenderJobRequest) -> Bool {
        !request.requestID.isEmpty
            && request.requestID.utf8.count <= 128
            && request.requestID.unicodeScalars.allSatisfy {
                CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_"
            }
            && isCanonicalSHA256(request.requestSHA256)
    }

    private static func isCanonicalSHA256(_ value: String) -> Bool {
        value.utf8.count == 64 && value.unicodeScalars.allSatisfy {
            ($0.value >= 48 && $0.value <= 57) || ($0.value >= 97 && $0.value <= 102)
        }
    }

    private static func validFailureCode(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 128 && value.unicodeScalars.allSatisfy {
            ($0.value >= 97 && $0.value <= 122)
                || ($0.value >= 48 && $0.value <= 57)
                || $0 == "-" || $0 == "_" || $0 == "."
        }
    }
}

private extension NativeFinalRenderJobStatus {
    var requestID: String? {
        switch self {
        case .idle:
            nil
        case .rendering(let request),
             .ready(let request, _),
             .failed(let request, _),
             .cancelled(let request):
            request.requestID
        }
    }

    func belongs(to request: NativeFinalRenderJobRequest) -> Bool {
        switch self {
        case .idle:
            false
        case .rendering(let current),
             .ready(let current, _),
             .failed(let current, _),
             .cancelled(let current):
            current == request
        }
    }
}
