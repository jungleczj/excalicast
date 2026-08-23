@preconcurrency import AVFoundation
import Foundation
import MacMediaEngineCore

final class AudioSegmentWriter: @unchecked Sendable {
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
    private let channelCount: Int
    private let bitRate: Int
    private let timeline: RecordingTimeline
    private let segmentDuration = CMTime(value: CaptureEncodingPolicy.segmentDurationUs, timescale: 1_000_000)
    private let finishGroup = DispatchGroup()
    private let errorLock = NSLock()
    private var active: ActiveSegment?
    private var nextIndex = 0
    private var terminalError: Error?

    init(
        store: SegmentedRecordingStore,
        track: RecordingTrackKind,
        channelCount: Int,
        bitRate: Int,
        timeline: RecordingTimeline
    ) {
        self.store = store
        self.track = track
        self.channelCount = channelCount
        self.bitRate = bitRate
        self.timeline = timeline
    }

    func append(_ sampleBuffer: CMSampleBuffer) throws {
        try throwTerminalErrorIfNeeded()
        guard CMSampleBufferDataIsReady(sampleBuffer),
              let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) else { return }
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if active == nil {
            active = try makeSegment(formatDescription: formatDescription, start: presentationTime)
        } else if let current = active, presentationTime - current.start >= segmentDuration {
            sealActiveSegment()
            active = try makeSegment(formatDescription: formatDescription, start: presentationTime)
        }
        guard var current = active else { return }
        guard current.input.isReadyForMoreMediaData else {
            throw NativeCaptureError.audioMuxerBackpressure(track)
        }
        guard current.input.append(sampleBuffer) else {
            throw current.writer.error ?? NativeCaptureError.audioMuxerAppendFailed(track)
        }
        current.lastPresentationTime = presentationTime
        active = current
    }

    func finishAndWait() throws {
        sealActiveSegment()
        finishGroup.wait()
        try throwTerminalErrorIfNeeded()
    }

    private func makeSegment(formatDescription: CMFormatDescription, start: CMTime) throws -> ActiveSegment {
        let index = nextIndex
        nextIndex += 1
        let stagingURL = try store.makeStagingSegmentURL(track: track, index: index)
        let writer = try AVAssetWriter(outputURL: stagingURL, fileType: .m4a)
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: channelCount,
            AVEncoderBitRateKey: bitRate,
        ]
        let input = AVAssetWriterInput(
            mediaType: .audio,
            outputSettings: settings,
            sourceFormatHint: formatDescription
        )
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw NativeCaptureError.audioMuxerCannotAddInput(track) }
        writer.add(input)
        guard writer.startWriting() else {
            throw writer.error ?? NativeCaptureError.audioMuxerStartFailed(track)
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
                    throw segment.writer.error ?? NativeCaptureError.audioMuxerFinishFailed(self.track)
                }
                let absoluteStartUs = segment.start.convertScale(1_000_000, method: .roundTowardZero).value
                let startUs = self.timeline.relativeUs(for: absoluteStartUs)
                let durationUs = max(1, (segment.lastPresentationTime - segment.start)
                    .convertScale(1_000_000, method: .roundAwayFromZero).value)
                try self.store.commitStagedSegment(
                    track: self.track,
                    index: segment.index,
                    stagingURL: segment.stagingURL,
                    startUs: startUs,
                    durationUs: durationUs,
                    fileExtension: "m4a"
                )
            } catch {
                self.recordTerminalError(error)
            }
        }
    }

    private func recordTerminalError(_ error: Error) {
        errorLock.lock()
        if terminalError == nil { terminalError = error }
        errorLock.unlock()
    }

    private func throwTerminalErrorIfNeeded() throws {
        errorLock.lock()
        let error = terminalError
        errorLock.unlock()
        if let error { throw error }
    }
}
