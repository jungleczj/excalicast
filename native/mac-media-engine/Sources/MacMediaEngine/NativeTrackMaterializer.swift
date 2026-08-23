import Foundation
@preconcurrency import AVFoundation
import MacMediaEngineCore

struct MaterializedRecordingTrack: Encodable, Sendable {
    let track: RecordingTrackKind
    let relativePath: String
    let byteLength: Int
    let mimeType: String
}

enum NativeTrackMaterializerError: Error {
    case unsupportedTrack
    case missingTrack
    case invalidSegmentPath
    case invalidTimeline
    case exportUnavailable
    case exportFailed(String)
    case emptyOutput
}

enum NativeTrackMaterializer {
    private static let readableTracks: Set<RecordingTrackKind> = [
        .screen, .camera, .microphone, .systemAudio,
    ]

    static func materialize(
        root: URL,
        manifest: RecoverableRecordingManifest,
        track: RecordingTrackKind
    ) async throws -> MaterializedRecordingTrack {
        guard readableTracks.contains(track) else { throw NativeTrackMaterializerError.unsupportedTrack }
        let segments = (manifest.tracks[track] ?? []).sorted { $0.index < $1.index }
        guard !segments.isEmpty else { throw NativeTrackMaterializerError.missingTrack }
        let continuity = RecordingContinuityValidator.validate(manifest)
        guard continuity.tracks[track]?.issues.isEmpty == true else {
            throw NativeTrackMaterializerError.invalidTimeline
        }

        let materializedRoot = root.appendingPathComponent("materialized", isDirectory: true)
        try FileManager.default.createDirectory(at: materializedRoot, withIntermediateDirectories: true)
        let isVideo = track == .screen || track == .camera
        let fileExtension = isVideo ? "mp4" : "m4a"
        let mimeType = isVideo ? "video/mp4" : "audio/mp4"
        let destination = materializedRoot.appendingPathComponent("\(track.rawValue).\(fileExtension)")
        let temporary = materializedRoot.appendingPathComponent(".\(track.rawValue)-\(UUID().uuidString).tmp.\(fileExtension)")
        try? FileManager.default.removeItem(at: temporary)
        defer { try? FileManager.default.removeItem(at: temporary) }

        let composition = AVMutableComposition()
        guard let compositionTrack = composition.addMutableTrack(
            withMediaType: isVideo ? .video : .audio,
            preferredTrackID: kCMPersistentTrackID_Invalid
        ) else { throw NativeTrackMaterializerError.exportUnavailable }

        let normalizedRoot = root.standardizedFileURL.path + "/"
        var insertionTime = CMTime.zero
        let durationToleranceUs: Int64 = isVideo ? 250_000 : 100_000
        for segment in segments {
            let expectedPrefix = "segments/\(track.rawValue)/"
            guard segment.relativePath.hasPrefix(expectedPrefix) else {
                throw NativeTrackMaterializerError.invalidSegmentPath
            }
            let sourceURL = root.appendingPathComponent(segment.relativePath).standardizedFileURL
            guard sourceURL.path.hasPrefix(normalizedRoot) else {
                throw NativeTrackMaterializerError.invalidSegmentPath
            }
            let asset = AVURLAsset(url: sourceURL)
            guard let sourceTrack = try await asset.loadTracks(withMediaType: isVideo ? .video : .audio).first else {
                throw NativeTrackMaterializerError.missingTrack
            }
            let duration = try await asset.load(.duration)
            let assetDurationUs = Int64((CMTimeGetSeconds(duration) * 1_000_000).rounded())
            guard assetDurationUs > 0,
                  abs(assetDurationUs - segment.durationUs) <= durationToleranceUs else {
                throw NativeTrackMaterializerError.invalidTimeline
            }
            try compositionTrack.insertTimeRange(
                CMTimeRange(start: .zero, duration: duration),
                of: sourceTrack,
                at: insertionTime
            )
            insertionTime = CMTimeAdd(insertionTime, duration)
        }

        guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough) else {
            throw NativeTrackMaterializerError.exportUnavailable
        }
        exporter.outputURL = temporary
        exporter.outputFileType = isVideo ? .mp4 : .m4a
        exporter.shouldOptimizeForNetworkUse = true
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            exporter.exportAsynchronously {
                switch exporter.status {
                case .completed:
                    continuation.resume()
                case .failed, .cancelled:
                    continuation.resume(throwing: NativeTrackMaterializerError.exportFailed(
                        exporter.error?.localizedDescription ?? "unknown"
                    ))
                default:
                    continuation.resume(throwing: NativeTrackMaterializerError.exportFailed("unexpected_status"))
                }
            }
        }

        let byteLength = ((try FileManager.default.attributesOfItem(atPath: temporary.path)[.size]) as? NSNumber)?.intValue ?? 0
        guard byteLength > 0 else { throw NativeTrackMaterializerError.emptyOutput }
        if FileManager.default.fileExists(atPath: destination.path) {
            _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary)
        } else {
            try FileManager.default.moveItem(at: temporary, to: destination)
        }
        return MaterializedRecordingTrack(
            track: track,
            relativePath: "materialized/\(track.rawValue).\(fileExtension)",
            byteLength: byteLength,
            mimeType: mimeType
        )
    }
}
