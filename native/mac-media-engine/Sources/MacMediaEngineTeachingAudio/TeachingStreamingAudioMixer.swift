@preconcurrency import AVFoundation
import AudioToolbox
import CryptoKit
import Foundation

public enum TeachingStreamingAudioError: Error, Equatable {
    case unsupportedSchemaVersion(Int)
    case invalidInput
    case invalidChunkFrames
    case invalidOwnedPath
    case symlinkedOwnedPath
    case checksumMismatch
    case assetIdentityInvalid
    case snapshotBudgetExceeded
    case cueLimitExceeded
    case cancelled
    case sourceFrameCountMismatch
    case sourceAssetTooShort
    case outputIdentityConflict
    case outputWriteFailed
}

public struct TeachingStreamingAudioAssetRefV1: Codable, Sendable, Hashable {
    public let assetID: String
    public let assetVersion: String
    public let checksum: String
    public let cacheRelativePath: String
    public let licenseCacheIdentity: String

    public init(assetID: String, assetVersion: String, checksum: String, cacheRelativePath: String, licenseCacheIdentity: String) {
        self.assetID = assetID; self.assetVersion = assetVersion; self.checksum = checksum
        self.cacheRelativePath = cacheRelativePath; self.licenseCacheIdentity = licenseCacheIdentity
    }
}

public struct TeachingStreamingAudioBaseTrackV1: Codable, Sendable, Hashable {
    public enum Kind: String, Codable, Sendable { case microphone, systemAudio }
    public let kind: Kind
    public let manifestRelativePath: String
    public let checksum: String
    public init(kind: Kind, manifestRelativePath: String, checksum: String) {
        self.kind = kind; self.manifestRelativePath = manifestRelativePath; self.checksum = checksum
    }
}

public struct TeachingStreamingAudioLicenseBindingV1: Codable, Sendable, Hashable {
    public let assetID: String
    public let assetVersion: String
    public let checksum: String
    public let licenseCacheIdentity: String
    public init(assetID: String, assetVersion: String, checksum: String, licenseCacheIdentity: String) {
        self.assetID = assetID; self.assetVersion = assetVersion; self.checksum = checksum; self.licenseCacheIdentity = licenseCacheIdentity
    }
}

public struct TeachingStreamingAudioLicenseManifestV1: Codable, Sendable, Hashable {
    public let schemaVersion: Int
    public let bindings: [TeachingStreamingAudioLicenseBindingV1]
    public init(schemaVersion: Int, bindings: [TeachingStreamingAudioLicenseBindingV1]) {
        self.schemaVersion = schemaVersion; self.bindings = bindings
    }
}

public struct TeachingStreamingAudioLicenseManifestRefV1: Codable, Sendable, Hashable {
    public let manifestRelativePath: String
    public let checksum: String
    public init(manifestRelativePath: String, checksum: String) {
        self.manifestRelativePath = manifestRelativePath; self.checksum = checksum
    }
}

public struct TeachingStreamingAudioDuckingV1: Codable, Sendable, Hashable {
    public let attenuationDb: Float
    public let attackFrames: Int
    public let releaseFrames: Int
    public init(attenuationDb: Float, attackFrames: Int, releaseFrames: Int) {
        self.attenuationDb = attenuationDb; self.attackFrames = attackFrames; self.releaseFrames = releaseFrames
    }
}

public struct TeachingStreamingAudioCueV1: Codable, Sendable, Hashable {
    public let cueID: String
    public let asset: TeachingStreamingAudioAssetRefV1
    public let startFrame: Int
    public let endFrame: Int
    public let gainDb: Float
    public let gainCeilingDb: Float
    public let fadeInFrames: Int
    public let fadeOutFrames: Int
    public let ducking: TeachingStreamingAudioDuckingV1?
    public init(cueID: String, asset: TeachingStreamingAudioAssetRefV1, startFrame: Int, endFrame: Int, gainDb: Float, gainCeilingDb: Float, fadeInFrames: Int, fadeOutFrames: Int, ducking: TeachingStreamingAudioDuckingV1?) {
        self.cueID = cueID; self.asset = asset; self.startFrame = startFrame; self.endFrame = endFrame
        self.gainDb = gainDb; self.gainCeilingDb = gainCeilingDb; self.fadeInFrames = fadeInFrames; self.fadeOutFrames = fadeOutFrames; self.ducking = ducking
    }
}

public struct TeachingStreamingAudioMixInputV1: Codable, Sendable, Hashable {
    public let schemaVersion: Int
    public let sourceRecordingID: String
    public let sampleRate: Int
    public let channelCount: Int
    public let totalFrames: Int
    public let outputRelativePath: String
    public let baseTracks: [TeachingStreamingAudioBaseTrackV1]
    public let cues: [TeachingStreamingAudioCueV1]
    public init(schemaVersion: Int, sourceRecordingID: String, sampleRate: Int, channelCount: Int, totalFrames: Int, outputRelativePath: String, baseTracks: [TeachingStreamingAudioBaseTrackV1], cues: [TeachingStreamingAudioCueV1]) {
        self.schemaVersion = schemaVersion; self.sourceRecordingID = sourceRecordingID; self.sampleRate = sampleRate
        self.channelCount = channelCount; self.totalFrames = totalFrames; self.outputRelativePath = outputRelativePath
        self.baseTracks = baseTracks; self.cues = cues
    }
}

