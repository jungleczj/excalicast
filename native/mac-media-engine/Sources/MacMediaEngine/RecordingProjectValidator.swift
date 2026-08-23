@preconcurrency import AVFoundation
@preconcurrency import CoreMedia
import Foundation
import MacMediaEngineCore

@available(macOS 13.0, *)
enum RecordingProjectValidator {
    static func validate(root: URL) async throws -> RecordingProjectValidationReport {
        let manifest = try SegmentedRecordingStore.recover(root: root)
        let continuity = RecordingContinuityValidator.validate(manifest)
        var validations: [RecordingSegmentValidation] = []
        for track in [
            RecordingTrackKind.screen,
            .camera,
            .microphone,
            .systemAudio,
        ] {
            for segment in manifest.tracks[track, default: []] {
                validations.append(await validateSegment(
                    root: root,
                    manifest: manifest,
                    track: track,
                    segment: segment
                ))
            }
        }
        return RecordingProjectValidationReport(
            isValid: continuity.isValid && validations.allSatisfy(\.isDecodable),
            manifestState: manifest.state,
            continuity: continuity,
            segments: validations
        )
    }

    private static func validateSegment(
        root: URL,
        manifest: RecoverableRecordingManifest,
        track: RecordingTrackKind,
        segment: FinalizedSegment
    ) async -> RecordingSegmentValidation {
        let expectedCodec = expectedCodec(for: track, manifest: manifest)
        let url = root.appendingPathComponent(segment.relativePath).standardizedFileURL
        do {
            let rootURL = root.standardizedFileURL
            guard url.path.hasPrefix(rootURL.path + "/") else {
                throw ValidationError.segmentOutsideProject
            }
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            let byteLength = (attributes[.size] as? NSNumber)?.intValue ?? 0
            guard byteLength > 0, byteLength == segment.byteLength else {
                throw ValidationError.byteLengthMismatch
            }
            let asset = AVURLAsset(url: url)
            let mediaType: AVMediaType = isVideo(track) ? .video : .audio
            let mediaTracks = try await asset.loadTracks(withMediaType: mediaType)
            guard let mediaTrack = mediaTracks.first else {
                throw ValidationError.expectedMediaTrackMissing
            }
            let descriptions = try await mediaTrack.load(.formatDescriptions)
            guard let description = descriptions.first else {
                throw ValidationError.formatDescriptionMissing
            }
            let subtype = CMFormatDescriptionGetMediaSubType(description)
            let actualCodec = fourCC(subtype)
            guard codecMatches(subtype, expected: expectedCodec) else {
                throw ValidationError.codecMismatch(expected: expectedCodec, actual: actualCodec)
            }
            guard decodeFirstSample(asset: asset, track: mediaTrack, mediaType: mediaType) else {
                throw ValidationError.firstSampleDecodeFailed
            }
            let duration = try await asset.load(.duration)
            let durationUs = duration.convertScale(1_000_000, method: .roundTowardZero).value
            guard duration.isNumeric, durationUs > 0 else {
                throw ValidationError.invalidDuration
            }
            return RecordingSegmentValidation(
                track: track,
                index: segment.index,
                relativePath: segment.relativePath,
                expectedCodec: expectedCodec,
                actualCodec: actualCodec,
                durationUs: durationUs,
                byteLength: byteLength,
                isDecodable: true,
                issue: nil
            )
        } catch {
            return RecordingSegmentValidation(
                track: track,
                index: segment.index,
                relativePath: segment.relativePath,
                expectedCodec: expectedCodec,
                actualCodec: nil,
                durationUs: 0,
                byteLength: segment.byteLength,
                isDecodable: false,
                issue: String(describing: error)
            )
        }
    }

    private static func expectedCodec(
        for track: RecordingTrackKind,
        manifest: RecoverableRecordingManifest
    ) -> String {
        switch track {
        case .screen: return manifest.capture?.screen.codec.rawValue ?? "h264"
        case .camera: return manifest.capture?.camera?.codec.rawValue ?? "h264"
        case .microphone, .systemAudio: return "aac"
        case .excalidrawEvents, .inputTelemetry: return "json"
        }
    }

    private static func isVideo(_ track: RecordingTrackKind) -> Bool {
        track == .screen || track == .camera
    }

    private static func codecMatches(_ subtype: FourCharCode, expected: String) -> Bool {
        switch expected {
        case "h264": subtype == kCMVideoCodecType_H264
        case "hevc": subtype == kCMVideoCodecType_HEVC
        case "aac": subtype == kAudioFormatMPEG4AAC
        default: false
        }
    }

    private static func decodeFirstSample(
        asset: AVAsset,
        track: AVAssetTrack,
        mediaType: AVMediaType
    ) -> Bool {
        do {
            let reader = try AVAssetReader(asset: asset)
            let outputSettings: [String: Any]
            if mediaType == .video {
                outputSettings = [
                    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                ]
            } else {
                outputSettings = [
                    AVFormatIDKey: kAudioFormatLinearPCM,
                    AVLinearPCMBitDepthKey: 32,
                    AVLinearPCMIsFloatKey: true,
                    AVLinearPCMIsNonInterleaved: false,
                ]
            }
            let output = AVAssetReaderTrackOutput(track: track, outputSettings: outputSettings)
            guard reader.canAdd(output) else { return false }
            reader.add(output)
            guard reader.startReading(),
                  let sample = output.copyNextSampleBuffer(),
                  CMSampleBufferDataIsReady(sample) else { return false }
            reader.cancelReading()
            return true
        } catch {
            return false
        }
    }

    private static func fourCC(_ value: FourCharCode) -> String {
        let bytes: [UInt8] = [
            UInt8((value >> 24) & 0xff),
            UInt8((value >> 16) & 0xff),
            UInt8((value >> 8) & 0xff),
            UInt8(value & 0xff),
        ]
        let printable = bytes.map { byte in
            byte >= 32 && byte <= 126 ? Character(UnicodeScalar(byte)) : "?"
        }
        return String(printable).trimmingCharacters(in: .whitespaces)
    }

    private enum ValidationError: Error {
        case segmentOutsideProject
        case byteLengthMismatch
        case expectedMediaTrackMissing
        case formatDescriptionMissing
        case codecMismatch(expected: String, actual: String)
        case firstSampleDecodeFailed
        case invalidDuration
    }
}
