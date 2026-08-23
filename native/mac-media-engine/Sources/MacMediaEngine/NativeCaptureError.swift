import Foundation

enum NativeCaptureError: Error {
    case displayNotFound(UInt32)
    case frameMissingPixelBuffer
    case videoEncoderCreateFailed(OSStatus)
    case videoEncoderPropertyFailed(OSStatus)
    case videoEncodeFailed(OSStatus)
    case videoEncoderOutputFailed(OSStatus)
    case videoMuxerCannotAddInput
    case videoMuxerStartFailed
    case videoMuxerBackpressure
    case videoMuxerAppendFailed
    case videoMuxerFinishFailed
}
