@preconcurrency import AVFoundation
import CryptoKit
import CoreImage
import Darwin
import Foundation
import ImageIO
import ObjectiveC.runtime
import QuartzCore

public struct NativeFinalCompositorStage2RenderOptions: Sendable {
    public let isCancelled: @Sendable () -> Bool

    public init(isCancelled: @escaping @Sendable () -> Bool = { false }) {
        self.isCancelled = isCancelled
    }
}

public enum NativeFinalCompositorStage2AudioProcessingPolicyV1: String, Codable, Equatable, Sendable {
    case none
    case canonicalRawPassthrough
    case rawSourceMixWithFixedHeadroom
}

public struct NativeFinalCompositorStage2RenderOutputV1: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let outputRelativePath: String
    public let byteLength: Int
    public let durationUs: Int64
    public let sha256: String
    public let maximumVideoFramesInFlight: Int
    public let maximumAudioFramesPerChunk: Int
    public let checkpointIntervalUs: Int64
    public let reusedReadyOutput: Bool
    public let stage1PlanSHA256: String
    public let supportsInterruptedResume: Bool
    public let audioProcessingPolicy: NativeFinalCompositorStage2AudioProcessingPolicyV1
}

private struct Stage2Checkpoint: Codable {
    enum Status: String, Codable { case rendering, interrupted, cancelled, ready }
    let schemaVersion: Int
    let requestSHA256: String
    var status: Status
    var progressUs: Int64
    var output: NativeFinalCompositorStage2RenderOutputV1?
}

private struct Stage2SourceIdentity: Codable {
    let relativePath: String
    let byteLength: Int64
    let sha256: String
}

private final class Stage2SourceSnapshot: @unchecked Sendable {
    let url: URL
    let identity: Stage2SourceIdentity
    init(url: URL, identity: Stage2SourceIdentity) {
        self.url = url
        self.identity = identity
    }
}

private struct Stage2EffectiveIdentity: Codable {
    let requestSHA256: String
    let sources: [Stage2SourceIdentity]
}

private final class Stage2InProcessLockRegistry: @unchecked Sendable {
    static let shared = Stage2InProcessLockRegistry()

    private let condition = NSCondition()
    private var activeKeys: Set<String> = []

    func acquire(
        key: String,
        isCancelled: @Sendable () -> Bool
    ) throws {
        condition.lock()
        defer { condition.unlock() }
        while activeKeys.contains(key) {
            if isCancelled() { throw NativeFinalCompositorStage2Error.cancelled }
            _ = condition.wait(until: Date(timeIntervalSinceNow: 0.005))
        }
        if isCancelled() { throw NativeFinalCompositorStage2Error.cancelled }
        activeKeys.insert(key)
    }

    func release(key: String) {
        condition.lock()
        activeKeys.remove(key)
        condition.broadcast()
        condition.unlock()
    }
}

private final class Stage2FileLock: @unchecked Sendable {
    private let fd: Int32

    init(directoryFD: Int32, name: String, isCancelled: @Sendable () -> Bool) throws {
        let fd = openat(
            directoryFD,
            name,
            O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC,
            S_IRUSR | S_IWUSR
        )
        guard fd >= 0 else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
        var status = stat()
        guard fstat(fd, &status) == 0, (status.st_mode & S_IFMT) == S_IFREG else {
            Darwin.close(fd)
            throw NativeFinalCompositorStage2Error.invalidOwnedPath
        }
        while flock(fd, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK || errno == EAGAIN else {
                Darwin.close(fd)
                throw NativeFinalCompositorStage2Error.invalidOwnedPath
            }
            if isCancelled() {
                Darwin.close(fd)
                throw NativeFinalCompositorStage2Error.cancelled
            }
            usleep(5_000)
        }
        if isCancelled() {
            _ = flock(fd, LOCK_UN)
            Darwin.close(fd)
            throw NativeFinalCompositorStage2Error.cancelled
        }
        self.fd = fd
    }

    deinit {
        _ = flock(fd, LOCK_UN)
        Darwin.close(fd)
    }
}

private final class Stage2PipelineState: @unchecked Sendable {
    private let lock = NSLock()
    private var error: Error?
    private var residentVideoFrames = 0
    private(set) var maximumVideoFrames = 0
    private(set) var maximumAudioFrames = 0
    private(set) var checkpointProgressUs: Int64 = 0

    func beginVideoFrame() {
        lock.lock(); defer { lock.unlock() }
        residentVideoFrames += 1
        maximumVideoFrames = max(maximumVideoFrames, residentVideoFrames)
    }

    func endVideoFrame() {
        lock.lock(); defer { lock.unlock() }
        residentVideoFrames -= 1
    }

    func observeAudio(frames: Int) {
        lock.lock(); defer { lock.unlock() }
        maximumAudioFrames = max(maximumAudioFrames, frames)
    }

    func advanceCheckpoint(to progressUs: Int64) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard progressUs >= checkpointProgressUs + NativeFinalCompositorStage2.checkpointIntervalUs else {
            return false
        }
        checkpointProgressUs = progressUs - (progressUs % NativeFinalCompositorStage2.checkpointIntervalUs)
        return true
    }

    func fail(_ newError: Error) {
        lock.lock(); defer { lock.unlock() }
        if error == nil { error = newError }
    }

    func currentError() -> Error? {
        lock.lock(); defer { lock.unlock() }
        return error
    }
}

private final class Stage2MediaPipeline: @unchecked Sendable {
    let reader: AVAssetReader
    let writer: AVAssetWriter
    let videoOutput: AVAssetReaderVideoCompositionOutput
    let videoInput: AVAssetWriterInput
    let videoAdaptor: AVAssetWriterInputPixelBufferAdaptor
    let audioOutput: AVAssetReaderAudioMixOutput?
    let audioInput: AVAssetWriterInput?

    init(
        reader: AVAssetReader,
        writer: AVAssetWriter,
        videoOutput: AVAssetReaderVideoCompositionOutput,
        videoInput: AVAssetWriterInput,
        videoAdaptor: AVAssetWriterInputPixelBufferAdaptor,
        audioOutput: AVAssetReaderAudioMixOutput?,
        audioInput: AVAssetWriterInput?
    ) {
        self.reader = reader
        self.writer = writer
        self.videoOutput = videoOutput
        self.videoInput = videoInput
        self.videoAdaptor = videoAdaptor
        self.audioOutput = audioOutput
        self.audioInput = audioInput
    }
}

private final class Stage2SecureProject: @unchecked Sendable {
    let rootFD: Int32
    let finalFD: Int32
    let workFD: Int32
    private let finalPath: String
    private let workPath: String
    private let workName: String
    private var heldInputFDs: [Int32] = []
    private var snapshotIndex = 0

