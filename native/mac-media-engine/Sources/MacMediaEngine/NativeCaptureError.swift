import Foundation
import CoreVideo
import MacMediaEngineCore

enum NativeCaptureError: Error {
    case displayNotFound(UInt32)
    case windowNotFound(UInt32)
    case frameMissingPixelBuffer
    case initialFrameCaptureFailed
    case captureSourceUnavailableOrProtected
    case initialFramePixelBufferCreateFailed(CVReturn)
    case initialFrameContextCreateFailed
    case videoEncoderCreateFailed(OSStatus)
    case videoEncoderPropertyFailed(OSStatus)
    case videoEncodeFailed(OSStatus)
    case videoEncoderOutputFailed(OSStatus)
    case videoMuxerCannotAddInput
    case videoMuxerStartFailed
    case videoMuxerBackpressure
    case videoMuxerAppendFailed
    case videoMuxerFinishFailed
    case audioMuxerCannotAddInput(RecordingTrackKind)
    case audioMuxerStartFailed(RecordingTrackKind)
    case audioMuxerBackpressure(RecordingTrackKind)
    case audioMuxerAppendFailed(RecordingTrackKind)
    case audioMuxerFinishFailed(RecordingTrackKind)
    case microphoneNotFound(String?)
    case microphonePermissionRequired
    case microphoneCannotAddInput
    case microphoneCannotAddOutput
    case microphoneStartFailed
    case cameraNotFound(String?)
    case cameraPermissionRequired
    case cameraFormatUnsupported(width: Int, height: Int, framesPerSecond: Int)
    case cameraCannotAddInput
    case cameraCannotAddOutput
    case cameraStartFailed
    case mediaTrackNotReady(RecordingTrackKind)
}