public struct TeachingStreamingAudioMixOptions: Sendable {
    public let maxChunkFrames: Int
    public let maxCues: Int
    public let maxSnapshotBytes: Int64
    public let isCancelled: @Sendable () -> Bool
    /** Integration seam for injected storage faults; the mixer never publishes after it returns true. */
    public let failBeforePublish: @Sendable () -> Bool
    /** Fault seam for recovery tests between the two ordered publication moves. */
    public let failAfterMetadataPublish: @Sendable () -> Bool
    public let beforePublish: @Sendable () -> Void
    public let afterSnapshotsVerified: @Sendable () -> Void
    public init(maxChunkFrames: Int = 4_096, maxCues: Int = 128, maxSnapshotBytes: Int64 = 4_294_967_296, isCancelled: @escaping @Sendable () -> Bool = { false }, failBeforePublish: @escaping @Sendable () -> Bool = { false }, failAfterMetadataPublish: @escaping @Sendable () -> Bool = { false }, beforePublish: @escaping @Sendable () -> Void = {}, afterSnapshotsVerified: @escaping @Sendable () -> Void = {}) {
        self.maxChunkFrames = maxChunkFrames; self.maxCues = maxCues; self.maxSnapshotBytes = maxSnapshotBytes; self.isCancelled = isCancelled; self.failBeforePublish = failBeforePublish; self.failAfterMetadataPublish = failAfterMetadataPublish; self.beforePublish = beforePublish; self.afterSnapshotsVerified = afterSnapshotsVerified
    }
}

public struct TeachingStreamingAudioMixOutputV1: Codable, Sendable, Equatable {
    public let schemaVersion: Int
    public let outputRelativePath: String
    public let inputChecksum: String
    public let checksum: String
    public let byteLength: Int
    public let durationFrames: Int
    public let normalizationPasses: Int
    public let maxChunkFrames: Int
    public let decoderOpenCount: Int
    public let maxConcurrentReaders: Int
    public let maxActiveCueCount: Int
    public let cueFrameEvaluations: Int
}

public struct TeachingStreamingAudioStreamingPlan: Sendable, Equatable {
    public let chunkCount: Int
    public let maxResidentFrames: Int
}

private let targetPeak: Float = pow(10, -1 / 20)
private let hardMaxCues = 256
private let hardMaxActiveCues = 8
private let hardMaxSnapshotBytes: Int64 = 4_294_967_296

private struct StoredOutput: Codable { let output: TeachingStreamingAudioMixOutputV1 }
private struct TrustedMixIdentity: Codable {
    let input: TeachingStreamingAudioMixInputV1
    let trustedLicenseManifest: TeachingStreamingAudioLicenseManifestRefV1?
}
private let outputMetadataXattr = "com.excalicast.teaching-audio.v1"

private enum InProcessOutputLocks {
    private struct Entry { let lock: NSLock; var users: Int }
    private static let registryLock = NSLock()
    nonisolated(unsafe) private static var locks: [String: Entry] = [:]
    static func acquire(_ key: String, options: TeachingStreamingAudioMixOptions) throws -> InProcessOutputLockLease {
        registryLock.lock()
        var entry = locks[key] ?? Entry(lock: NSLock(), users: 0)
        entry.users += 1; locks[key] = entry
        registryLock.unlock()
        var acquired = false
        do {
            while !entry.lock.try() {
                try TeachingStreamingAudioMixer.checkCancellation(options)
                usleep(5_000)
            }
            acquired = true
            try TeachingStreamingAudioMixer.checkCancellation(options)
            return InProcessOutputLockLease(key: key, lock: entry.lock)
        } catch {
            if acquired { entry.lock.unlock() }
            abandon(key: key, lock: entry.lock)
            throw error
        }
    }
    static func release(key: String, lock: NSLock) {
        lock.unlock()
        abandon(key: key, lock: lock)
    }
    private static func abandon(key: String, lock: NSLock) {
        registryLock.lock(); defer { registryLock.unlock() }
        guard var entry = locks[key], entry.lock === lock else { return }
        entry.users -= 1
        if entry.users == 0 { locks.removeValue(forKey: key) } else { locks[key] = entry }
    }
}

private final class InProcessOutputLockLease {
    private let key: String
    private let lock: NSLock
    private var released = false
    init(key: String, lock: NSLock) { self.key = key; self.lock = lock }
    func release() {
        guard !released else { return }; released = true
        InProcessOutputLocks.release(key: key, lock: lock)
    }
    deinit { release() }
}

private func dataFromFloats(_ values: [Float]) -> Data {
    values.withUnsafeBufferPointer { Data(buffer: $0) }
}

private func floatFromData(_ data: Data) -> [Float] {
    data.withUnsafeBytes { raw in Array(raw.bindMemory(to: Float.self)) }
}

private func dbGain(_ decibels: Float) -> Float { pow(10, decibels / 20) }

private func require(_ condition: Bool, _ error: TeachingStreamingAudioError = .invalidInput) throws {
    if !condition { throw error }
}

private func isSafeIdentifier(_ value: String) -> Bool {
    !value.isEmpty && value != "." && value != ".." && value.unicodeScalars.allSatisfy { scalar in
        let code = scalar.value
        return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code == 45 || code == 95 || code == 46
    }
}

private func fsyncFile(_ handle: FileHandle) throws { try handle.synchronize() }

private final class SecureDirectory {
    let fd: Int32
    init(fd: Int32) { self.fd = fd }
    deinit { close(fd) }

