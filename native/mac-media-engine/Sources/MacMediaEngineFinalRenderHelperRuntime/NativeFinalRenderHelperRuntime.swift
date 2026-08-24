import Foundation
import MacMediaEngineFinalRenderJobController

public enum NativeFinalRenderHelperRuntimeError: Error, Equatable, Sendable {
    case captureActive
    case productionRendererUnavailable
}

public enum NativeFinalRenderHelperState: String, Codable, Sendable {
    case idle
    case rendering
    case ready
    case failed
    case cancelled
}

public struct NativeFinalRenderHelperStatus: Codable, Equatable, Sendable {
    public let state: NativeFinalRenderHelperState
    public let requestID: String?
    public let requestSHA256: String?
    public let outputIdentity: String?
    public let errorCode: String?

    public init(_ status: NativeFinalRenderJobStatus) {
        switch status {
        case .idle:
            state = .idle
            requestID = nil
            requestSHA256 = nil
            outputIdentity = nil
            errorCode = nil
        case .rendering(let request):
            state = .rendering
            requestID = request.requestID
            requestSHA256 = request.requestSHA256
            outputIdentity = nil
            errorCode = nil
        case .ready(let request, let result):
            state = .ready
            requestID = request.requestID
            requestSHA256 = request.requestSHA256
            outputIdentity = result.outputIdentity
            errorCode = nil
        case .failed(let request, let code):
            state = .failed
            requestID = request.requestID
            requestSHA256 = request.requestSHA256
            outputIdentity = nil
            errorCode = code
        case .cancelled(let request):
            state = .cancelled
            requestID = request.requestID
            requestSHA256 = request.requestSHA256
            outputIdentity = nil
            errorCode = nil
        }
    }
}

public actor NativeFinalRenderHelperRuntime {
    private let controller: NativeFinalRenderJobController
    private var captureReserved = false

    public init(
        render: @escaping NativeFinalRenderJobController.Render,
        adoptCheckpoint: @escaping NativeFinalRenderJobController.AdoptCheckpoint,
        mapRenderError: @escaping NativeFinalRenderJobController.MapRenderError = { _ in
            "render-failed"
        }
    ) {
        controller = NativeFinalRenderJobController(
            render: render,
            adoptCheckpoint: adoptCheckpoint,
            mapRenderError: mapRenderError
        )
    }

    public static func productionUnsupported() -> NativeFinalRenderHelperRuntime {
        NativeFinalRenderHelperRuntime(
            render: { _, _ in
                throw NativeFinalRenderHelperRuntimeError.productionRendererUnavailable
            },
            adoptCheckpoint: { nil },
            mapRenderError: { error in
                error as? NativeFinalRenderHelperRuntimeError == .productionRendererUnavailable
                    ? "production-renderer-unavailable"
                    : "render-failed"
            }
        )
    }

    @discardableResult
    public func start(
        _ request: NativeFinalRenderJobRequest
    ) async throws -> NativeFinalRenderJobStatus {
        guard !captureReserved else { throw NativeFinalRenderHelperRuntimeError.captureActive }
        return try await controller.start(request)
    }

    public func status() async -> NativeFinalRenderJobStatus {
        await controller.status()
    }

    @discardableResult
    public func cancel(
        _ request: NativeFinalRenderJobRequest
    ) async throws -> NativeFinalRenderJobStatus {
        try await controller.cancel(request)
    }

    @discardableResult
    public func prepareCaptureStart(
        drainTimeout: Duration
    ) async throws -> NativeFinalRenderJobStatus {
        guard !captureReserved else { throw NativeFinalRenderHelperRuntimeError.captureActive }
        captureReserved = true
        do {
            return try await controller.captureWillStart(drainTimeout: drainTimeout)
        } catch {
            captureReserved = false
            throw error
        }
    }

    public func captureDidStop() {
        captureReserved = false
    }
}
