@preconcurrency import CoreMedia
import Foundation
import MacMediaEngineCore

enum ControlledSampleBuffer {
    static func videoPresentationTime(
        _ sampleBuffer: CMSampleBuffer,
        controls: CaptureControlState
    ) -> CMTime? {
        let source = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            .convertScale(1_000_000, method: .roundTowardZero)
            .value
        guard let adjusted = controls.adjustedPresentationUs(source) else { return nil }
        return CMTime(value: adjusted, timescale: 1_000_000)
    }

    static func audio(
        _ sampleBuffer: CMSampleBuffer,
        controls: CaptureControlState,
        muted: Bool
    ) throws -> CMSampleBuffer? {
        let original = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            .convertScale(1_000_000, method: .roundTowardZero)
            .value
        guard let adjusted = controls.adjustedPresentationUs(original) else { return nil }
        let retimed = try copy(sampleBuffer, subtractingUs: original - adjusted)
        return muted ? try silentCopy(retimed) : retimed
    }

    private static func copy(_ sampleBuffer: CMSampleBuffer, subtractingUs offsetUs: Int64) throws -> CMSampleBuffer {
        var count = 0
        var status = CMSampleBufferGetSampleTimingInfoArray(
            sampleBuffer,
            entryCount: 0,
            arrayToFill: nil,
            entriesNeededOut: &count
        )
        guard status == noErr else { throw NativeCaptureError.audioControlTransformFailed(status) }
        var timing = Array(
            repeating: CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: .invalid, decodeTimeStamp: .invalid),
            count: count
        )
        status = timing.withUnsafeMutableBufferPointer { buffer in
            CMSampleBufferGetSampleTimingInfoArray(
                sampleBuffer,
                entryCount: count,
                arrayToFill: buffer.baseAddress,
                entriesNeededOut: &count
            )
        }
        guard status == noErr else { throw NativeCaptureError.audioControlTransformFailed(status) }
        let offset = CMTime(value: offsetUs, timescale: 1_000_000)
        for index in timing.indices {
            if timing[index].presentationTimeStamp.isValid {
                timing[index].presentationTimeStamp = timing[index].presentationTimeStamp - offset
            }
            if timing[index].decodeTimeStamp.isValid {
                timing[index].decodeTimeStamp = timing[index].decodeTimeStamp - offset
            }
        }
        var output: CMSampleBuffer?
        status = timing.withUnsafeBufferPointer { buffer in
            CMSampleBufferCreateCopyWithNewTiming(
                allocator: kCFAllocatorDefault,
                sampleBuffer: sampleBuffer,
                sampleTimingEntryCount: timing.count,
                sampleTimingArray: buffer.baseAddress,
                sampleBufferOut: &output
            )
        }
        guard status == noErr, let output else { throw NativeCaptureError.audioControlTransformFailed(status) }
        return output
    }

    private static func silentCopy(_ sampleBuffer: CMSampleBuffer) throws -> CMSampleBuffer {
        guard let format = CMSampleBufferGetFormatDescription(sampleBuffer) else {
            throw NativeCaptureError.audioControlTransformFailed(-1)
        }
        let byteLength = CMSampleBufferGetTotalSampleSize(sampleBuffer)
        guard byteLength > 0 else { throw NativeCaptureError.audioControlTransformFailed(-1) }
        var block: CMBlockBuffer?
        var status = CMBlockBufferCreateWithMemoryBlock(
            allocator: kCFAllocatorDefault,
            memoryBlock: nil,
            blockLength: byteLength,
            blockAllocator: kCFAllocatorDefault,
            customBlockSource: nil,
            offsetToData: 0,
            dataLength: byteLength,
            flags: kCMBlockBufferAssureMemoryNowFlag,
            blockBufferOut: &block
        )
        guard status == kCMBlockBufferNoErr, let block else {
            throw NativeCaptureError.audioControlTransformFailed(status)
        }
        status = CMBlockBufferFillDataBytes(
            with: 0,
            blockBuffer: block,
            offsetIntoDestination: 0,
            dataLength: byteLength
        )
        guard status == kCMBlockBufferNoErr else { throw NativeCaptureError.audioControlTransformFailed(status) }

        var timingCount = 0
        status = CMSampleBufferGetSampleTimingInfoArray(
            sampleBuffer,
            entryCount: 0,
            arrayToFill: nil,
            entriesNeededOut: &timingCount
        )
        guard status == noErr else { throw NativeCaptureError.audioControlTransformFailed(status) }
        var timing = Array(
            repeating: CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: .invalid, decodeTimeStamp: .invalid),
            count: timingCount
        )
        status = timing.withUnsafeMutableBufferPointer { buffer in
            CMSampleBufferGetSampleTimingInfoArray(
                sampleBuffer,
                entryCount: timingCount,
                arrayToFill: buffer.baseAddress,
                entriesNeededOut: &timingCount
            )
        }
        guard status == noErr else { throw NativeCaptureError.audioControlTransformFailed(status) }

        let sampleCount = CMSampleBufferGetNumSamples(sampleBuffer)
        var sizeCount = 0
        status = CMSampleBufferGetSampleSizeArray(
            sampleBuffer,
            entryCount: 0,
            arrayToFill: nil,
            entriesNeededOut: &sizeCount
        )
        guard status == noErr else { throw NativeCaptureError.audioControlTransformFailed(status) }
        var sizes = Array(repeating: 0, count: sizeCount)
        status = sizes.withUnsafeMutableBufferPointer { buffer in
            CMSampleBufferGetSampleSizeArray(
                sampleBuffer,
                entryCount: sizeCount,
                arrayToFill: buffer.baseAddress,
                entriesNeededOut: &sizeCount
            )
        }
        guard status == noErr else { throw NativeCaptureError.audioControlTransformFailed(status) }

        var output: CMSampleBuffer?
        status = timing.withUnsafeBufferPointer { timingBuffer in
            sizes.withUnsafeBufferPointer { sizeBuffer in
                CMSampleBufferCreateReady(
                    allocator: kCFAllocatorDefault,
                    dataBuffer: block,
                    formatDescription: format,
                    sampleCount: sampleCount,
                    sampleTimingEntryCount: timing.count,
                    sampleTimingArray: timingBuffer.baseAddress,
                    sampleSizeEntryCount: sizes.count,
                    sampleSizeArray: sizeBuffer.baseAddress,
                    sampleBufferOut: &output
                )
            }
        }
        guard status == noErr, let output else { throw NativeCaptureError.audioControlTransformFailed(status) }
        return output
    }
}