    static func openTree(root: URL, components: [String], create: Bool) throws -> SecureDirectory {
        var currentFD = open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard currentFD >= 0 else { throw TeachingStreamingAudioError.invalidOwnedPath }
        for component in components {
            guard isSafeIdentifier(component) else { close(currentFD); throw TeachingStreamingAudioError.invalidOwnedPath }
            if create && mkdirat(currentFD, component, 0o700) != 0 && errno != EEXIST {
                close(currentFD); throw TeachingStreamingAudioError.outputWriteFailed
            }
            let nextFD = openat(currentFD, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
            guard nextFD >= 0 else { close(currentFD); throw TeachingStreamingAudioError.invalidOwnedPath }
            close(currentFD); currentFD = nextFD
        }
        return SecureDirectory(fd: currentFD)
    }

    func child(_ name: String, create: Bool) throws -> SecureDirectory {
        guard isSafeIdentifier(name) else { throw TeachingStreamingAudioError.invalidOwnedPath }
        if create && mkdirat(fd, name, 0o700) != 0 && errno != EEXIST { throw TeachingStreamingAudioError.outputWriteFailed }
        let childFD = openat(fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard childFD >= 0 else { throw TeachingStreamingAudioError.invalidOwnedPath }
        return SecureDirectory(fd: childFD)
    }

    func lock(outputName: String, options: TeachingStreamingAudioMixOptions) throws -> FileHandle {
        let lockFD = openat(fd, ".\(outputName).lock", O_RDWR | O_CREAT | O_NOFOLLOW, 0o600)
        guard lockFD >= 0 else { throw TeachingStreamingAudioError.outputWriteFailed }
        do {
            while flock(lockFD, LOCK_EX | LOCK_NB) != 0 {
                guard errno == EWOULDBLOCK || errno == EAGAIN || errno == EINTR else {
                    throw TeachingStreamingAudioError.outputWriteFailed
                }
                try TeachingStreamingAudioMixer.checkCancellation(options)
                usleep(5_000)
            }
            try TeachingStreamingAudioMixer.checkCancellation(options)
        } catch {
            _ = flock(lockFD, LOCK_UN)
            close(lockFD)
            throw error
        }
        return FileHandle(fileDescriptor: lockFD, closeOnDealloc: true)
    }

    func recoverOrphans() {
        guard let directory = fdopendir(dup(fd)) else { return }
        defer { closedir(directory) }
        while let entry = readdir(directory) {
            let name = withUnsafePointer(to: &entry.pointee.d_name) { pointer in
                pointer.withMemoryRebound(to: CChar.self, capacity: Int(MAXNAMLEN) + 1) { String(cString: $0) }
            }
            if name != "." && name != ".." { _ = unlinkat(fd, name, 0) }
        }
        _ = fsync(fd)
    }
}

private func sha256Text(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
}

private func hashDescriptor(_ fd: Int32, options: TeachingStreamingAudioMixOptions? = nil) throws -> String {
    guard lseek(fd, 0, SEEK_SET) >= 0 else { throw TeachingStreamingAudioError.outputWriteFailed }
    var hasher = SHA256(); var buffer = [UInt8](repeating: 0, count: 65_536)
    while true {
        if let options { try TeachingStreamingAudioMixer.checkCancellation(options) }
        let count = read(fd, &buffer, buffer.count)
        guard count >= 0 else { throw TeachingStreamingAudioError.outputWriteFailed }
        if count == 0 { break }
        hasher.update(data: Data(buffer[0..<count]))
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
}

private func readStoredOutput(fd: Int32) throws -> StoredOutput? {
    let size = fgetxattr(fd, outputMetadataXattr, nil, 0, 0, 0)
    if size < 0 { return nil }
    guard size <= 16_384 else { throw TeachingStreamingAudioError.outputIdentityConflict }
    var bytes = [UInt8](repeating: 0, count: size)
    guard fgetxattr(fd, outputMetadataXattr, &bytes, size, 0, 0) == size else { throw TeachingStreamingAudioError.outputIdentityConflict }
    return try JSONDecoder().decode(StoredOutput.self, from: Data(bytes))
}

private func writeStoredOutput(fd: Int32, data: Data) throws {
    guard data.count <= 16_384 else { throw TeachingStreamingAudioError.outputWriteFailed }
    let result = data.withUnsafeBytes { raw in fsetxattr(fd, outputMetadataXattr, raw.baseAddress, raw.count, 0, 0) }
    guard result == 0, fsync(fd) == 0 else { throw TeachingStreamingAudioError.outputWriteFailed }
}

private func descriptorURL(_ fd: Int32) -> URL { URL(fileURLWithPath: "/dev/fd/\(fd)") }

private func decodedAudioInfo(snapshot: VerifiedSnapshot) throws -> (frames: Int, sampleRate: Int, channels: Int) {
    let fd = try snapshot.duplicateFD()
    defer { close(fd) }
    let file = try AVAudioFile(forReading: descriptorURL(fd))
    let format = file.processingFormat
    guard format.commonFormat == .pcmFormatFloat32,
          (1...2).contains(Int(format.channelCount)),
          format.sampleRate.isFinite,
          format.sampleRate.rounded() == format.sampleRate else { throw TeachingStreamingAudioError.invalidInput }
    return (Int(file.length), Int(format.sampleRate), Int(format.channelCount))
}

private func openRelativeFile(rootFD: Int32, relativePath: String) throws -> Int32 {
    let components = relativePath.split(separator: "/").map(String.init)
    guard !components.isEmpty, components.allSatisfy(isSafeIdentifier) else { throw TeachingStreamingAudioError.invalidOwnedPath }
    var currentFD = dup(rootFD)
    guard currentFD >= 0 else { throw TeachingStreamingAudioError.invalidOwnedPath }
    for component in components.dropLast() {
        let next = openat(currentFD, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        close(currentFD)
        guard next >= 0 else { throw TeachingStreamingAudioError.invalidOwnedPath }
        currentFD = next
    }
    let fileFD = openat(currentFD, components.last!, O_RDONLY | O_NOFOLLOW)
    close(currentFD)
    guard fileFD >= 0 else { throw TeachingStreamingAudioError.symlinkedOwnedPath }
    var status = stat()
    guard fstat(fileFD, &status) == 0, (status.st_mode & S_IFMT) == S_IFREG else { close(fileFD); throw TeachingStreamingAudioError.invalidOwnedPath }
    return fileFD
}

private func copyImmutableSnapshot(rootFD: Int32, relativePath: String, expectedChecksum: String, outputDirectoryFD: Int32, snapshotName: String, maxBytes: Int64, options: TeachingStreamingAudioMixOptions) throws {
    var complete = false
    defer {
        if !complete {
            _ = unlinkat(outputDirectoryFD, snapshotName, 0)
            _ = fsync(outputDirectoryFD)
        }
    }
    let sourceFD = try openRelativeFile(rootFD: rootFD, relativePath: relativePath)
    defer { close(sourceFD) }
    var sourceStatus = stat()
    guard fstat(sourceFD, &sourceStatus) == 0, sourceStatus.st_size >= 0, sourceStatus.st_size <= maxBytes else {
        throw TeachingStreamingAudioError.snapshotBudgetExceeded
    }
    if fclonefileat(sourceFD, outputDirectoryFD, snapshotName, 0) == 0 {
        let snapshotFD = openat(outputDirectoryFD, snapshotName, O_RDONLY | O_NOFOLLOW)
        guard snapshotFD >= 0 else { throw TeachingStreamingAudioError.outputWriteFailed }
        defer { close(snapshotFD) }
        guard try hashDescriptor(snapshotFD, options: options) == expectedChecksum else { throw TeachingStreamingAudioError.checksumMismatch }
        guard fsync(snapshotFD) == 0 else { throw TeachingStreamingAudioError.outputWriteFailed }
        complete = true
        return
    }
    guard errno == ENOTSUP || errno == EXDEV || errno == EINVAL else { throw TeachingStreamingAudioError.outputWriteFailed }
    let targetFD = openat(outputDirectoryFD, snapshotName, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    guard targetFD >= 0 else { throw TeachingStreamingAudioError.outputWriteFailed }
    defer { close(targetFD) }
    var hasher = SHA256(); var buffer = [UInt8](repeating: 0, count: 65_536)
    while true {
        try TeachingStreamingAudioMixer.checkCancellation(options)
        let count = read(sourceFD, &buffer, buffer.count)
        guard count >= 0 else { throw TeachingStreamingAudioError.invalidOwnedPath }
        if count == 0 { break }
        hasher.update(data: Data(buffer[0..<count]))
        var offset = 0
        while offset < count {
            let written = buffer.withUnsafeBytes { raw in write(targetFD, raw.baseAddress!.advanced(by: offset), count - offset) }
            guard written > 0 else { throw TeachingStreamingAudioError.outputWriteFailed }
            offset += written
        }
    }
    let actual = hasher.finalize().map { String(format: "%02x", $0) }.joined()
    guard actual == expectedChecksum else { throw TeachingStreamingAudioError.checksumMismatch }
    guard fsync(targetFD) == 0 else { throw TeachingStreamingAudioError.outputWriteFailed }
    complete = true
}

private final class VerifiedSnapshot {
    private let directoryFD: Int32
    private let name: String
    private let device: UInt64
    private let inode: UInt64
    let byteLength: Int64
    let checksum: String
    init(directoryFD: Int32, name: String, expectedChecksum: String, options: TeachingStreamingAudioMixOptions) throws {
        let fd = openat(directoryFD, name, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw TeachingStreamingAudioError.invalidOwnedPath }
        defer { close(fd) }
        self.directoryFD = directoryFD
        self.name = name
        do {
            var status = stat()
            guard fstat(fd, &status) == 0, (status.st_mode & S_IFMT) == S_IFREG, status.st_size >= 0 else {
                throw TeachingStreamingAudioError.assetIdentityInvalid
            }
            device = UInt64(status.st_dev)
            inode = UInt64(status.st_ino)
            byteLength = status.st_size
            checksum = try hashDescriptor(fd, options: options)
            guard checksum == expectedChecksum else { throw TeachingStreamingAudioError.checksumMismatch }
        } catch {
            _ = unlinkat(directoryFD, name, 0); _ = fsync(directoryFD)
            throw error
        }
    }
    func duplicateFD() throws -> Int32 {
        let fd = openat(directoryFD, name, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw TeachingStreamingAudioError.checksumMismatch }
        do {
            var status = stat()
            guard fstat(fd, &status) == 0,
                  UInt64(status.st_dev) == device,
                  UInt64(status.st_ino) == inode,
                  status.st_size == byteLength,
                  try hashDescriptor(fd) == checksum,
                  lseek(fd, 0, SEEK_SET) >= 0 else {
                throw TeachingStreamingAudioError.checksumMismatch
            }
            return fd
        } catch {
            close(fd)
            throw error
        }
    }
    func assertUnchanged(options: TeachingStreamingAudioMixOptions) throws {
        let fd = openat(directoryFD, name, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw TeachingStreamingAudioError.checksumMismatch }
        defer { close(fd) }
        var status = stat()
        guard fstat(fd, &status) == 0,
              UInt64(status.st_dev) == device,
              UInt64(status.st_ino) == inode,
              status.st_size == byteLength,
              try hashDescriptor(fd, options: options) == checksum else {
            throw TeachingStreamingAudioError.checksumMismatch
        }
    }
    func readBounded(maxBytes: Int) throws -> Data {
        let fd = try duplicateFD(); defer { close(fd) }
        var status = stat(); guard fstat(fd, &status) == 0, status.st_size >= 0, status.st_size <= maxBytes else { throw TeachingStreamingAudioError.assetIdentityInvalid }
        guard lseek(fd, 0, SEEK_SET) >= 0 else { throw TeachingStreamingAudioError.assetIdentityInvalid }
        var data = Data(count: Int(status.st_size))
        let count = data.withUnsafeMutableBytes { read(fd, $0.baseAddress, $0.count) }
        guard count == data.count else { throw TeachingStreamingAudioError.assetIdentityInvalid }
        return data
    }
}

private func cafHeader(sampleRate: Int, channelCount: Int, dataBytes: Int) -> Data {
    // CAF has a fixed 68-byte header: caff + desc (linear PCM f32le) + data.
    func u32(_ value: UInt32) -> Data { withUnsafeBytes(of: value.bigEndian) { Data($0) } }
    func u64(_ value: UInt64) -> Data { withUnsafeBytes(of: value.bigEndian) { Data($0) } }
    func f64(_ value: Double) -> Data { withUnsafeBytes(of: value.bitPattern.bigEndian) { Data($0) } }
    var data = Data("caff".utf8); data.append(contentsOf: [0, 1, 0, 0])
    data.append(Data("desc".utf8)); data.append(u64(32)); data.append(f64(Double(sampleRate)))
    data.append(Data("lpcm".utf8)); data.append(u32(3)) // float + little-endian payload
    data.append(u32(UInt32(MemoryLayout<Float>.size * channelCount))); data.append(u32(1)); data.append(u32(UInt32(channelCount))); data.append(u32(32))
    data.append(Data("data".utf8)); data.append(u64(UInt64(dataBytes + 4))); data.append(u32(0))
    return data
}

/** A source is opened once per job and only exposes bounded decoder buffers. */
private final class StreamingAudioReader {
    private let file: AVAudioFile
    private let handle: FileHandle
    init(snapshot: VerifiedSnapshot) throws {
        let fd = try snapshot.duplicateFD()
        handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        file = try AVAudioFile(forReading: descriptorURL(fd))
    }
    func read(offsetFrames: Int, frames: Int) throws -> [Float] {
        guard offsetFrames >= 0, offsetFrames <= Int(file.length), frames >= 0 else { throw TeachingStreamingAudioError.sourceFrameCountMismatch }
        file.framePosition = AVAudioFramePosition(offsetFrames)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(frames)) else { throw TeachingStreamingAudioError.outputWriteFailed }
        try file.read(into: buffer, frameCount: AVAudioFrameCount(frames))
        guard buffer.frameLength == AVAudioFrameCount(frames), let channels = buffer.floatChannelData else { throw TeachingStreamingAudioError.sourceFrameCountMismatch }
        if buffer.format.channelCount == 1 {
            return Array(UnsafeBufferPointer(start: channels[0], count: frames))
        }
        guard buffer.format.channelCount == 2 else { throw TeachingStreamingAudioError.invalidInput }
        var mono = [Float](repeating: 0, count: frames)
        for index in 0..<frames { mono[index] = (channels[0][index] + channels[1][index]) * 0.5 }
        return mono
    }
}

private final class CueReaderPool {
    private struct Entry { let reader: StreamingAudioReader; var lastUse: UInt64 }
    private let snapshots: [VerifiedSnapshot]
    private var entries: [Int: Entry] = [:]
    private var clock: UInt64 = 0
    private(set) var totalOpens = 0
    private(set) var maxConcurrent = 0

    init(snapshots: [VerifiedSnapshot]) { self.snapshots = snapshots }

    func read(cueIndex: Int, offsetFrames: Int, frames: Int) throws -> [Float] {
        clock += 1
        if var entry = entries[cueIndex] {
            entry.lastUse = clock; entries[cueIndex] = entry
            return try entry.reader.read(offsetFrames: offsetFrames, frames: frames)
        }
        if entries.count >= hardMaxActiveCues,
           let victim = entries.min(by: { $0.value.lastUse < $1.value.lastUse })?.key {
            entries.removeValue(forKey: victim)
        }
        let reader = try StreamingAudioReader(snapshot: snapshots[cueIndex])
        entries[cueIndex] = Entry(reader: reader, lastUse: clock)
        totalOpens += 1; maxConcurrent = max(maxConcurrent, entries.count)
        return try reader.read(offsetFrames: offsetFrames, frames: frames)
    }
}

public enum TeachingStreamingAudioMixer {
    /// Pure planning API used by soak tests: it allocates no audio timeline and
    /// proves resident PCM stays at the selected chunk size for any duration.
    public static func streamingPlan(totalFrames: Int, maxChunkFrames: Int = 4_096) throws -> TeachingStreamingAudioStreamingPlan {
        try require(totalFrames > 0 && totalFrames <= 172_800_000)
        try require(maxChunkFrames > 0 && maxChunkFrames <= 4_096, .invalidChunkFrames)
        return .init(chunkCount: (totalFrames + maxChunkFrames - 1) / maxChunkFrames, maxResidentFrames: maxChunkFrames)
    }

    public static func mix(_ input: TeachingStreamingAudioMixInputV1, projectRoot: URL, trustedLicenseManifest: TeachingStreamingAudioLicenseManifestRefV1? = nil, options: TeachingStreamingAudioMixOptions = .init()) throws -> TeachingStreamingAudioMixOutputV1 {
        try validate(input, trustedLicenseManifest: trustedLicenseManifest, options: options)
        try checkCancellation(options)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let identity = TrustedMixIdentity(input: input, trustedLicenseManifest: trustedLicenseManifest)
        let inputChecksum = SHA256.hash(data: try encoder.encode(identity)).map { String(format: "%02x", $0) }.joined()
        let outputDirectory = try SecureDirectory.openTree(root: projectRoot, components: ["teaching", "outputs"], create: true)
        let outputName = String(input.outputRelativePath.split(separator: "/").last!)
        let outputNamespace = sha256Text(input.outputRelativePath)
        let processLock = try InProcessOutputLocks.acquire("\(projectRoot.standardizedFileURL.path)/\(outputName)", options: options)
        defer { processLock.release() }
        let lock = try outputDirectory.lock(outputName: outputNamespace, options: options)
        defer { _ = flock(lock.fileDescriptor, LOCK_UN); try? lock.close() }
        let workDirectory = try outputDirectory.child(".teaching-audio-work-\(outputNamespace)", create: true)
        workDirectory.recoverOrphans()
        try checkCancellation(options)
        let existingFD = openat(outputDirectory.fd, outputName, O_RDONLY | O_NOFOLLOW)
        if existingFD >= 0 {
            defer { close(existingFD) }
            guard let stored = try readStoredOutput(fd: existingFD), stored.output.inputChecksum == inputChecksum,
                  try hashDescriptor(existingFD, options: options) == stored.output.checksum else {
                throw TeachingStreamingAudioError.outputIdentityConflict
            }
            return stored.output
        }

        let token = UUID().uuidString
        let mixedName = "\(token).mixed.pcm"
        let stagingName = "\(token).staging"
        var snapshotNames: [String] = []
        defer {
            _ = unlinkat(workDirectory.fd, mixedName, 0); _ = unlinkat(workDirectory.fd, stagingName, 0)
            for name in snapshotNames { _ = unlinkat(workDirectory.fd, name, 0) }
            _ = fsync(workDirectory.fd)
        }

        let rootDirectory = try SecureDirectory.openTree(root: projectRoot, components: [], create: false)
        var snapshotsByPath: [String: (snapshot: VerifiedSnapshot, checksum: String)] = [:]
        var snapshotBytes: Int64 = 0
        func snapshot(relativePath: String, checksum: String) throws -> VerifiedSnapshot {
            if let existing = snapshotsByPath[relativePath] {
                guard existing.checksum == checksum else { throw TeachingStreamingAudioError.checksumMismatch }
                return existing.snapshot
            }
            guard snapshotsByPath.count < hardMaxCues + 3 else { throw TeachingStreamingAudioError.cueLimitExceeded }
            let snapshotExtension = relativePath.lowercased().hasSuffix(".json") ? "json" : "caf"
            let name = "\(token).source-\(snapshotsByPath.count).\(snapshotExtension)"
            snapshotNames.append(name)
            let remainingBytes = options.maxSnapshotBytes - snapshotBytes
            guard remainingBytes >= 0 else { throw TeachingStreamingAudioError.snapshotBudgetExceeded }
            try copyImmutableSnapshot(rootFD: rootDirectory.fd, relativePath: relativePath, expectedChecksum: checksum, outputDirectoryFD: workDirectory.fd, snapshotName: name, maxBytes: remainingBytes, options: options)
            let verified = try VerifiedSnapshot(directoryFD: workDirectory.fd, name: name, expectedChecksum: checksum, options: options)
            guard verified.byteLength <= remainingBytes else { throw TeachingStreamingAudioError.snapshotBudgetExceeded }
            snapshotBytes += verified.byteLength
            snapshotsByPath[relativePath] = (verified, checksum)
            return verified
        }
        if let manifestRef = trustedLicenseManifest {
            let manifestSnapshot = try snapshot(relativePath: manifestRef.manifestRelativePath, checksum: manifestRef.checksum)
            let manifest = try JSONDecoder().decode(TeachingStreamingAudioLicenseManifestV1.self, from: manifestSnapshot.readBounded(maxBytes: 64 * 1_024))
            guard manifest.schemaVersion == 1 else { throw TeachingStreamingAudioError.assetIdentityInvalid }
            let bindings = Set(manifest.bindings)
            guard bindings.count == manifest.bindings.count else { throw TeachingStreamingAudioError.assetIdentityInvalid }
            let requested = Set(input.cues.map { cue in
                TeachingStreamingAudioLicenseBindingV1(assetID: cue.asset.assetID, assetVersion: cue.asset.assetVersion, checksum: cue.asset.checksum, licenseCacheIdentity: cue.asset.licenseCacheIdentity)
            })
            guard requested.isSubset(of: bindings) else { throw TeachingStreamingAudioError.assetIdentityInvalid }
        }
        let baseSnapshots = try input.baseTracks.map { try snapshot(relativePath: $0.manifestRelativePath, checksum: $0.checksum) }
        let cueSnapshots = try input.cues.map { try snapshot(relativePath: $0.asset.cacheRelativePath, checksum: $0.asset.checksum) }
        for verified in baseSnapshots {
            let info = try decodedAudioInfo(snapshot: verified)
            try require(info.frames == input.totalFrames && info.sampleRate == input.sampleRate && (1...2).contains(info.channels), .sourceFrameCountMismatch)
        }
        for (index, verified) in cueSnapshots.enumerated() {
            let info = try decodedAudioInfo(snapshot: verified)
            let cue = input.cues[index]
            try require(info.frames >= cue.endFrame - cue.startFrame && info.sampleRate == input.sampleRate && info.channels == input.channelCount, .sourceAssetTooShort)
        }
        options.afterSnapshotsVerified()
        try checkCancellation(options)
        for entry in snapshotsByPath.values {
            try entry.snapshot.assertUnchanged(options: options)
        }

        let rendered = try renderMixedPcm(input, directoryFD: workDirectory.fd, mixedName: mixedName, baseSnapshots: baseSnapshots, cueSnapshots: cueSnapshots, options: options)
        let peak = rendered.peak
        let gain: Float = peak > 1 ? targetPeak / peak : 1
        try encodeCaf(directoryFD: workDirectory.fd, mixedName: mixedName, stagingName: stagingName, sampleRate: input.sampleRate, channelCount: input.channelCount, frames: input.totalFrames, finalGain: gain, options: options)
        let stagingFD = openat(workDirectory.fd, stagingName, O_RDWR | O_NOFOLLOW)
        guard stagingFD >= 0 else { throw TeachingStreamingAudioError.outputWriteFailed }
        defer { close(stagingFD) }
        let checksum = try hashDescriptor(stagingFD, options: options)
        var stagingStat = stat(); guard fstat(stagingFD, &stagingStat) == 0 else { throw TeachingStreamingAudioError.outputWriteFailed }
        let byteLength = Int(stagingStat.st_size)
        guard byteLength > 68 else { throw TeachingStreamingAudioError.outputWriteFailed }
        let output = TeachingStreamingAudioMixOutputV1(schemaVersion: 1, outputRelativePath: input.outputRelativePath, inputChecksum: inputChecksum, checksum: checksum, byteLength: byteLength, durationFrames: input.totalFrames, normalizationPasses: 1, maxChunkFrames: options.maxChunkFrames, decoderOpenCount: rendered.decoderOpenCount, maxConcurrentReaders: rendered.maxConcurrentReaders, maxActiveCueCount: rendered.maxActiveCueCount, cueFrameEvaluations: rendered.cueFrameEvaluations)
        try writeStoredOutput(fd: stagingFD, data: encoder.encode(StoredOutput(output: output)))
        try checkCancellation(options)
        options.beforePublish()
        try checkCancellation(options)
        for entry in snapshotsByPath.values {
            try entry.snapshot.assertUnchanged(options: options)
        }
        if options.failBeforePublish() { throw TeachingStreamingAudioError.outputWriteFailed }
        if options.failAfterMetadataPublish() { throw TeachingStreamingAudioError.outputWriteFailed }
        guard renameatx_np(workDirectory.fd, stagingName, outputDirectory.fd, outputName, UInt32(RENAME_EXCL)) == 0 else {
            if errno == EEXIST { throw TeachingStreamingAudioError.outputIdentityConflict }
            throw TeachingStreamingAudioError.outputWriteFailed
        }
        guard fsync(outputDirectory.fd) == 0 else { throw TeachingStreamingAudioError.outputWriteFailed }
        return output
    }

    private static func validate(_ input: TeachingStreamingAudioMixInputV1, trustedLicenseManifest: TeachingStreamingAudioLicenseManifestRefV1?, options: TeachingStreamingAudioMixOptions) throws {
        try require(input.schemaVersion == 1, .unsupportedSchemaVersion(input.schemaVersion))
        try checkCancellation(options)
        try require(isSafeIdentifier(input.sourceRecordingID) && input.sampleRate > 0 && input.sampleRate <= 192_000 && input.channelCount == 1 && input.totalFrames > 0 && input.totalFrames <= 172_800_000)
        let outputParts = input.outputRelativePath.split(separator: "/").map(String.init)
        try require(input.outputRelativePath.hasPrefix("teaching/outputs/") && outputParts.count == 3 && outputParts.allSatisfy(isSafeIdentifier), .invalidOwnedPath)
        try require(input.outputRelativePath.lowercased().hasSuffix(".caf"))
        try require(options.maxChunkFrames > 0 && options.maxChunkFrames <= 4_096, .invalidChunkFrames)
        try require(options.maxSnapshotBytes > 0 && options.maxSnapshotBytes <= hardMaxSnapshotBytes, .snapshotBudgetExceeded)
        try require(input.baseTracks.count <= 2 && input.cues.count <= min(options.maxCues, hardMaxCues), .cueLimitExceeded)
        let kinds = Set(input.baseTracks.map(\.kind)); try require(kinds.count == input.baseTracks.count)
        var cueIDs = Set<String>()
        if input.cues.isEmpty {
            try require(trustedLicenseManifest == nil, .assetIdentityInvalid)
        } else {
            guard let licenseManifest = trustedLicenseManifest else { throw TeachingStreamingAudioError.assetIdentityInvalid }
            try require(licenseManifest.manifestRelativePath.hasPrefix("teaching/licenses/") && licenseManifest.manifestRelativePath.split(separator: "/").count == 3 && licenseManifest.manifestRelativePath.split(separator: "/").allSatisfy { isSafeIdentifier(String($0)) } && licenseManifest.manifestRelativePath.hasSuffix(".json") && isChecksum(licenseManifest.checksum), .assetIdentityInvalid)
        }
        for track in input.baseTracks {
            try checkCancellation(options)
            try require(isChecksum(track.checksum) && track.manifestRelativePath.hasPrefix("audio/") && track.manifestRelativePath.split(separator: "/").allSatisfy { isSafeIdentifier(String($0)) }, .invalidOwnedPath)
        }
        for cue in input.cues {
            try checkCancellation(options)
            try require(isSafeIdentifier(cue.cueID) && cueIDs.insert(cue.cueID).inserted && cue.startFrame >= 0 && cue.endFrame > cue.startFrame && cue.endFrame <= input.totalFrames && cue.fadeInFrames >= 0 && cue.fadeOutFrames >= 0 && cue.gainDb.isFinite && cue.gainCeilingDb.isFinite && cue.gainDb >= -96 && cue.gainDb <= 24 && cue.gainCeilingDb >= -96 && cue.gainCeilingDb <= 0)
            let asset = cue.asset
            try require(isSafeIdentifier(asset.assetID) && isSafeIdentifier(asset.assetVersion) && isSafeIdentifier(asset.licenseCacheIdentity) && isChecksum(asset.checksum), .assetIdentityInvalid)
            try require(asset.cacheRelativePath.hasPrefix("assets-cache/") && asset.cacheRelativePath.split(separator: "/").allSatisfy { isSafeIdentifier(String($0)) }, .invalidOwnedPath)
            try require(cue.fadeInFrames <= input.totalFrames && cue.fadeOutFrames <= input.totalFrames)
            if let duck = cue.ducking { try require(duck.attenuationDb.isFinite && duck.attenuationDb <= 0 && duck.attenuationDb >= -18 && duck.attackFrames >= 0 && duck.attackFrames <= input.totalFrames && duck.releaseFrames >= 0 && duck.releaseFrames <= input.totalFrames) }
        }
        let sorted = input.cues.sorted { $0.startFrame < $1.startFrame }
        var activeEnds: [Int] = []
        for cue in sorted {
            activeEnds.removeAll { $0 <= cue.startFrame }
            activeEnds.append(cue.endFrame + (cue.ducking?.releaseFrames ?? 0))
            try require(activeEnds.count <= hardMaxActiveCues, .cueLimitExceeded)
        }
    }

    private static func isChecksum(_ value: String) -> Bool { value.count == 64 && value.allSatisfy { $0.isHexDigit } }
    fileprivate static func checkCancellation(_ options: TeachingStreamingAudioMixOptions) throws { if options.isCancelled() { throw TeachingStreamingAudioError.cancelled } }

    private static func renderMixedPcm(_ input: TeachingStreamingAudioMixInputV1, directoryFD: Int32, mixedName: String, baseSnapshots: [VerifiedSnapshot], cueSnapshots: [VerifiedSnapshot], options: TeachingStreamingAudioMixOptions) throws -> (peak: Float, decoderOpenCount: Int, maxConcurrentReaders: Int, maxActiveCueCount: Int, cueFrameEvaluations: Int) {
        let outFD = openat(directoryFD, mixedName, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard outFD >= 0 else { throw TeachingStreamingAudioError.outputWriteFailed }
        let out = FileHandle(fileDescriptor: outFD, closeOnDealloc: true); defer { try? out.close() }
        let baseReaders = try baseSnapshots.map { try StreamingAudioReader(snapshot: $0) }
        let cuePool = CueReaderPool(snapshots: cueSnapshots)
        let orderedCueIndexes = input.cues.indices.sorted { input.cues[$0].startFrame < input.cues[$1].startFrame }
        var nextDuckingCue = 0
        var duckingActive: [Int] = []
        var nextSfxCue = 0
        var sfxCandidates: [Int] = []
        var maxActiveCueCount = 0
        var cueFrameEvaluations = 0
        var peak: Float = 0
        var frame = 0
        while frame < input.totalFrames {
            try checkCancellation(options)
            let count = min(options.maxChunkFrames, input.totalFrames - frame)
            let chunkEnd = frame + count
            sfxCandidates.removeAll { input.cues[$0].endFrame <= frame }
            while nextSfxCue < orderedCueIndexes.count, input.cues[orderedCueIndexes[nextSfxCue]].startFrame < chunkEnd {
                sfxCandidates.append(orderedCueIndexes[nextSfxCue]); nextSfxCue += 1
            }
            var mixed = [Float](repeating: 0, count: count)
            for reader in baseReaders {
                let source = try reader.read(offsetFrames: frame, frames: count)
                for index in 0..<count { mixed[index] += source[index] }
            }
            for index in 0..<count {
                let absolute = frame + index
                duckingActive.removeAll { cueIndex in
                    input.cues[cueIndex].endFrame + (input.cues[cueIndex].ducking?.releaseFrames ?? 0) <= absolute
                }
                while nextDuckingCue < orderedCueIndexes.count, input.cues[orderedCueIndexes[nextDuckingCue]].startFrame <= absolute {
                    duckingActive.append(orderedCueIndexes[nextDuckingCue]); nextDuckingCue += 1
                }
                maxActiveCueCount = max(maxActiveCueCount, duckingActive.count)
                guard duckingActive.count <= hardMaxActiveCues else { throw TeachingStreamingAudioError.cueLimitExceeded }
                var duck: Float = 1
                for cueIndex in duckingActive { duck = min(duck, duckGain(input.cues[cueIndex], frame: absolute)); cueFrameEvaluations += 1 }
                mixed[index] *= duck
            }
            for cueIndex in sfxCandidates {
                let cue = input.cues[cueIndex]
                let start = max(frame, cue.startFrame), end = min(frame + count, cue.endFrame)
                guard start < end else { continue }
                let source = try cuePool.read(cueIndex: cueIndex, offsetFrames: start - cue.startFrame, frames: end - start)
                let gain = dbGain(min(0, min(cue.gainDb, cue.gainCeilingDb)))
                for absolute in start..<end {
                    let sourceFrame = absolute - cue.startFrame
                    mixed[absolute - frame] += source[absolute - start] * gain * fadeGain(cue, sourceFrame: sourceFrame)
                }
            }
            for sample in mixed { guard sample.isFinite else { throw TeachingStreamingAudioError.invalidInput }; peak = max(peak, abs(sample)) }
            try out.write(contentsOf: dataFromFloats(mixed))
            frame += count
        }
        try fsyncFile(out)
        return (peak, baseReaders.count + cuePool.totalOpens, baseReaders.count + cuePool.maxConcurrent, maxActiveCueCount, cueFrameEvaluations)
    }

    private static func duckGain(_ cue: TeachingStreamingAudioCueV1, frame: Int) -> Float {
        guard let duck = cue.ducking else { return 1 }
        let attenuated = dbGain(duck.attenuationDb)
        if frame >= cue.startFrame && frame < cue.endFrame {
            let elapsed = frame - cue.startFrame
            let attack: Float = duck.attackFrames == 0 ? 1 : min(1, Float(elapsed + 1) / Float(duck.attackFrames))
            return 1 - (1 - attenuated) * attack
        }
        if frame >= cue.endFrame && frame < cue.endFrame + duck.releaseFrames {
            let reached: Float = duck.attackFrames == 0 ? 1 : min(1, Float(cue.endFrame - cue.startFrame) / Float(duck.attackFrames))
            let atEnd = 1 - (1 - attenuated) * reached
            return atEnd + (1 - atEnd) * Float(frame - cue.endFrame + 1) / Float(duck.releaseFrames)
        }
        return 1
    }

    private static func fadeGain(_ cue: TeachingStreamingAudioCueV1, sourceFrame: Int) -> Float {
        let duration = cue.endFrame - cue.startFrame
        let fadeIn: Float = cue.fadeInFrames == 0 ? 1 : min(1, Float(sourceFrame + 1) / Float(cue.fadeInFrames))
        let remaining = duration - sourceFrame
        let fadeOut: Float = cue.fadeOutFrames == 0 ? 1 : min(1, Float(remaining) / Float(cue.fadeOutFrames))
        return min(fadeIn, fadeOut)
    }

    private static func encodeCaf(directoryFD: Int32, mixedName: String, stagingName: String, sampleRate: Int, channelCount: Int, frames: Int, finalGain: Float, options: TeachingStreamingAudioMixOptions) throws {
        let inputFD = openat(directoryFD, mixedName, O_RDONLY | O_NOFOLLOW)
        let outputFD = openat(directoryFD, stagingName, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard inputFD >= 0, outputFD >= 0 else { if inputFD >= 0 { close(inputFD) }; if outputFD >= 0 { close(outputFD) }; throw TeachingStreamingAudioError.outputWriteFailed }
        let input = FileHandle(fileDescriptor: inputFD, closeOnDealloc: true); defer { try? input.close() }
        let output = FileHandle(fileDescriptor: outputFD, closeOnDealloc: true); defer { try? output.close() }
        let bytes = frames * channelCount * MemoryLayout<Float>.size
        // AudioToolbox describes the encoded PCM format; CAF is directly streamable.
        let format = AudioStreamBasicDescription(mSampleRate: Float64(sampleRate), mFormatID: kAudioFormatLinearPCM, mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked, mBytesPerPacket: UInt32(MemoryLayout<Float>.size * channelCount), mFramesPerPacket: 1, mBytesPerFrame: UInt32(MemoryLayout<Float>.size * channelCount), mChannelsPerFrame: UInt32(channelCount), mBitsPerChannel: 32, mReserved: 0)
        _ = format.mFormatID
        try output.write(contentsOf: cafHeader(sampleRate: sampleRate, channelCount: channelCount, dataBytes: bytes))
        var remaining = frames
        while remaining > 0 {
            try checkCancellation(options)
            let count = min(options.maxChunkFrames, remaining)
            let data = try input.read(upToCount: count * MemoryLayout<Float>.size) ?? Data()
            guard data.count == count * MemoryLayout<Float>.size else { throw TeachingStreamingAudioError.sourceFrameCountMismatch }
            var values = floatFromData(data)
            for index in values.indices { values[index] *= finalGain }
            try output.write(contentsOf: dataFromFloats(values))
            remaining -= count
        }
        try fsyncFile(output)
    }
}
