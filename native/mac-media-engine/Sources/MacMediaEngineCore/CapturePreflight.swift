import Foundation
import VideoToolbox

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

    public static func systemHardwareEncoderAvailable(_ codec: CaptureCodec) -> Bool {
        let codecType: CMVideoCodecType = codec == .h264 ? kCMVideoCodecType_H264 : kCMVideoCodecType_HEVC
        let specification = [
            kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder as String: true,
        ] as CFDictionary
        var session: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            width: 64,
            height: 64,
            codecType: codecType,
            encoderSpecification: specification,
            imageBufferAttributes: nil,
            compressedDataAllocator: nil,
            outputCallback: nil,
            refcon: nil,
            compressionSessionOut: &session
        )
        if let session { VTCompressionSessionInvalidate(session) }
        return status == noErr && session != nil
    }
}
