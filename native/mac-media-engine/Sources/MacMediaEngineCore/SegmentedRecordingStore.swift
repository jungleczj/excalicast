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

public enum RecordingStoreError: Error, Equatable, Sendable {
    case invalidSegmentMetadata
    case invalidFileExtension
    case stagingFileOutsideProject
    case emptySegment
    case missingRequiredTrack(RecordingTrackKind)
}

public struct FinalizedSegment: Codable, Equatable, Sendable {
    public let index: Int
    public let relativePath: String
    public let startUs: Int64
    public let durationUs: Int64
    public let byteLength: Int

    public init(
        index: Int,
        relativePath: String,
        startUs: Int64,
        durationUs: Int64,
        byteLength: Int
    ) {
        self.index = index
        self.relativePath = relativePath
        self.startUs = startUs
        self.durationUs = durationUs
        self.byteLength = byteLength
    }
}

public struct PendingSegmentCommit: Codable, Equatable, Sendable {
    public let track: RecordingTrackKind
    public let index: Int
    public let stagingRelativePath: String
    public let finalRelativePath: String
    public let startUs: Int64
    public let durationUs: Int64
    public let byteLength: Int

    public init(
        track: RecordingTrackKind,
        index: Int,
        stagingRelativePath: String,
        finalRelativePath: String,
        startUs: Int64,
        durationUs: Int64,
        byteLength: Int
    ) {
        self.track = track
        self.index = index
        self.stagingRelativePath = stagingRelativePath
        self.finalRelativePath = finalRelativePath
        self.startUs = startUs
        self.durationUs = durationUs
        self.byteLength = byteLength
    }
}

public struct RecoverableRecordingManifest: Codable, Sendable {
    public let schemaVersion: Int
    public let recordingId: String
    public var state: RecordingStoreState
    public var tracks: [RecordingTrackKind: [FinalizedSegment]]
    public var capture: RecordingCaptureMetadata?

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case recordingId
        case state
        case tracks
        case capture
    }

    public init(
        schemaVersion: Int,
        recordingId: String,
        state: RecordingStoreState,
        tracks: [RecordingTrackKind: [FinalizedSegment]],
        capture: RecordingCaptureMetadata? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.recordingId = recordingId
        self.state = state
        self.tracks = tracks
        self.capture = capture
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        recordingId = try container.decode(String.self, forKey: .recordingId)
        state = try container.decode(RecordingStoreState.self, forKey: .state)
        capture = try container.decodeIfPresent(RecordingCaptureMetadata.self, forKey: .capture)
        do {
            let stringTracks = try container.decode([String: [FinalizedSegment]].self, forKey: .tracks)
            tracks = Dictionary(uniqueKeysWithValues: stringTracks.compactMap { key, value in
                RecordingTrackKind(rawValue: key).map { ($0, value) }
            })
        } catch {
            // Compatibility with the first native checkpoint, where Swift
            // encoded enum-keyed dictionaries as alternating key/value arrays.
            tracks = try container.decode(
                [RecordingTrackKind: [FinalizedSegment]].self,
                forKey: .tracks
            )
        }
        for track in RecordingTrackKind.allCases where tracks[track] == nil {
            tracks[track] = []
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(recordingId, forKey: .recordingId)
        try container.encode(state, forKey: .state)
        try container.encodeIfPresent(capture, forKey: .capture)
        let stringTracks = Dictionary(uniqueKeysWithValues: tracks.map { ($0.key.rawValue, $0.value) })
        try container.encode(stringTracks, forKey: .tracks)
    }
}

public final class SegmentedRecordingStore: @unchecked Sendable {
    private let root: URL
    private let manifestURL: URL
    private var manifest: RecoverableRecordingManifest
    private let encoder = JSONEncoder()
    private let stateLock = NSLock()
    private let pressureLock = NSLock()
    private var pendingWriteBytes = 0
    private var committedBytes = 0
    private var lastCommitLatencyMs: Double = 0
    private var maximumCommitLatencyMs: Double = 0

