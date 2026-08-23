import Foundation

public enum RecordingTrackKind: String, Codable, CaseIterable, Hashable, Sendable {
    case screen
    case camera
    case microphone
    case systemAudio = "system-audio"
    case excalidrawEvents = "excalidraw-events"
    case inputTelemetry = "input-telemetry"
}

public enum RecordingStoreState: String, Codable, Sendable {
    case recording
    case finalizing
    case ready
    case interrupted
    case error
}

public struct FinalizedSegment: Codable, Equatable, Sendable {
    public let index: Int
    public let relativePath: String
    public let startUs: Int64
    public let durationUs: Int64
    public let byteLength: Int
}

public struct RecoverableRecordingManifest: Codable, Sendable {
    public let schemaVersion: Int
    public let recordingId: String
    public var state: RecordingStoreState
    public var tracks: [RecordingTrackKind: [FinalizedSegment]]
}

public final class SegmentedRecordingStore: @unchecked Sendable {
    private let root: URL
    private let manifestURL: URL
    private var manifest: RecoverableRecordingManifest
    private let encoder = JSONEncoder()

    public init(root: URL, recordingId: String) throws {
        self.root = root
        self.manifestURL = root.appendingPathComponent("manifest.json")
        self.manifest = RecoverableRecordingManifest(
            schemaVersion: 1,
            recordingId: recordingId,
            state: .recording,
            tracks: Dictionary(uniqueKeysWithValues: RecordingTrackKind.allCases.map { ($0, []) })
        )
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try checkpoint()
    }

    public func appendFinalizedSegment(
        track: RecordingTrackKind,
        index: Int,
        data: Data,
        startUs: Int64,
        durationUs: Int64
    ) throws {
        let trackRoot = root.appendingPathComponent("segments/\(track.rawValue)", isDirectory: true)
        try FileManager.default.createDirectory(at: trackRoot, withIntermediateDirectories: true)
        let fileName = String(format: "%06d.segment", index)
        let segmentURL = trackRoot.appendingPathComponent(fileName)
        try data.write(to: segmentURL, options: .atomic)

        let relativePath = "segments/\(track.rawValue)/\(fileName)"
        let segment = FinalizedSegment(
            index: index,
            relativePath: relativePath,
            startUs: startUs,
            durationUs: durationUs,
            byteLength: data.count
        )
        var segments = manifest.tracks[track] ?? []
        segments.removeAll { $0.index == index }
        segments.append(segment)
        segments.sort { $0.index < $1.index }
        manifest.tracks[track] = segments
        try checkpoint()
    }

    public func finalize() throws {
        manifest.state = .ready
        try checkpoint()
    }

    private func checkpoint() throws {
        try encoder.encode(manifest).write(to: manifestURL, options: .atomic)
    }

    public static func recover(root: URL) throws -> RecoverableRecordingManifest {
        let manifestURL = root.appendingPathComponent("manifest.json")
        var manifest = try JSONDecoder().decode(
            RecoverableRecordingManifest.self,
            from: Data(contentsOf: manifestURL)
        )
        for track in RecordingTrackKind.allCases {
            manifest.tracks[track] = (manifest.tracks[track] ?? []).filter { segment in
                FileManager.default.fileExists(atPath: root.appendingPathComponent(segment.relativePath).path)
            }
        }
        if manifest.state == .recording || manifest.state == .finalizing {
            manifest.state = .interrupted
        }
        return manifest
    }
}