    init(root: URL, requestID: String) throws {
        let rootFD = Darwin.open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard rootFD >= 0 else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
        self.rootFD = rootFD
        if mkdirat(rootFD, "final", S_IRWXU) != 0 && errno != EEXIST {
            Darwin.close(rootFD)
            throw NativeFinalCompositorStage2Error.invalidOwnedPath
        }
        let finalFD = openat(rootFD, "final", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard finalFD >= 0 else {
            Darwin.close(rootFD)
            throw NativeFinalCompositorStage2Error.invalidOwnedPath
        }
        self.finalFD = finalFD
        self.finalPath = try Self.descriptorPath(finalFD)
        let workName = ".\(requestID)-\(UUID().uuidString).stage2-work"
        guard mkdirat(finalFD, workName, S_IRWXU) == 0 else {
            Darwin.close(finalFD); Darwin.close(rootFD)
            throw NativeFinalCompositorStage2Error.invalidOwnedPath
        }
        let workFD = openat(finalFD, workName, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard workFD >= 0 else {
            _ = unlinkat(finalFD, workName, AT_REMOVEDIR)
            Darwin.close(finalFD); Darwin.close(rootFD)
            throw NativeFinalCompositorStage2Error.invalidOwnedPath
        }
        self.workName = workName
        self.workFD = workFD
        self.workPath = try Self.descriptorPath(workFD)
    }

    deinit {
        heldInputFDs.forEach { Darwin.close($0) }
        if let directory = fdopendir(dup(workFD)) {
            while let entry = readdir(directory) {
                let name = withUnsafePointer(to: &entry.pointee.d_name) { pointer in
                    pointer.withMemoryRebound(to: CChar.self, capacity: Int(MAXNAMLEN) + 1) { String(cString: $0) }
                }
                if name != "." && name != ".." { _ = unlinkat(workFD, name, 0) }
            }
            closedir(directory)
        }
        Darwin.close(workFD)
        _ = unlinkat(finalFD, workName, AT_REMOVEDIR)
        _ = Darwin.fsync(finalFD)
        Darwin.close(finalFD)
        Darwin.close(rootFD)
    }

    func openInput(
        _ relativePath: String,
        maximumBytes: Int64,
        isCancelled: @Sendable () -> Bool
    ) throws -> Stage2SourceSnapshot {
        if isCancelled() { throw NativeFinalCompositorStage2Error.cancelled }
        let parts = relativePath.split(separator: "/").map(String.init)
        guard parts.count >= 2 else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
        var directoryFD = dup(rootFD)
        guard directoryFD >= 0 else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
        defer { Darwin.close(directoryFD) }
        for part in parts.dropLast() {
            let nextFD = openat(directoryFD, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard nextFD >= 0 else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
            Darwin.close(directoryFD)
            directoryFD = nextFD
        }
        let fileFD = openat(directoryFD, parts.last!, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fileFD >= 0 else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
        var status = stat()
        guard fstat(fileFD, &status) == 0,
              (status.st_mode & S_IFMT) == S_IFREG,
              status.st_size > 0,
              status.st_size <= maximumBytes else {
            Darwin.close(fileFD)
            throw NativeFinalCompositorStage2Error.inputResourceLimitExceeded(relativePath)
        }
        heldInputFDs.append(fileFD)
        snapshotIndex += 1
        let pathExtension = URL(fileURLWithPath: parts.last!).pathExtension
        let snapshotName = "input-\(snapshotIndex).\(pathExtension)"
        if fclonefileat(fileFD, workFD, snapshotName, 0) != 0 {
            let destinationFD = openat(
                workFD,
                snapshotName,
                O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                S_IRUSR | S_IWUSR
            )
            guard destinationFD >= 0 else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
            defer { Darwin.close(destinationFD) }
            guard lseek(fileFD, 0, SEEK_SET) >= 0 else {
                throw NativeFinalCompositorStage2Error.invalidOwnedPath
            }
            var buffer = [UInt8](repeating: 0, count: 1_048_576)
            while true {
                if isCancelled() { throw NativeFinalCompositorStage2Error.cancelled }
                let count = Darwin.read(fileFD, &buffer, buffer.count)
                guard count >= 0 else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
                if count == 0 { break }
                var offset = 0
                while offset < count {
                    if isCancelled() { throw NativeFinalCompositorStage2Error.cancelled }
                    let written = buffer.withUnsafeBytes { raw in
                        Darwin.write(destinationFD, raw.baseAddress!.advanced(by: offset), count - offset)
                    }
                    guard written > 0 else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
                    offset += written
                }
            }
            guard Darwin.fsync(destinationFD) == 0 else {
                throw NativeFinalCompositorStage2Error.invalidOwnedPath
            }
        }
        if isCancelled() { throw NativeFinalCompositorStage2Error.cancelled }
        guard Darwin.fsync(workFD) == 0 else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
        if isCancelled() { throw NativeFinalCompositorStage2Error.cancelled }
        let snapshotFD = openat(workFD, snapshotName, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard snapshotFD >= 0 else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
        defer { Darwin.close(snapshotFD) }
        var snapshotStatus = stat()
        guard fstat(snapshotFD, &snapshotStatus) == 0,
              (snapshotStatus.st_mode & S_IFMT) == S_IFREG,
              snapshotStatus.st_size > 0,
              snapshotStatus.st_size == status.st_size,
              snapshotStatus.st_size <= maximumBytes else {
            throw NativeFinalCompositorStage2Error.invalidOwnedPath
        }
        if isCancelled() { throw NativeFinalCompositorStage2Error.cancelled }
        let checksum = try hashDescriptor(snapshotFD, isCancelled: isCancelled)
        return Stage2SourceSnapshot(
            url: URL(fileURLWithPath: workPath).appendingPathComponent(snapshotName),
            identity: .init(relativePath: relativePath, byteLength: snapshotStatus.st_size, sha256: checksum)
        )
    }

    func finalURL(_ name: String) -> URL {
        URL(fileURLWithPath: finalPath).appendingPathComponent(name)
    }

    func acquireFileLock(
        name: String,
        isCancelled: @Sendable () -> Bool
    ) throws -> Stage2FileLock {
        try Stage2FileLock(
            directoryFD: finalFD,
            name: name,
            isCancelled: isCancelled
        )
    }

    private static func descriptorPath(_ fd: Int32) throws -> String {
        var bytes = [CChar](repeating: 0, count: Int(MAXPATHLEN))
        guard fcntl(fd, F_GETPATH, &bytes) == 0 else {
            throw NativeFinalCompositorStage2Error.invalidOwnedPath
        }
        let terminator = bytes.firstIndex(of: 0) ?? bytes.endIndex
        return String(
            decoding: bytes[..<terminator].map { UInt8(bitPattern: $0) },
            as: UTF8.self
        )
    }

    private func hashDescriptor(
        _ fd: Int32,
        isCancelled: @Sendable () -> Bool
    ) throws -> String {
        guard lseek(fd, 0, SEEK_SET) >= 0 else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
        var hasher = SHA256()
        var buffer = [UInt8](repeating: 0, count: 1_048_576)
        while true {
            if isCancelled() { throw NativeFinalCompositorStage2Error.cancelled }
            let count = Darwin.read(fd, &buffer, buffer.count)
            guard count >= 0 else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
            if count == 0 { break }
            hasher.update(data: Data(buffer[0..<count]))
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    func exists(_ name: String) -> Bool {
        var status = stat()
        return fstatat(finalFD, name, &status, AT_SYMLINK_NOFOLLOW) == 0
            && (status.st_mode & S_IFMT) == S_IFREG
    }

    func unlink(_ name: String) {
        _ = unlinkat(finalFD, name, 0)
        _ = Darwin.fsync(finalFD)
    }

    func removeOrphans(requestID: String) throws {
        guard let directory = fdopendir(dup(finalFD)) else {
            throw NativeFinalCompositorStage2Error.invalidOwnedPath
        }
        defer { closedir(directory) }
        let prefix = ".\(requestID)-"
        while let entry = readdir(directory) {
            let name = withUnsafePointer(to: &entry.pointee.d_name) { pointer in
                pointer.withMemoryRebound(to: CChar.self, capacity: Int(MAXNAMLEN) + 1) {
                    String(cString: $0)
                }
            }
            if name.hasPrefix(prefix), name.hasSuffix(".tmp.mp4") {
                _ = unlinkat(finalFD, name, 0)
            }
        }
        guard Darwin.fsync(finalFD) == 0 else {
            throw NativeFinalCompositorStage2Error.writerFailed("orphan_cleanup_fsync")
        }
    }

    func publish(
        stagingName: String,
        outputName: String,
        isCancelled: @Sendable () -> Bool
    ) throws {
        if isCancelled() { throw NativeFinalCompositorStage2Error.cancelled }
        let stagingFD = openat(finalFD, stagingName, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard stagingFD >= 0 else { throw NativeFinalCompositorStage2Error.writerFailed("staging_open") }
        defer { Darwin.close(stagingFD) }
        guard Darwin.fsync(stagingFD) == 0 else {
            throw NativeFinalCompositorStage2Error.writerFailed("staging_fsync")
        }
        if isCancelled() { throw NativeFinalCompositorStage2Error.cancelled }
        guard renameatx_np(finalFD, stagingName, finalFD, outputName, UInt32(RENAME_EXCL)) == 0 else {
            if errno == EEXIST { throw NativeFinalCompositorStage2Error.outputIdentityConflict }
            throw NativeFinalCompositorStage2Error.writerFailed("publish_rename")
        }
        guard Darwin.fsync(finalFD) == 0 else {
            throw NativeFinalCompositorStage2Error.writerFailed("publish_directory_fsync")
        }
    }
}

extension NativeFinalCompositorStage2 {
    public static func render(
        _ request: NativeFinalCompositorStage2RequestV1,
        projectRoot: URL,
        options: NativeFinalCompositorStage2RenderOptions = .init()
    ) async throws -> NativeFinalCompositorStage2RenderOutputV1 {
        _ = try validate(request)
        if options.isCancelled() { throw NativeFinalCompositorStage2Error.cancelled }
        let requestHash = try sha256(JSONEncoder.sorted.encode(request))
        let outputLockHash = try sha256(Data(request.outputRelativePath.utf8))
        let fileLockNames = [
            ".stage2-id-\(request.requestID).lock",
            ".stage2-output-\(outputLockHash).lock",
        ].sorted()
        let processLockKeys = fileLockNames.map {
            projectRoot.standardizedFileURL.path + "\u{0}" + $0
        }
        var acquiredProcessLockKeys: [String] = []
        do {
            for key in processLockKeys {
                try Stage2InProcessLockRegistry.shared.acquire(
                    key: key,
                    isCancelled: options.isCancelled
                )
                acquiredProcessLockKeys.append(key)
            }
        } catch {
            for key in acquiredProcessLockKeys.reversed() {
                Stage2InProcessLockRegistry.shared.release(key: key)
            }
            throw error
        }
        defer {
            for key in acquiredProcessLockKeys.reversed() {
                Stage2InProcessLockRegistry.shared.release(key: key)
            }
        }
        let secureProject = try Stage2SecureProject(root: projectRoot, requestID: requestHash)
        var fileLocks: [Stage2FileLock] = []
        for name in fileLockNames {
            fileLocks.append(try secureProject.acquireFileLock(
                name: name,
                isCancelled: options.isCancelled
            ))
        }
        defer { _ = fileLocks }
        let sources = try resolveSources(
            request,
            secureProject: secureProject,
            options: options
        )
        let effectiveHash = try sha256(JSONEncoder.sorted.encode(Stage2EffectiveIdentity(
            requestSHA256: requestHash,
            sources: sources.values.map(\.identity).sorted { $0.relativePath < $1.relativePath }
        )))
        let outputName = URL(fileURLWithPath: request.outputRelativePath).lastPathComponent
        let outputURL = secureProject.finalURL(outputName)
        try secureProject.removeOrphans(requestID: effectiveHash)
        let checkpointName = ".\(request.requestID).stage2-checkpoint.json"
        let stagingName = ".\(effectiveHash)-\(UUID().uuidString).tmp.mp4"
        let stagingURL = secureProject.finalURL(stagingName)
        defer { secureProject.unlink(stagingName) }

        if let checkpoint = try readCheckpointIfPresent(
            directoryFD: secureProject.finalFD,
            name: checkpointName
        ) {
            guard checkpoint.schemaVersion == 1 else {
                throw NativeFinalCompositorStage2Error.unsupportedCheckpointSchemaVersion(
                    checkpoint.schemaVersion
                )
            }
            guard checkpoint.requestSHA256 == effectiveHash else {
                throw NativeFinalCompositorStage2Error.outputIdentityConflict
            }
            if checkpoint.status == .ready,
               let ready = checkpoint.output,
               readyMetadataMatches(ready, request: request),
               secureProject.exists(outputName),
               try fileSize(outputURL) == ready.byteLength,
               try await validatesPlayableOutput(
                   outputURL,
                   expectedSHA256: ready.sha256,
                   expectedDurationUs: outputDurationUs(request),
                   requiresAudio: hasAudio(request),
                   options: options
               ) {
                return .init(
                    schemaVersion: ready.schemaVersion,
                    outputRelativePath: ready.outputRelativePath,
                    byteLength: ready.byteLength,
                    durationUs: ready.durationUs,
                    sha256: ready.sha256,
                    maximumVideoFramesInFlight: ready.maximumVideoFramesInFlight,
                    maximumAudioFramesPerChunk: ready.maximumAudioFramesPerChunk,
                    checkpointIntervalUs: ready.checkpointIntervalUs,
                    reusedReadyOutput: true,
                    stage1PlanSHA256: ready.stage1PlanSHA256,
                    supportsInterruptedResume: false,
                    audioProcessingPolicy: ready.audioProcessingPolicy
                )
            }
            if checkpoint.status != .ready, secureProject.exists(outputName) {
                guard let candidate = checkpoint.output,
                      readyMetadataMatches(candidate, request: request),
                      try fileSize(outputURL) == candidate.byteLength,
                      try await validatesPlayableOutput(
                    outputURL,
                    expectedSHA256: candidate.sha256,
                    expectedDurationUs: outputDurationUs(request),
                    requiresAudio: hasAudio(request),
                    options: options
                ) else {
                    throw NativeFinalCompositorStage2Error.outputIdentityConflict
                }
                let adopted = NativeFinalCompositorStage2RenderOutputV1(
                    schemaVersion: 1,
                    outputRelativePath: request.outputRelativePath,
                    byteLength: candidate.byteLength,
                    durationUs: candidate.durationUs,
                    sha256: candidate.sha256,
                    maximumVideoFramesInFlight: candidate.maximumVideoFramesInFlight,
                    maximumAudioFramesPerChunk: candidate.maximumAudioFramesPerChunk,
                    checkpointIntervalUs: checkpointIntervalUs,
                    reusedReadyOutput: true,
                    stage1PlanSHA256: request.stage1PlanSHA256,
                    supportsInterruptedResume: false,
                    audioProcessingPolicy: audioProcessingPolicy(request)
                )
                try writeCheckpoint(
                    .init(
                        schemaVersion: 1,
                        requestSHA256: effectiveHash,
                        status: .ready,
                        progressUs: adopted.durationUs,
                        output: adopted
                    ),
                    directoryFD: secureProject.finalFD,
                    name: checkpointName
                )
                return adopted
            }
        }
        if secureProject.exists(outputName) {
            throw NativeFinalCompositorStage2Error.outputIdentityConflict
        }
        try writeCheckpoint(
            .init(schemaVersion: 1, requestSHA256: effectiveHash, status: .rendering, progressUs: 0, output: nil),
            directoryFD: secureProject.finalFD,
            name: checkpointName
        )

        do {
            try checkCancelled(options)
            let built = try await buildComposition(request, sources: sources, options: options)
            let state = Stage2PipelineState()
            let result = try write(
                composition: built.composition,
                videoComposition: built.videoComposition,
                audioMix: built.audioMix,
                renderSize: built.renderSize,
                duration: built.duration,
                chartOverlay: built.chartOverlay,
                destination: stagingURL,
                request: request,
                checkpointDirectoryFD: secureProject.finalFD,
                checkpointName: checkpointName,
                requestHash: effectiveHash,
                state: state,
                options: options
            )
            guard try await validatesPlayableOutput(
                stagingURL,
                expectedSHA256: nil,
                expectedDurationUs: outputDurationUs(request),
                requiresAudio: hasAudio(request),
                options: options
            ) else {
                throw NativeFinalCompositorStage2Error.outputValidationFailed
            }
            try checkCancelled(options)
            let checksum = try sha256File(stagingURL, options: options)
            let byteLength = try fileSize(stagingURL)
            let published = NativeFinalCompositorStage2RenderOutputV1(
                schemaVersion: 1,
                outputRelativePath: request.outputRelativePath,
                byteLength: byteLength,
                durationUs: result,
                sha256: checksum,
                maximumVideoFramesInFlight: state.maximumVideoFrames,
                maximumAudioFramesPerChunk: state.maximumAudioFrames,
                checkpointIntervalUs: checkpointIntervalUs,
                reusedReadyOutput: false,
                stage1PlanSHA256: request.stage1PlanSHA256,
                supportsInterruptedResume: false,
                audioProcessingPolicy: audioProcessingPolicy(request)
            )
            try writeCheckpoint(
                .init(
                    schemaVersion: 1,
                    requestSHA256: effectiveHash,
                    status: .rendering,
                    progressUs: result,
                    output: published
                ),
                directoryFD: secureProject.finalFD,
                name: checkpointName
            )
            try checkCancelled(options)
            try secureProject.publish(
                stagingName: stagingName,
                outputName: outputName,
                isCancelled: options.isCancelled
            )
            guard try await validatesPlayableOutput(
                outputURL,
                expectedSHA256: checksum,
                expectedDurationUs: outputDurationUs(request),
                requiresAudio: hasAudio(request),
                options: options
            ) else {
                secureProject.unlink(outputName)
                throw NativeFinalCompositorStage2Error.outputValidationFailed
            }
            try writeCheckpoint(
                .init(
                    schemaVersion: 1,
                    requestSHA256: effectiveHash,
                    status: .ready,
                    progressUs: result,
                    output: published
                ),
                directoryFD: secureProject.finalFD,
                name: checkpointName
            )
            return published
        } catch {
            let status: Stage2Checkpoint.Status = error as? NativeFinalCompositorStage2Error == .cancelled
                ? .cancelled
                : .interrupted
            try? writeCheckpoint(
                .init(schemaVersion: 1, requestSHA256: effectiveHash, status: status, progressUs: 0, output: nil),
                directoryFD: secureProject.finalFD,
                name: checkpointName
            )
            throw error
        }
    }

    private struct BuiltComposition {
        let composition: AVMutableComposition
        let videoComposition: AVVideoComposition
        let audioMix: AVMutableAudioMix?
        let renderSize: CGSize
        let duration: CMTime
        let chartOverlay: Stage2ChartOverlay?
    }

    private final class Stage2ChartOverlay: @unchecked Sendable {
        let image: CIImage
        init(image: CIImage) { self.image = image }
    }

    private static func resolveSources(
        _ request: NativeFinalCompositorStage2RequestV1,
        secureProject: Stage2SecureProject,
        options: NativeFinalCompositorStage2RenderOptions
    ) throws -> [String: Stage2SourceSnapshot] {
        let paths = [
            request.screenRelativePath,
            request.cameraRelativePath,
            request.microphoneRelativePath,
            request.systemAudioRelativePath,
            request.teachingAudioRelativePath,
            request.chartRelativePath,
        ].compactMap { $0 }
        var snapshots: [String: Stage2SourceSnapshot] = [:]
        var totalBytes: Int64 = 0
        for path in paths where snapshots[path] == nil {
            try checkCancelled(options)
            let maximumBytes = path == request.chartRelativePath
                ? maximumChartInputBytes
                : maximumMediaInputBytes
            let snapshot = try secureProject.openInput(
                path,
                maximumBytes: maximumBytes,
                isCancelled: options.isCancelled
            )
            let (newTotal, overflow) = totalBytes.addingReportingOverflow(snapshot.identity.byteLength)
            guard !overflow, newTotal <= maximumTotalInputBytes else {
                throw NativeFinalCompositorStage2Error.inputResourceLimitExceeded("total_input_bytes")
            }
            totalBytes = newTotal
            snapshots[path] = snapshot
        }
        return snapshots
    }

    private static func buildComposition(
        _ request: NativeFinalCompositorStage2RequestV1,
        sources: [String: Stage2SourceSnapshot],
        options: NativeFinalCompositorStage2RenderOptions
    ) async throws -> BuiltComposition {
        try checkCancelled(options)
        guard let screenSnapshot = sources[request.screenRelativePath] else {
            throw NativeFinalCompositorStage2Error.invalidOwnedPath
        }
        let screenAsset = AVURLAsset(url: screenSnapshot.url)
        guard let screenSource = try await screenAsset.loadTracks(withMediaType: .video).first else {
            throw NativeFinalCompositorStage2Error.missingScreenTrack
        }
        try checkCancelled(options)
        let screenDuration = try await screenAsset.load(.duration)
        try checkCancelled(options)
        guard screenDuration.isNumeric else {
            throw NativeFinalCompositorStage2Error.outputValidationFailed
        }
        let actualScreenDurationUs = screenDuration.convertScale(1_000_000, method: .roundTowardZero).value
        guard abs(actualScreenDurationUs - request.sourceDurationUs) <= 150_000 else {
            throw NativeFinalCompositorStage2Error.outputValidationFailed
        }
        let outputDurationUs = request.keepRanges.reduce(Int64(0)) { $0 + ($1.endUs - $1.startUs) }
        let outputDuration = CMTime(value: outputDurationUs, timescale: 1_000_000)
        let naturalSize = try await screenSource.load(.naturalSize)
        try checkCancelled(options)
        let preferredTransform = try await screenSource.load(.preferredTransform)
        try checkCancelled(options)
        let orientedBounds = CGRect(origin: .zero, size: naturalSize).applying(preferredTransform).standardized
        let renderSize = CGSize(width: abs(orientedBounds.width), height: abs(orientedBounds.height))
        guard finitePositive(orientedBounds),
              renderSize.width >= 2,
              renderSize.height >= 2,
              renderSize.width <= maximumVideoWidth,
              renderSize.height <= maximumVideoHeight,
              renderSize.width * renderSize.height <= maximumVideoPixels else {
            throw NativeFinalCompositorStage2Error.outputValidationFailed
        }

        let composition = AVMutableComposition()
        guard let screenTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw NativeFinalCompositorStage2Error.readerSetupFailed
        }
        try insertKeepRanges(
            request.keepRanges,
            source: screenSource,
            destination: screenTrack,
            options: options
        )

        let screenNormalize = preferredTransform.concatenating(
            CGAffineTransform(translationX: -orientedBounds.minX, y: -orientedBounds.minY)
        )
        let screenInstruction = try makeLayerInstruction(
            assetTrack: screenTrack,
            transform: screenNormalize
        )
        var layerInstructions: [AVVideoCompositionLayerInstruction] = [screenInstruction]

        if let cameraPath = request.cameraRelativePath {
            guard let cameraSnapshot = sources[cameraPath] else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
            let cameraAsset = AVURLAsset(url: cameraSnapshot.url)
            guard let cameraSource = try await cameraAsset.loadTracks(withMediaType: .video).first else {
                throw NativeFinalCompositorStage2Error.missingCameraTrack(cameraPath)
            }
            try checkCancelled(options)
            guard let cameraTrack = composition.addMutableTrack(
                withMediaType: .video,
                preferredTrackID: kCMPersistentTrackID_Invalid
            ) else {
                throw NativeFinalCompositorStage2Error.readerSetupFailed
            }
            let cameraDuration = try await cameraAsset.load(.duration)
            try checkCancelled(options)
            guard cameraDuration.isNumeric else {
                throw NativeFinalCompositorStage2Error.outputValidationFailed
            }
            let cameraDurationUs = cameraDuration
                .convertScale(1_000_000, method: .roundTowardZero).value
            guard cameraDurationUs <= maximumSourceDurationUs + 150_000,
                  cameraDuration >= CMTime(value: request.sourceDurationUs - 150_000, timescale: 1_000_000) else {
                throw NativeFinalCompositorStage2Error.outputValidationFailed
            }
            try insertKeepRanges(
                request.keepRanges,
                source: cameraSource,
                destination: cameraTrack,
                options: options
            )
            let size = try await cameraSource.load(.naturalSize)
            try checkCancelled(options)
            let transform = try await cameraSource.load(.preferredTransform)
            try checkCancelled(options)
            let bounds = CGRect(origin: .zero, size: size).applying(transform).standardized
            let target = outputRect(request.cameraFrame, renderSize: renderSize)
            guard finitePositive(bounds),
                  finitePositive(target),
                  bounds.width <= maximumVideoWidth,
                  bounds.height <= maximumVideoHeight,
                  bounds.width * bounds.height <= maximumVideoPixels else {
                throw NativeFinalCompositorStage2Error.outputValidationFailed
            }
            let normalized = transform.concatenating(
                CGAffineTransform(translationX: -bounds.minX, y: -bounds.minY)
            )
            let placement = CGAffineTransform(
                a: target.width / bounds.width,
                b: 0,
                c: 0,
                d: target.height / bounds.height,
                tx: target.minX,
                ty: target.minY
            )
            guard [placement.a, placement.b, placement.c, placement.d, placement.tx, placement.ty]
                .allSatisfy(\.isFinite) else {
                throw NativeFinalCompositorStage2Error.outputValidationFailed
            }
            let cameraInstruction = try makeLayerInstruction(
                assetTrack: cameraTrack,
                transform: normalized.concatenating(placement)
            )
            layerInstructions.insert(cameraInstruction, at: 0)
        }
        let sourceFrameRate = Double(try await screenSource.load(.nominalFrameRate))
        try checkCancelled(options)
        let boundedFrameRate = sourceFrameRate.isFinite && sourceFrameRate > 0
            ? min(60, sourceFrameRate)
            : 30
        let frameDuration = CMTime(
            seconds: 1 / boundedFrameRate,
            preferredTimescale: 60_000
        )
        let instruction = try makeVideoInstruction(
            timeRange: CMTimeRange(start: .zero, duration: outputDuration),
            layerInstructions: layerInstructions
        )
        let videoComposition = try makeVideoComposition(
            frameDuration: frameDuration,
            renderSize: renderSize,
            instructions: [instruction]
        )
        let chartOverlay: Stage2ChartOverlay?
        if let chartPath = request.chartRelativePath {
            guard let chartURL = sources[chartPath]?.url else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
            guard let source = CGImageSourceCreateWithURL(chartURL as CFURL, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
                throw NativeFinalCompositorStage2Error.chartDecodeFailed
            }
            try checkCancelled(options)
            guard CGFloat(image.width) <= maximumVideoWidth,
                  CGFloat(image.height) <= maximumVideoHeight,
                  CGFloat(image.width) * CGFloat(image.height) <= maximumVideoPixels else {
                throw NativeFinalCompositorStage2Error.inputResourceLimitExceeded(chartPath)
            }
            let target = CGRect(
                x: request.chartFrame.x * renderSize.width,
                y: request.chartFrame.y * renderSize.height,
                width: request.chartFrame.width * renderSize.width,
                height: request.chartFrame.height * renderSize.height
            )
            chartOverlay = Stage2ChartOverlay(
                image: CIImage(cgImage: image).transformed(by: CGAffineTransform(
                    a: target.width / CGFloat(image.width),
                    b: 0,
                    c: 0,
                    d: target.height / CGFloat(image.height),
                    tx: target.minX,
                    ty: target.minY
                ))
            )
        } else {
            chartOverlay = nil
        }

        var audioParameters: [AVMutableAudioMixInputParameters] = []
        for (path, volume) in audioSources(request) {
            guard let snapshot = sources[path] else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
            let asset = AVURLAsset(url: snapshot.url)
            guard let source = try await asset.loadTracks(withMediaType: .audio).first else {
                throw NativeFinalCompositorStage2Error.missingAudioTrack(path)
            }
            try checkCancelled(options)
            guard let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
                throw NativeFinalCompositorStage2Error.readerSetupFailed
            }
            let duration = try await asset.load(.duration)
            try checkCancelled(options)
            guard duration.isNumeric else {
                throw NativeFinalCompositorStage2Error.outputValidationFailed
            }
            let durationUs = duration.convertScale(1_000_000, method: .roundTowardZero).value
            guard durationUs <= maximumSourceDurationUs + 150_000,
                  duration >= CMTime(value: request.sourceDurationUs - 150_000, timescale: 1_000_000) else {
                throw NativeFinalCompositorStage2Error.outputValidationFailed
            }
            try insertKeepRanges(
                request.keepRanges,
                source: source,
                destination: track,
                options: options
            )
            let parameters = AVMutableAudioMixInputParameters(track: track)
            parameters.setVolume(volume, at: .zero)
            audioParameters.append(parameters)
        }
        let audioMix: AVMutableAudioMix?
        if audioParameters.isEmpty {
            audioMix = nil
        } else {
            let mix = AVMutableAudioMix()
            mix.inputParameters = audioParameters
            audioMix = mix
        }
        return .init(
            composition: composition,
            videoComposition: videoComposition,
            audioMix: audioMix,
            renderSize: renderSize,
            duration: outputDuration,
            chartOverlay: chartOverlay
        )
    }

    private static func insertKeepRanges(
        _ ranges: [NativeFinalCompositorStage2KeepRangeV1],
        source: AVAssetTrack,
        destination: AVMutableCompositionTrack,
        options: NativeFinalCompositorStage2RenderOptions
    ) throws {
        var cursor = CMTime.zero
        for range in ranges {
            try checkCancelled(options)
            let start = CMTime(value: range.startUs, timescale: 1_000_000)
            let duration = CMTime(value: range.endUs - range.startUs, timescale: 1_000_000)
            try destination.insertTimeRange(CMTimeRange(start: start, duration: duration), of: source, at: cursor)
            cursor = CMTimeAdd(cursor, duration)
        }
    }

    private static func makeLayerInstruction(
        assetTrack: AVAssetTrack,
        transform: CGAffineTransform
    ) throws -> AVVideoCompositionLayerInstruction {
        if #available(macOS 26.0, *) {
            var configuration = AVVideoCompositionLayerInstruction.Configuration(
                assetTrack: assetTrack
            )
            configuration.setTransform(transform, at: .zero)
            return AVVideoCompositionLayerInstruction(configuration: configuration)
        }
        return try makeLegacyLayerInstruction(assetTrack: assetTrack, transform: transform)
    }

    private static func makeLegacyLayerInstruction(
        assetTrack: AVAssetTrack,
        transform: CGAffineTransform
    ) throws -> AVVideoCompositionLayerInstruction {
        typealias Factory = @convention(c) (
            AnyClass,
            Selector,
            AVAssetTrack
        ) -> Unmanaged<AnyObject>
        typealias SetTransform = @convention(c) (
            AnyObject,
            Selector,
            CGAffineTransform,
            CMTime
        ) -> Void
        guard let instructionClass = NSClassFromString("AVMutableVideoCompositionLayerInstruction") else {
            throw NativeFinalCompositorStage2Error.readerSetupFailed
        }
        let factorySelector = NSSelectorFromString("videoCompositionLayerInstructionWithAssetTrack:")
        guard let factoryMethod = class_getClassMethod(instructionClass, factorySelector) else {
            throw NativeFinalCompositorStage2Error.readerSetupFailed
        }
        let factory = unsafeBitCast(method_getImplementation(factoryMethod), to: Factory.self)
        let rawInstruction = factory(
            instructionClass,
            factorySelector,
            assetTrack
        ).takeUnretainedValue()
        let transformSelector = NSSelectorFromString("setTransform:atTime:")
        guard let transformMethod = class_getInstanceMethod(
            instructionClass,
            transformSelector
        ) else {
            throw NativeFinalCompositorStage2Error.readerSetupFailed
        }
        let setTransform = unsafeBitCast(
            method_getImplementation(transformMethod),
            to: SetTransform.self
        )
        setTransform(rawInstruction, transformSelector, transform, .zero)
        guard let instruction = rawInstruction as? AVVideoCompositionLayerInstruction else {
            throw NativeFinalCompositorStage2Error.readerSetupFailed
        }
        return instruction
    }

    private static func makeVideoInstruction(
        timeRange: CMTimeRange,
        layerInstructions: [AVVideoCompositionLayerInstruction]
    ) throws -> AVVideoCompositionInstruction {
        if #available(macOS 26.0, *) {
            return AVVideoCompositionInstruction(configuration: .init(
                layerInstructions: layerInstructions,
                timeRange: timeRange
            ))
        }
        return try makeLegacyVideoInstruction(
            timeRange: timeRange,
            layerInstructions: layerInstructions
        )
    }

    private static func makeLegacyVideoInstruction(
        timeRange: CMTimeRange,
        layerInstructions: [AVVideoCompositionLayerInstruction]
    ) throws -> AVVideoCompositionInstruction {
        typealias Factory = @convention(c) (
            AnyClass,
            Selector
        ) -> Unmanaged<AnyObject>
        typealias SetTimeRange = @convention(c) (
            AnyObject,
            Selector,
            CMTimeRange
        ) -> Void
        typealias SetObjects = @convention(c) (
            AnyObject,
            Selector,
            NSArray
        ) -> Void
        guard let instructionClass = NSClassFromString("AVMutableVideoCompositionInstruction") else {
            throw NativeFinalCompositorStage2Error.readerSetupFailed
        }
        let factorySelector = NSSelectorFromString("videoCompositionInstruction")
        guard let factoryMethod = class_getClassMethod(instructionClass, factorySelector) else {
            throw NativeFinalCompositorStage2Error.readerSetupFailed
        }
        let factory = unsafeBitCast(method_getImplementation(factoryMethod), to: Factory.self)
        let rawInstruction = factory(instructionClass, factorySelector).takeUnretainedValue()

        let timeRangeSelector = NSSelectorFromString("setTimeRange:")
        guard let timeRangeMethod = class_getInstanceMethod(
            instructionClass,
            timeRangeSelector
        ) else {
            throw NativeFinalCompositorStage2Error.readerSetupFailed
        }
        let setTimeRange = unsafeBitCast(
            method_getImplementation(timeRangeMethod),
            to: SetTimeRange.self
        )
        setTimeRange(rawInstruction, timeRangeSelector, timeRange)

        let layersSelector = NSSelectorFromString("setLayerInstructions:")
        guard let layersMethod = class_getInstanceMethod(
            instructionClass,
            layersSelector
        ) else {
            throw NativeFinalCompositorStage2Error.readerSetupFailed
        }
        let setLayers = unsafeBitCast(method_getImplementation(layersMethod), to: SetObjects.self)
        setLayers(rawInstruction, layersSelector, layerInstructions as NSArray)
        guard let instruction = rawInstruction as? AVVideoCompositionInstruction else {
            throw NativeFinalCompositorStage2Error.readerSetupFailed
        }
        return instruction
    }

    private static func makeVideoComposition(
        frameDuration: CMTime,
        renderSize: CGSize,
        instructions: [AVVideoCompositionInstruction]
    ) throws -> AVVideoComposition {
        if #available(macOS 26.0, *) {
            return AVVideoComposition(configuration: .init(
                frameDuration: frameDuration,
                instructions: instructions,
                renderSize: renderSize
            ))
        }
        return try makeLegacyVideoComposition(
            frameDuration: frameDuration,
            renderSize: renderSize,
            instructions: instructions
        )
    }

    private static func makeLegacyVideoComposition(
        frameDuration: CMTime,
        renderSize: CGSize,
        instructions: [AVVideoCompositionInstruction]
    ) throws -> AVVideoComposition {
        typealias Factory = @convention(c) (
            AnyClass,
            Selector
        ) -> Unmanaged<AnyObject>
        typealias SetTime = @convention(c) (
            AnyObject,
            Selector,
            CMTime
        ) -> Void
        typealias SetSize = @convention(c) (
            AnyObject,
            Selector,
            CGSize
        ) -> Void
        typealias SetObjects = @convention(c) (
            AnyObject,
            Selector,
            NSArray
        ) -> Void
        guard let compositionClass = NSClassFromString("AVMutableVideoComposition") else {
            throw NativeFinalCompositorStage2Error.readerSetupFailed
        }
        let factorySelector = NSSelectorFromString("videoComposition")
        guard let factoryMethod = class_getClassMethod(compositionClass, factorySelector) else {
            throw NativeFinalCompositorStage2Error.readerSetupFailed
        }
        let factory = unsafeBitCast(method_getImplementation(factoryMethod), to: Factory.self)
        let rawComposition = factory(compositionClass, factorySelector).takeUnretainedValue()

        let frameDurationSelector = NSSelectorFromString("setFrameDuration:")
        guard let frameDurationMethod = class_getInstanceMethod(
            compositionClass,
            frameDurationSelector
        ) else {
            throw NativeFinalCompositorStage2Error.readerSetupFailed
        }
        let setFrameDuration = unsafeBitCast(
            method_getImplementation(frameDurationMethod),
            to: SetTime.self
        )
        setFrameDuration(rawComposition, frameDurationSelector, frameDuration)

        let renderSizeSelector = NSSelectorFromString("setRenderSize:")
        guard let renderSizeMethod = class_getInstanceMethod(
            compositionClass,
            renderSizeSelector
        ) else {
            throw NativeFinalCompositorStage2Error.readerSetupFailed
        }
        let setRenderSize = unsafeBitCast(
            method_getImplementation(renderSizeMethod),
            to: SetSize.self
        )
        setRenderSize(rawComposition, renderSizeSelector, renderSize)

        let instructionsSelector = NSSelectorFromString("setInstructions:")
        guard let instructionsMethod = class_getInstanceMethod(
            compositionClass,
            instructionsSelector
        ) else {
            throw NativeFinalCompositorStage2Error.readerSetupFailed
        }
        let setInstructions = unsafeBitCast(
            method_getImplementation(instructionsMethod),
            to: SetObjects.self
        )
        setInstructions(rawComposition, instructionsSelector, instructions as NSArray)
        guard let composition = rawComposition as? AVVideoComposition else {
            throw NativeFinalCompositorStage2Error.readerSetupFailed
        }
        return composition
    }

    private static func checkCancelled(
        _ options: NativeFinalCompositorStage2RenderOptions
    ) throws {
        if options.isCancelled() { throw NativeFinalCompositorStage2Error.cancelled }
    }

    private static func write(
        composition: AVMutableComposition,
        videoComposition: AVVideoComposition,
        audioMix: AVMutableAudioMix?,
        renderSize: CGSize,
        duration: CMTime,
        chartOverlay: Stage2ChartOverlay?,
        destination: URL,
        request: NativeFinalCompositorStage2RequestV1,
        checkpointDirectoryFD: Int32,
        checkpointName: String,
        requestHash: String,
        state: Stage2PipelineState,
        options: NativeFinalCompositorStage2RenderOptions
    ) throws -> Int64 {
        let reader = try AVAssetReader(asset: composition)
        let videoTracks = composition.tracks(withMediaType: .video)
        let videoOutput = AVAssetReaderVideoCompositionOutput(
            videoTracks: videoTracks,
            videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        )
        videoOutput.videoComposition = videoComposition
        guard reader.canAdd(videoOutput) else { throw NativeFinalCompositorStage2Error.readerSetupFailed }
        reader.add(videoOutput)

        let audioTracks = composition.tracks(withMediaType: .audio)
        let audioOutput: AVAssetReaderAudioMixOutput?
        if audioTracks.isEmpty {
            audioOutput = nil
        } else {
            let output = AVAssetReaderAudioMixOutput(
                audioTracks: audioTracks,
                audioSettings: [
                    AVFormatIDKey: kAudioFormatLinearPCM,
                    AVSampleRateKey: 48_000,
                    AVNumberOfChannelsKey: 2,
                    AVLinearPCMBitDepthKey: 32,
                    AVLinearPCMIsFloatKey: true,
                    AVLinearPCMIsNonInterleaved: false,
                ]
            )
            output.audioMix = audioMix
            guard reader.canAdd(output) else { throw NativeFinalCompositorStage2Error.readerSetupFailed }
            reader.add(output)
            audioOutput = output
        }

        let writer = try AVAssetWriter(outputURL: destination, fileType: .mp4)
        writer.movieFragmentInterval = CMTime(value: checkpointIntervalUs, timescale: 1_000_000)
        let width = Int(renderSize.width.rounded(.down)) & ~1
        let height = Int(renderSize.height.rounded(.down)) & ~1
        let videoInput = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: width,
                AVVideoHeightKey: height,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: max(2_000_000, min(16_000_000, width * height * 24)),
                    AVVideoMaxKeyFrameIntervalKey: 60,
                    AVVideoAllowFrameReorderingKey: false,
                ],
            ]
        )
        guard writer.canAdd(videoInput) else { throw NativeFinalCompositorStage2Error.writerSetupFailed }
        writer.add(videoInput)
        let videoAdaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: videoInput,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: width,
                kCVPixelBufferHeightKey as String: height,
                kCVPixelBufferIOSurfacePropertiesKey as String: [:],
            ]
        )
        let audioInput: AVAssetWriterInput?
        if audioOutput == nil {
            audioInput = nil
        } else {
            let input = AVAssetWriterInput(
                mediaType: .audio,
                outputSettings: [
                    AVFormatIDKey: kAudioFormatMPEG4AAC,
                    AVSampleRateKey: 48_000,
                    AVNumberOfChannelsKey: 2,
                    AVEncoderBitRateKey: 192_000,
                ]
            )
            guard writer.canAdd(input) else { throw NativeFinalCompositorStage2Error.writerSetupFailed }
            writer.add(input)
            audioInput = input
        }
        guard writer.startWriting() else {
            throw NativeFinalCompositorStage2Error.writerFailed(writer.error?.localizedDescription ?? "start")
        }
        writer.startSession(atSourceTime: .zero)
        guard reader.startReading() else {
            writer.cancelWriting()
            throw NativeFinalCompositorStage2Error.readerFailed(reader.error?.localizedDescription ?? "start")
        }

        let pipeline = Stage2MediaPipeline(
            reader: reader,
            writer: writer,
            videoOutput: videoOutput,
            videoInput: videoInput,
            videoAdaptor: videoAdaptor,
            audioOutput: audioOutput,
            audioInput: audioInput
        )

        let group = DispatchGroup()
        let checkpointFD = dup(checkpointDirectoryFD)
        guard checkpointFD >= 0 else {
            reader.cancelReading()
            writer.cancelWriting()
            throw NativeFinalCompositorStage2Error.writerFailed("checkpoint_directory_dup")
        }
        group.enter()
        DispatchQueue(label: "com.excalicast.stage2.video").async {
            defer {
                pipeline.videoInput.markAsFinished()
                Darwin.close(checkpointFD)
                group.leave()
            }
            let context = CIContext(options: [.cacheIntermediates: false])
            let renderBounds = CGRect(x: 0, y: 0, width: width, height: height)
            while state.currentError() == nil {
                if options.isCancelled() {
                    state.fail(NativeFinalCompositorStage2Error.cancelled); break
                }
                guard let sample = pipeline.videoOutput.copyNextSampleBuffer() else { break }
                guard let sourceBuffer = CMSampleBufferGetImageBuffer(sample),
                      let pool = pipeline.videoAdaptor.pixelBufferPool else {
                    state.fail(NativeFinalCompositorStage2Error.readerFailed("missing_video_pixel_buffer")); break
                }
                state.beginVideoFrame()
                var destinationBuffer: CVPixelBuffer?
                guard CVPixelBufferPoolCreatePixelBuffer(
                    kCFAllocatorDefault,
                    pool,
                    &destinationBuffer
                ) == kCVReturnSuccess, let destinationBuffer else {
                    state.endVideoFrame()
                    state.fail(NativeFinalCompositorStage2Error.writerFailed("pixel_buffer_allocation")); break
                }
                state.beginVideoFrame()
                let screen = CIImage(cvPixelBuffer: sourceBuffer)
                context.render(
                    chartOverlay?.image.composited(over: screen) ?? screen,
                    to: destinationBuffer,
                    bounds: renderBounds,
                    colorSpace: CGColorSpaceCreateDeviceRGB()
                )
                while !pipeline.videoInput.isReadyForMoreMediaData && state.currentError() == nil {
                    if options.isCancelled() { state.fail(NativeFinalCompositorStage2Error.cancelled); break }
                    usleep(1_000)
                }
                guard state.currentError() == nil else {
                    state.endVideoFrame(); state.endVideoFrame(); break
                }
                guard pipeline.videoAdaptor.append(
                    destinationBuffer,
                    withPresentationTime: CMSampleBufferGetPresentationTimeStamp(sample)
                ) else {
                    state.endVideoFrame(); state.endVideoFrame()
                    state.fail(NativeFinalCompositorStage2Error.writerFailed(
                        pipeline.writer.error?.localizedDescription ?? "video_append"
                    ))
                    break
                }
                state.endVideoFrame(); state.endVideoFrame()
                let progressUs = CMSampleBufferGetPresentationTimeStamp(sample)
                    .convertScale(1_000_000, method: .roundTowardZero).value
                if state.currentError() == nil, state.advanceCheckpoint(to: progressUs) {
                    do {
                        try writeCheckpoint(
                            .init(schemaVersion: 1, requestSHA256: requestHash, status: .rendering, progressUs: state.checkpointProgressUs, output: nil),
                            directoryFD: checkpointFD,
                            name: checkpointName
                        )
                    } catch {
                        state.fail(error)
                    }
                }
            }
        }

        if pipeline.audioOutput != nil, pipeline.audioInput != nil {
            group.enter()
            DispatchQueue(label: "com.excalicast.stage2.audio").async {
                guard let pipelineAudioOutput = pipeline.audioOutput,
                      let pipelineAudioInput = pipeline.audioInput else {
                    state.fail(NativeFinalCompositorStage2Error.readerSetupFailed)
                    group.leave()
                    return
                }
                defer { pipelineAudioInput.markAsFinished(); group.leave() }
                while state.currentError() == nil {
                    if options.isCancelled() {
                        state.fail(NativeFinalCompositorStage2Error.cancelled); break
                    }
                    guard let sample = pipelineAudioOutput.copyNextSampleBuffer() else { break }
                    let frames = CMSampleBufferGetNumSamples(sample)
                    var offset = 0
                    while offset < frames && state.currentError() == nil {
                        let chunkFrames = min(request.limits.audioFramesPerChunk, frames - offset)
                        var chunk: CMSampleBuffer?
                        let copyStatus = CMSampleBufferCopySampleBufferForRange(
                            allocator: kCFAllocatorDefault,
                            sampleBuffer: sample,
                            sampleRange: CFRange(location: offset, length: chunkFrames),
                            sampleBufferOut: &chunk
                        )
                        guard copyStatus == noErr, let chunk else {
                            state.fail(NativeFinalCompositorStage2Error.readerFailed("audio_chunk_copy_\(copyStatus)"))
                            break
                        }
                        state.observeAudio(frames: chunkFrames)
                        while !pipelineAudioInput.isReadyForMoreMediaData && state.currentError() == nil {
                            if options.isCancelled() { state.fail(NativeFinalCompositorStage2Error.cancelled); break }
                            usleep(1_000)
                        }
                        guard state.currentError() == nil else { break }
                        guard pipelineAudioInput.append(chunk) else {
                            state.fail(NativeFinalCompositorStage2Error.writerFailed(
                                pipeline.writer.error?.localizedDescription ?? "audio_append"
                            ))
                            break
                        }
                        offset += chunkFrames
                    }
                }
            }
        }
        let durationSeconds = max(0, CMTimeGetSeconds(duration))
        let renderTimeoutSeconds = min(86_400, max(60, durationSeconds * 3 + 60))
        let renderDeadline = DispatchTime.now() + renderTimeoutSeconds
        while group.wait(timeout: .now() + .milliseconds(5)) != .success {
            if options.isCancelled() {
                state.fail(NativeFinalCompositorStage2Error.cancelled)
                pipeline.reader.cancelReading()
                pipeline.writer.cancelWriting()
            } else if DispatchTime.now() >= renderDeadline {
                state.fail(NativeFinalCompositorStage2Error.operationTimedOut("media_pipeline"))
                pipeline.reader.cancelReading()
                pipeline.writer.cancelWriting()
            }
            if state.currentError() != nil {
                let drainDeadline = DispatchTime.now() + .seconds(5)
                while group.wait(timeout: .now() + .milliseconds(5)) != .success,
                      DispatchTime.now() < drainDeadline {}
                break
            }
        }
        if let error = state.currentError() {
            reader.cancelReading(); writer.cancelWriting(); throw error
        }
        guard reader.status == .completed else {
            writer.cancelWriting()
            throw NativeFinalCompositorStage2Error.readerFailed(reader.error?.localizedDescription ?? "finish")
        }
        let semaphore = DispatchSemaphore(value: 0)
        writer.finishWriting { semaphore.signal() }
        let finishDeadline = DispatchTime.now() + .seconds(300)
        while semaphore.wait(timeout: .now() + .milliseconds(5)) != .success {
            if options.isCancelled() {
                writer.cancelWriting()
                throw NativeFinalCompositorStage2Error.cancelled
            }
            if DispatchTime.now() >= finishDeadline {
                writer.cancelWriting()
                throw NativeFinalCompositorStage2Error.operationTimedOut("finish_writing")
            }
        }
        guard writer.status == .completed else {
            throw NativeFinalCompositorStage2Error.writerFailed(writer.error?.localizedDescription ?? "finish")
        }
        return (duration.convertScale(1_000_000, method: .roundTowardZero).value)
    }

    private static func audioSources(
        _ request: NativeFinalCompositorStage2RequestV1
    ) -> [(String, Float)] {
        if let canonicalTeachingMix = request.teachingAudioRelativePath {
            return [(canonicalTeachingMix, 1)]
        }
        return [
            request.microphoneRelativePath.map { ($0, 0.45) },
            request.systemAudioRelativePath.map { ($0, 0.45) },
        ].compactMap { $0 }
    }

    private static func hasAudio(_ request: NativeFinalCompositorStage2RequestV1) -> Bool {
        !audioSources(request).isEmpty
    }

    private static func audioProcessingPolicy(
        _ request: NativeFinalCompositorStage2RequestV1
    ) -> NativeFinalCompositorStage2AudioProcessingPolicyV1 {
        if request.teachingAudioRelativePath != nil { return .canonicalRawPassthrough }
        if request.microphoneRelativePath != nil || request.systemAudioRelativePath != nil {
            return .rawSourceMixWithFixedHeadroom
        }
        return .none
    }

    private static func readyMetadataMatches(
        _ ready: NativeFinalCompositorStage2RenderOutputV1,
        request: NativeFinalCompositorStage2RequestV1
    ) -> Bool {
        ready.schemaVersion == 1
            && ready.outputRelativePath == request.outputRelativePath
            && ready.byteLength > 0
            && ready.durationUs == outputDurationUs(request)
            && ready.sha256.utf8.count == 64
            && ready.sha256.unicodeScalars.allSatisfy {
                ($0.value >= 48 && $0.value <= 57) || ($0.value >= 97 && $0.value <= 102)
            }
            && ready.maximumVideoFramesInFlight >= minimumVideoFramesInFlight
            && ready.maximumVideoFramesInFlight <= request.limits.videoFramesInFlight
            && ready.maximumAudioFramesPerChunk >= 0
            && ready.maximumAudioFramesPerChunk <= request.limits.audioFramesPerChunk
            && ready.checkpointIntervalUs == checkpointIntervalUs
            && ready.stage1PlanSHA256 == request.stage1PlanSHA256
            && !ready.supportsInterruptedResume
            && ready.audioProcessingPolicy == audioProcessingPolicy(request)
    }

    private static func outputDurationUs(
        _ request: NativeFinalCompositorStage2RequestV1
    ) -> Int64 {
        request.keepRanges.reduce(Int64(0)) { partial, range in
            partial + (range.endUs - range.startUs)
        }
    }

    private static func outputRect(
        _ frame: NativeFinalNormalizedFrameV1,
        renderSize: CGSize
    ) -> CGRect {
        CGRect(
            x: frame.x * renderSize.width,
            y: (1 - frame.y - frame.height) * renderSize.height,
            width: frame.width * renderSize.width,
            height: frame.height * renderSize.height
        )
    }

    private static func finitePositive(_ rect: CGRect) -> Bool {
        [rect.minX, rect.minY, rect.width, rect.height].allSatisfy(\.isFinite)
            && rect.width > 0
            && rect.height > 0
    }

    private static func writeCheckpoint(
        _ checkpoint: Stage2Checkpoint,
        directoryFD: Int32,
        name: String
    ) throws {
        var checkpointToPersist = checkpoint
        if let existing = try readCheckpointIfPresent(directoryFD: directoryFD, name: name) {
            guard existing.schemaVersion == 1 else {
                throw NativeFinalCompositorStage2Error.unsupportedCheckpointSchemaVersion(
                    existing.schemaVersion
                )
            }
            guard existing.requestSHA256 == checkpoint.requestSHA256 else {
                throw NativeFinalCompositorStage2Error.outputIdentityConflict
            }
            if existing.status == .ready {
                if checkpoint.status != .ready { return }
                guard existing.output == checkpoint.output else {
                    throw NativeFinalCompositorStage2Error.outputIdentityConflict
                }
                return
            }
            if (checkpoint.status == .interrupted || checkpoint.status == .cancelled),
               checkpoint.output == nil,
               let candidate = existing.output {
                checkpointToPersist.output = candidate
            }
        }
        let data = try JSONEncoder.sorted.encode(checkpointToPersist)
        guard data.count <= 1_048_576 else {
            throw NativeFinalCompositorStage2Error.writerFailed("checkpoint_too_large")
        }
        let stagingName = ".checkpoint-\(UUID().uuidString).tmp"
        let stagingFD = openat(
            directoryFD,
            stagingName,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            S_IRUSR | S_IWUSR
        )
        guard stagingFD >= 0 else { throw NativeFinalCompositorStage2Error.writerFailed("checkpoint_staging_open") }
        var published = false
        defer {
            Darwin.close(stagingFD)
            if !published { _ = unlinkat(directoryFD, stagingName, 0) }
        }
        try data.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let count = Darwin.write(stagingFD, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                guard count > 0 else { throw NativeFinalCompositorStage2Error.writerFailed("checkpoint_write") }
                offset += count
            }
        }
        guard Darwin.fsync(stagingFD) == 0 else {
            throw NativeFinalCompositorStage2Error.writerFailed("checkpoint_file_fsync")
        }
        guard renameat(directoryFD, stagingName, directoryFD, name) == 0 else {
            throw NativeFinalCompositorStage2Error.writerFailed("checkpoint_rename")
        }
        published = true
        guard Darwin.fsync(directoryFD) == 0 else {
            throw NativeFinalCompositorStage2Error.writerFailed("checkpoint_directory_fsync")
        }
    }

    private static func readCheckpoint(directoryFD: Int32, name: String) throws -> Stage2Checkpoint {
        let fd = openat(directoryFD, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw NativeFinalCompositorStage2Error.invalidOwnedPath }
        defer { Darwin.close(fd) }
        var before = stat()
        guard fstat(fd, &before) == 0,
              (before.st_mode & S_IFMT) == S_IFREG,
              before.st_size > 0,
              before.st_size <= 1_048_576 else {
            throw NativeFinalCompositorStage2Error.outputIdentityConflict
        }
        var data = Data(count: Int(before.st_size))
        try data.withUnsafeMutableBytes { raw in
            var offset = 0
            while offset < raw.count {
                let count = Darwin.read(fd, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                guard count > 0 else { throw NativeFinalCompositorStage2Error.outputIdentityConflict }
                offset += count
            }
        }
        var after = stat()
        guard fstat(fd, &after) == 0,
              after.st_ino == before.st_ino,
              after.st_size == before.st_size,
              after.st_mtimespec.tv_sec == before.st_mtimespec.tv_sec,
              after.st_mtimespec.tv_nsec == before.st_mtimespec.tv_nsec else {
            throw NativeFinalCompositorStage2Error.outputIdentityConflict
        }
        do {
            return try JSONDecoder().decode(Stage2Checkpoint.self, from: data)
        } catch {
            throw NativeFinalCompositorStage2Error.outputIdentityConflict
        }
    }

    private static func readCheckpointIfPresent(
        directoryFD: Int32,
        name: String
    ) throws -> Stage2Checkpoint? {
        var status = stat()
        if fstatat(directoryFD, name, &status, AT_SYMLINK_NOFOLLOW) != 0 {
            if errno == ENOENT { return nil }
            throw NativeFinalCompositorStage2Error.outputIdentityConflict
        }
        guard (status.st_mode & S_IFMT) == S_IFREG else {
            throw NativeFinalCompositorStage2Error.outputIdentityConflict
        }
        return try readCheckpoint(directoryFD: directoryFD, name: name)
    }

    private static func validatesPlayableOutput(
        _ url: URL,
        expectedSHA256: String?,
        expectedDurationUs: Int64,
        requiresAudio: Bool,
        options: NativeFinalCompositorStage2RenderOptions
    ) async throws -> Bool {
        try checkCancelled(options)
        guard FileManager.default.fileExists(atPath: url.path) else { return false }
        let initialSize = try fileSize(url)
        guard initialSize > 0 else { return false }
        let initialSHA = try sha256File(url, options: options)
        if let expectedSHA256, initialSHA != expectedSHA256 { return false }
        try checkCancelled(options)
        let asset = AVURLAsset(url: url)
        let duration = try await asset.load(.duration)
        try checkCancelled(options)
        let videos = try await asset.loadTracks(withMediaType: .video)
        try checkCancelled(options)
        let audios = try await asset.loadTracks(withMediaType: .audio)
        try checkCancelled(options)
        guard duration.isNumeric else { return false }
        let actualDurationUs = duration.convertScale(1_000_000, method: .roundTowardZero).value
        guard actualDurationUs > 0,
              abs(actualDurationUs - expectedDurationUs) <= 150_000,
              videos.count == 1,
              audios.count == (requiresAudio ? 1 : 0) else {
            return false
        }
        let videoTimeRange = try await videos[0].load(.timeRange)
        try checkCancelled(options)
        let videoDurationUs = videoTimeRange.duration
            .convertScale(1_000_000, method: .roundTowardZero).value
        guard videoTimeRange.duration.isNumeric,
              abs(videoDurationUs - expectedDurationUs) <= 150_000 else {
            return false
        }
        if let audio = audios.first {
            let audioTimeRange = try await audio.load(.timeRange)
            try checkCancelled(options)
            let audioDurationUs = audioTimeRange.duration
                .convertScale(1_000_000, method: .roundTowardZero).value
            guard audioTimeRange.duration.isNumeric,
                  abs(audioDurationUs - expectedDurationUs) <= 200_000,
                  abs(audioDurationUs - videoDurationUs) <= 200_000 else {
                return false
            }
        }
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        let lastDecodeUs = max(Int64(0), expectedDurationUs - 100_000)
        _ = try await generator.image(
            at: CMTime(value: lastDecodeUs, timescale: 1_000_000)
        ).image
        try checkCancelled(options)
        guard try fileSize(url) == initialSize,
              try sha256File(url, options: options) == initialSHA else {
            return false
        }
        return true
    }

    private static func fileSize(_ url: URL) throws -> Int {
        let value = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber
        return value?.intValue ?? 0
    }

    private static func sha256File(
        _ url: URL,
        options: NativeFinalCompositorStage2RenderOptions
    ) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let data = try handle.read(upToCount: 64 * 1_024), !data.isEmpty {
            try checkCancelled(options)
            hasher.update(data: data)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private static func sha256(_ data: Data) throws -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

private extension JSONEncoder {
    static var sorted: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }
}