    public init(root: URL, recordingId: String) throws {
        self.root = root
        self.manifestURL = root.appendingPathComponent("manifest.json")
        self.manifest = RecoverableRecordingManifest(
            schemaVersion: 1,
            recordingId: recordingId,
            state: .recording,
            tracks: Dictionary(uniqueKeysWithValues: RecordingTrackKind.allCases.map { ($0, []) }),
            capture: nil
        )
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try checkpointUnlocked()
    }

    public func appendFinalizedSegment(
        track: RecordingTrackKind,
        index: Int,
        data: Data,
        startUs: Int64,
        durationUs: Int64
    ) throws {
        let stagingURL = try makeStagingSegmentURL(track: track, index: index)
        try data.write(to: stagingURL, options: .atomic)
        try commitStagedSegment(
            track: track,
            index: index,
            stagingURL: stagingURL,
            startUs: startUs,
            durationUs: durationUs,
            fileExtension: "segment"
        )
    }

    public func makeStagingSegmentURL(track: RecordingTrackKind, index: Int) throws -> URL {
        guard index >= 0 else { throw RecordingStoreError.invalidSegmentMetadata }
        let stagingRoot = root.appendingPathComponent("segments/.staging", isDirectory: true)
        try FileManager.default.createDirectory(at: stagingRoot, withIntermediateDirectories: true)
        return stagingRoot.appendingPathComponent("\(track.rawValue)-\(index)-\(UUID().uuidString).part")
    }

