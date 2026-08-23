@preconcurrency import AVFoundation
import Foundation
import MacMediaEngineCore

final class VideoSegmentMuxer: @unchecked Sendable {
    private struct ActiveSegment: @unchecked Sendable {
        let index: Int
        let stagingURL: URL
        let writer: AVAssetWriter
        let input: AVAssetWriterInput
        let start: CMTime
        var lastPresentationTime: CMTime
    }

    private let store: SegmentedRecordingStore
    private let track: RecordingTrackKind
    private let segmentDuration = CMTime(value: CaptureEncodingPolicy.segmentDurationUs, timescale: 1_000_000)
    private let finishGroup = DispatchGroup()
    private var active: ActiveSegment?
    private var nextIndex = 0
    private var terminalError: Error?

    init(store: SegmentedRecordingStore, track: RecordingTrackKind) {
        self.store = store
        self.track = track
    }

    func append(_ sampleBuffer: CMSampleBuffer) throws {
        if let terminalError { throw terminalError }
        guard CMSampleBufferDataIsReady(sampleBuffer),
              let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) else { return }
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)

        if active == nil {
            active = try makeSegment(formatDescription: formatDescription, start: presentationTime)
        } else if let current = active,
                  presentationTime - current.start >= segmentDuration,
                  isKeyFrame(sampleBuffer) {
            sealActiveSegment()
            active = try makeSegment(formatDescription: formatDescription, start: presentationTime)
        }

        guard var current = active else { return }
        guard current.input.isReadyForMoreMediaData else {
            throw NativeCaptureError.videoMuxerBackpressure
        }
        guard current.input.append(sampleBuffer) else {
            throw current.writer.error ?? NativeCaptureError.videoMuxerAppendFailed
        }
        current.lastPresentationTime = presentationTime
        active = current
    }

    func finishAndWait() throws {
        sealActiveSegment()
        finishGroup.wait()
        if let terminalError { throw terminalError }
    }

    private func makeSegment(formatDescription: CMFormatDescription, start: CMTime) throws -> ActiveSegment {
        let index = nextIndex
        nextIndex += 1
        let stagingURL = try store.makeStagingSegmentURL(track: track, index: index)
        let writer = try AVAssetWriter(outputURL: stagingURL, fileType: .mp4)
        let input = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: nil,
            sourceFormatHint: formatDescription
        )
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw NativeCaptureError.videoMuxerCannotAddInput }
        writer.add(input)
        guard writer.startWriting() else {
            throw writer.error ?? NativeCaptureError.videoMuxerStartFailed
        }
        writer.startSession(atSourceTime: start)
        return ActiveSegment(
            index: index,
            stagingURL: stagingURL,
            writer: writer,
            input: input,
            start: start,
            lastPresentationTime: start
        )
    }

    private func sealActiveSegment() {
        guard let segment = active else { return }
        active = nil
        segment.input.markAsFinished()
        finishGroup.enter()
        segment.writer.finishWriting { [weak self] in
            defer { self?.finishGroup.leave() }
            guard let self else { return }
            do {
                guard segment.writer.status == .completed else {
                    throw segment.writer.error ?? NativeCaptureError.videoMuxerFinishFailed
                }
                let startUs = max(0, segment.start.convertScale(1_000_000, method: .roundTowardZero).value)
                let duration = max(1, (segment.lastPresentationTime - segment.start)
                    .convertScale(1_000_000, method: .roundAwayFromZero).value)
                try self.store.commitStagedSegment(
                    track: self.track,
                    index: segment.index,
                    stagingURL: segment.stagingURL,
                    startUs: startUs,
                    durationUs: duration,
                    fileExtension: "mp4"
                )
            } catch {
                self.terminalError = error
            }
        }
    }

    private func isKeyFrame(_ sampleBuffer: CMSampleBuffer) -> Bool {
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(
            sampleBuffer,
            createIfNecessary: false
        ) as? [[CFString: Any]], let first = attachments.first else { return true }
        return !(first[kCMSampleAttachmentKey_NotSync] as? Bool ?? false)
    }
}
