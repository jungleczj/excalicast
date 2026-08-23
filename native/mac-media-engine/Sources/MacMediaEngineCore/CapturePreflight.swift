import Foundation
import VideoToolbox

private let capturePreflightOutputCallback: VTCompressionOutputCallback = { _, _, _, _, _ in }

public enum CaptureCodec: String, Codable, Equatable, Sendable {
    case h264
    case hevc
}

public struct CaptureRequest: Codable, Equatable, Sendable {
    public let width: Int
    public let height: Int
    public let framesPerSecond: Int
    public let codec: CaptureCodec

    public init(width: Int, height: Int, framesPerSecond: Int, codec: CaptureCodec) {
        self.width = width
        self.height = height
        self.framesPerSecond = framesPerSecond
        self.codec = codec
    }
}

public struct CapturePreflightReport: Codable, Equatable, Sendable {
    public let requested: CaptureRequest
    public let effective: CaptureRequest
    public let hardwareEncodingConfirmed: Bool
    public let availableBytes: Int64
}

public enum CapturePreflightError: Error, Equatable, Sendable {
    case invalidDimensions
    case invalidFrameRate(Int)
    case hardwareEncoderUnavailable(CaptureCodec)
    case hardwareEncoderProbeFailed(CaptureCodec, status: OSStatus)
    case insufficientDiskSpace(availableBytes: Int64)
}

public enum CapturePreflight {
    public static let minimumAvailableBytes: Int64 = 10 * 1_024 * 1_024 * 1_024

    public static func evaluate(
        requested: CaptureRequest,
        hardwareProbe: (CaptureCodec) -> Bool = systemHardwareEncoderAvailable,
        availableBytes: Int64
    ) throws -> CapturePreflightReport {
        guard requested.width > 0, requested.height > 0,
              requested.width.isMultiple(of: 2), requested.height.isMultiple(of: 2) else {
            throw CapturePreflightError.invalidDimensions
        }
        guard (1...60).contains(requested.framesPerSecond) else {
            throw CapturePreflightError.invalidFrameRate(requested.framesPerSecond)
        }
        guard hardwareProbe(requested.codec) else {
            throw CapturePreflightError.hardwareEncoderUnavailable(requested.codec)
        }
        guard availableBytes >= minimumAvailableBytes else {
            throw CapturePreflightError.insufficientDiskSpace(availableBytes: availableBytes)
        }
        return CapturePreflightReport(
            requested: requested,
            effective: requested,
            hardwareEncodingConfirmed: true,
            availableBytes: availableBytes
        )
    }

    public static func evaluateSystem(
        requested: CaptureRequest,
        availableBytes: Int64
    ) throws -> CapturePreflightReport {
        let status = systemHardwareEncoderStatus(requested.codec)
        guard status == noErr else {
            throw CapturePreflightError.hardwareEncoderProbeFailed(requested.codec, status: status)
        }
        return try evaluate(
            requested: requested,
            hardwareProbe: { _ in true },
            availableBytes: availableBytes
        )
    }

    public static func systemHardwareEncoderAvailable(_ codec: CaptureCodec) -> Bool {
        systemHardwareEncoderStatus(codec) == noErr
    }

    public static func systemHardwareEncoderStatus(_ codec: CaptureCodec) -> OSStatus {
        let codecType: CMVideoCodecType = codec == .h264 ? kCMVideoCodecType_H264 : kCMVideoCodecType_HEVC
        let specification = [
            kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder as String: true,
        ] as CFDictionary
        var session: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            width: 1_920,
            height: 1_080,
            codecType: codecType,
            encoderSpecification: specification,
            imageBufferAttributes: nil,
            compressedDataAllocator: nil,
            outputCallback: capturePreflightOutputCallback,
            refcon: nil,
            compressionSessionOut: &session
        )
        guard status == noErr, let session else {
            return status == noErr ? kVTVideoEncoderNotAvailableNowErr : status
        }
        VTCompressionSessionInvalidate(session)
        return noErr
    }
}

public enum CaptureEncodingPolicy {
    public static let frameQueueCapacity = 2
    public static let screenCaptureQueueDepth = 3
    public static let segmentDurationUs: Int64 = 2_000_000

    public static func targetBitRate(for request: CaptureRequest) -> Int {
        let pixelsPerSecond = Double(request.width * request.height * request.framesPerSecond)
        let qualityBitsPerPixel = request.framesPerSecond > 30 ? 0.12 : 0.14
        let calculated = Int((pixelsPerSecond * qualityBitsPerPixel).rounded())
        return min(90_000_000, max(12_000_000, calculated))
    }
}