    public func commitStagedSegment(
        track: RecordingTrackKind,
        index: Int,
        stagingURL: URL,
        startUs: Int64,
        durationUs: Int64,
        fileExtension: String
    ) throws {
        guard index >= 0, startUs >= 0, durationUs > 0 else {
            throw RecordingStoreError.invalidSegmentMetadata
        }
        let allowedExtension = fileExtension.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0)
        }
        guard allowedExtension, !fileExtension.isEmpty else {
            throw RecordingStoreError.invalidFileExtension
        }
        let stagingRoot = root.appendingPathComponent("segments/.staging", isDirectory: true).standardizedFileURL
        let normalizedStaging = stagingURL.standardizedFileURL
        guard normalizedStaging.path.hasPrefix(stagingRoot.path + "/") else {
            throw RecordingStoreError.stagingFileOutsideProject
        }
        let attributes = try FileManager.default.attributesOfItem(atPath: normalizedStaging.path)
        let byteLength = (attributes[.size] as? NSNumber)?.intValue ?? 0
        guard byteLength > 0 else { throw RecordingStoreError.emptySegment }

        let started = DispatchTime.now().uptimeNanoseconds
        pressureLock.lock()
        pendingWriteBytes += byteLength
        pressureLock.unlock()
        var committed = false
        defer {
            let elapsedMs = Double(DispatchTime.now().uptimeNanoseconds - started) / 1_000_000
            pressureLock.lock()
            pendingWriteBytes = max(0, pendingWriteBytes - byteLength)
            lastCommitLatencyMs = elapsedMs
            maximumCommitLatencyMs = max(maximumCommitLatencyMs, elapsedMs)
            if committed { committedBytes += byteLength }
            pressureLock.unlock()
        }

        stateLock.lock()
        defer { stateLock.unlock() }

        let trackRoot = root.appendingPathComponent("segments/\(track.rawValue)", isDirectory: true)
        try FileManager.default.createDirectory(at: trackRoot, withIntermediateDirectories: true)
        let fileName = String(format: "%06d.%@", index, fileExtension)
        let segmentURL = trackRoot.appendingPathComponent(fileName)
        let relativePath = "segments/\(track.rawValue)/\(fileName)"
        let stagingRelativePath = "segments/.staging/\(normalizedStaging.lastPathComponent)"
        let pendingCommit = PendingSegmentCommit(
            track: track,
            index: index,
            stagingRelativePath: stagingRelativePath,
            finalRelativePath: relativePath,
            startUs: startUs,
            durationUs: durationUs,
            byteLength: byteLength
        )
        let journalRoot = root.appendingPathComponent("segments/.commit-journal", isDirectory: true)
        try FileManager.default.createDirectory(at: journalRoot, withIntermediateDirectories: true)
        let journalURL = journalRoot.appendingPathComponent("\(UUID().uuidString).json")
        try encoder.encode(pendingCommit).write(to: journalURL, options: .atomic)
        if FileManager.default.fileExists(atPath: segmentURL.path) {
            try FileManager.default.removeItem(at: segmentURL)
        }
        try FileManager.default.moveItem(at: normalizedStaging, to: segmentURL)

        let segment = FinalizedSegment(
            index: index,
            relativePath: relativePath,
            startUs: startUs,
            durationUs: durationUs,
            byteLength: byteLength
        )
        var segments = manifest.tracks[track] ?? []
        segments.removeAll { $0.index == index }
        segments.append(segment)
        segments.sort { $0.index < $1.index }
        manifest.tracks[track] = segments
        try checkpointUnlocked()
        try? FileManager.default.removeItem(at: journalURL)
        committed = true
    }

    public func finalize(requiredTracks: Set<RecordingTrackKind> = [.screen]) throws {
        stateLock.lock()
        defer { stateLock.unlock() }
        for track in requiredTracks where manifest.tracks[track, default: []].isEmpty {
            throw RecordingStoreError.missingRequiredTrack(track)
        }
        manifest.state = .ready
        try checkpointUnlocked()
    }

    public func configureCapture(_ metadata: RecordingCaptureMetadata) throws {
        stateLock.lock()
        defer { stateLock.unlock() }
        manifest.capture = metadata
        try checkpointUnlocked()
    }

    public func updateFinalPressure(_ pressure: CapturePressureSnapshot) throws {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard let capture = manifest.capture else { return }
        manifest.capture = capture.withFinalPressure(pressure)
        try checkpointUnlocked()
    }

    public func updateInputTelemetry(_ telemetry: NativeInputTelemetryCaptureMetadata) throws {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard let capture = manifest.capture else { return }
        manifest.capture = capture.withInputTelemetry(telemetry)
        try checkpointUnlocked()
    }

    private func checkpointUnlocked() throws {
        try encoder.encode(manifest).write(to: manifestURL, options: .atomic)
    }

    public func pressureSnapshot() -> RecordingStorePressureSnapshot {
        pressureLock.lock()
        let snapshot = RecordingStorePressureSnapshot(
            pendingWriteBytes: pendingWriteBytes,
            committedBytes: committedBytes,
            lastCommitLatencyMs: lastCommitLatencyMs,
            maximumCommitLatencyMs: maximumCommitLatencyMs
        )
        pressureLock.unlock()
        return snapshot
    }

    public func markInterrupted() throws {
        stateLock.lock()
        defer { stateLock.unlock() }
        manifest.state = .interrupted
        try checkpointUnlocked()
    }

    public static func recover(root: URL) throws -> RecoverableRecordingManifest {
        let manifestURL = root.appendingPathComponent("manifest.json")
        var manifest = try JSONDecoder().decode(
            RecoverableRecordingManifest.self,
            from: Data(contentsOf: manifestURL)
        )
        var removedInvalidSegment = false
        for track in RecordingTrackKind.allCases {
            let original = manifest.tracks[track] ?? []
            let valid = original.filter { segment in
                let url = root.appendingPathComponent(segment.relativePath)
                guard FileManager.default.fileExists(atPath: url.path),
                      let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
                      ((attributes[.size] as? NSNumber)?.intValue ?? 0) > 0 else { return false }
                return true
            }
            removedInvalidSegment = removedInvalidSegment || valid.count != original.count
            manifest.tracks[track] = valid
        }
        let replayedCommit = try replayPendingCommits(
            root: root,
            manifest: &manifest,
            promoteStagedFiles: false
        )
        if manifest.state == .recording || manifest.state == .finalizing
            || removedInvalidSegment || replayedCommit {
            manifest.state = .interrupted
        }
        return manifest
    }

    public static func recoverAndCheckpoint(root: URL) throws -> RecoverableRecordingManifest {
        var manifest = try recover(root: root)
        if try replayPendingCommits(
            root: root,
            manifest: &manifest,
            promoteStagedFiles: true
        ) {
            manifest.state = .interrupted
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(manifest).write(
            to: root.appendingPathComponent("manifest.json"),
            options: .atomic
        )
        let journalRoot = root.appendingPathComponent("segments/.commit-journal", isDirectory: true)
        if let journals = try? FileManager.default.contentsOfDirectory(
            at: journalRoot,
            includingPropertiesForKeys: nil
        ) {
            for journal in journals { try FileManager.default.removeItem(at: journal) }
        }
        let stagingRoot = root.appendingPathComponent("segments/.staging", isDirectory: true)
        if let children = try? FileManager.default.contentsOfDirectory(
            at: stagingRoot,
            includingPropertiesForKeys: nil
        ) {
            for child in children { try FileManager.default.removeItem(at: child) }
        }
        return manifest
    }

    private static func replayPendingCommits(
        root: URL,
        manifest: inout RecoverableRecordingManifest,
        promoteStagedFiles: Bool
    ) throws -> Bool {
        let journalRoot = root.appendingPathComponent("segments/.commit-journal", isDirectory: true)
        guard let journalURLs = try? FileManager.default.contentsOfDirectory(
            at: journalRoot,
            includingPropertiesForKeys: nil
        ) else { return false }
        var recoveredNewMedia = false
        for journalURL in journalURLs where journalURL.pathExtension == "json" {
            guard let data = try? Data(contentsOf: journalURL),
                  let record = try? JSONDecoder().decode(PendingSegmentCommit.self, from: data),
                  record.index >= 0,
                  record.startUs >= 0,
                  record.durationUs > 0,
                  record.byteLength > 0,
                  let stagingURL = safeURL(
                    root: root,
                    relativePath: record.stagingRelativePath,
                    requiredPrefix: "segments/.staging/"
                  ),
                  let finalURL = safeURL(
                    root: root,
                    relativePath: record.finalRelativePath,
                    requiredPrefix: "segments/\(record.track.rawValue)/"
                  ) else { continue }

            if !FileManager.default.fileExists(atPath: finalURL.path),
               promoteStagedFiles,
               fileSize(at: stagingURL) == record.byteLength {
                try FileManager.default.createDirectory(
                    at: finalURL.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                try FileManager.default.moveItem(at: stagingURL, to: finalURL)
            }
            guard fileSize(at: finalURL) == record.byteLength else { continue }

            let finalized = FinalizedSegment(
                index: record.index,
                relativePath: record.finalRelativePath,
                startUs: record.startUs,
                durationUs: record.durationUs,
                byteLength: record.byteLength
            )
            var segments = manifest.tracks[record.track, default: []]
            if segments.contains(finalized) { continue }
            segments.removeAll { $0.index == record.index }
            segments.append(finalized)
            segments.sort { $0.index < $1.index }
            manifest.tracks[record.track] = segments
            recoveredNewMedia = true
        }
        return recoveredNewMedia
    }

    private static func safeURL(
        root: URL,
        relativePath: String,
        requiredPrefix: String
    ) -> URL? {
        guard relativePath.hasPrefix(requiredPrefix), !relativePath.hasPrefix("/") else { return nil }
        let rootURL = root.standardizedFileURL
        let candidate = rootURL.appendingPathComponent(relativePath).standardizedFileURL
        let requiredDirectory = rootURL
            .appendingPathComponent(String(requiredPrefix.dropLast()), isDirectory: true)
            .standardizedFileURL
        guard candidate.path.hasPrefix(requiredDirectory.path + "/") else { return nil }
        return candidate
    }

    private static func fileSize(at url: URL) -> Int {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path) else {
            return 0
        }
        return (attributes[.size] as? NSNumber)?.intValue ?? 0
    }
}
