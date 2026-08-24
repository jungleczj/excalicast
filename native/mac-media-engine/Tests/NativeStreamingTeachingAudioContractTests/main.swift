import CryptoKit
import AVFoundation
import Foundation
import MacMediaEngineTeachingAudio

private enum TestFailure: Error { case expectation(String) }

private final class CancellationCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var checks = 0
    private let cancelAfter: Int
    init(cancelAfter: Int = 2) { self.cancelAfter = cancelAfter }
    func shouldCancel() -> Bool {
        lock.lock(); defer { lock.unlock() }
        checks += 1
        return checks > cancelAfter
    }
    var count: Int { lock.lock(); defer { lock.unlock() }; return checks }
}

private final class ConcurrentMixResults: @unchecked Sendable {
    private let lock = NSLock()
    private var outputs: [TeachingStreamingAudioMixOutputV1] = []
    private var errors: [TeachingStreamingAudioError] = []
    func record(_ result: Result<TeachingStreamingAudioMixOutputV1, Error>) {
        lock.lock(); defer { lock.unlock() }
        switch result {
        case let .success(output): outputs.append(output)
        case let .failure(error):
            if let typed = error as? TeachingStreamingAudioError { errors.append(typed) }
        }
    }
    var snapshot: (outputs: [TeachingStreamingAudioMixOutputV1], errors: [TeachingStreamingAudioError]) {
        lock.lock(); defer { lock.unlock() }; return (outputs, errors)
    }
}

private final class DirectorySwap: @unchecked Sendable {
    private let lock = NSLock()
    private var performed = false
    let teaching: URL
    let outside: URL
    init(teaching: URL, outside: URL) { self.teaching = teaching; self.outside = outside }
    func perform() {
        lock.lock(); defer { lock.unlock() }
        guard !performed else { return }; performed = true
        let outputs = teaching.appendingPathComponent("outputs")
        let held = teaching.appendingPathComponent("outputs-held")
        try! FileManager.default.moveItem(at: outputs, to: held)
        try! FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try! FileManager.default.createSymbolicLink(at: outputs, withDestinationURL: outside)
    }
    func restore() throws {
        let outputs = teaching.appendingPathComponent("outputs")
        try FileManager.default.removeItem(at: outputs)
        try FileManager.default.moveItem(at: teaching.appendingPathComponent("outputs-held"), to: outputs)
    }
}

private final class CancellationFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    func cancel() { lock.lock(); value = true; lock.unlock() }
    func isCancelled() -> Bool { lock.lock(); defer { lock.unlock() }; return value }
}

private final class IntegerProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Int?
    func record(_ value: Int) { lock.lock(); stored = value; lock.unlock() }
    var value: Int? { lock.lock(); defer { lock.unlock() }; return stored }
}

private func currentOpenFDCount() -> Int {
    (try? FileManager.default.contentsOfDirectory(atPath: "/dev/fd").count) ?? Int.max
}

private final class HeldFileLock: @unchecked Sendable {
    private let stateLock = NSLock()
    private var fd: Int32
    init(url: URL) throws {
        fd = open(url.path, O_RDWR | O_CREAT | O_NOFOLLOW, 0o600)
        guard fd >= 0, flock(fd, LOCK_EX) == 0 else {
            if fd >= 0 { close(fd) }
            throw TestFailure.expectation("test lock must be acquirable")
        }
    }
    func release() {
        stateLock.lock(); defer { stateLock.unlock() }
        guard fd >= 0 else { return }
        _ = flock(fd, LOCK_UN)
        close(fd)
        fd = -1
    }
    deinit { release() }
}

private final class SnapshotTamper: @unchecked Sendable {
    enum Mode { case replaceEntry(URL), overwriteSameInode }
    private let workDirectory: URL
    private let mode: Mode
    private(set) var didTamper = false

    init(root: URL, outputRelativePath: String, mode: Mode) {
        workDirectory = root
            .appendingPathComponent("teaching/outputs")
            .appendingPathComponent(".teaching-audio-work-\(sha256Text(outputRelativePath))")
        self.mode = mode
    }

    func perform() {
        let candidates = try! FileManager.default.contentsOfDirectory(at: workDirectory, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.contains(".source-") && $0.pathExtension == "caf" }
        guard let snapshot = candidates.first else { return }
        switch mode {
        case let .replaceEntry(replacement):
            _ = try! FileManager.default.replaceItemAt(snapshot, withItemAt: replacement)
        case .overwriteSameInode:
            let handle = try! FileHandle(forWritingTo: snapshot)
            try! handle.seek(toOffset: 72)
            try! handle.write(contentsOf: Data(repeating: 0x7f, count: 32))
            try! handle.synchronize()
            try! handle.close()
        }
        didTamper = true
    }
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    guard try condition() else { throw TestFailure.expectation(message) }
}

private func sha256(_ url: URL) throws -> String {
    SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined()
}

private func sha256Text(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
}

private func writeAudioFixture(_ samples: [Float], to url: URL) throws -> String {
    let format = AVAudioFormat(standardFormatWithSampleRate: 8_000, channels: 1)!
    do {
        let file = try AVAudioFile(forWriting: url, settings: format.settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count))!
        buffer.frameLength = AVAudioFrameCount(samples.count)
        for index in samples.indices { buffer.floatChannelData![0][index] = samples[index] }
        try file.write(from: buffer)
    }
    return try sha256(url)
}

private func writeStereoAudioFixture(left: [Float], right: [Float], to url: URL) throws -> String {
    guard left.count == right.count else { throw TestFailure.expectation("stereo fixture channels must have equal lengths") }
    let format = AVAudioFormat(standardFormatWithSampleRate: 8_000, channels: 2)!
    let fileFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 8_000, channels: 2, interleaved: true)!
    do {
        let file = try AVAudioFile(forWriting: url, settings: fileFormat.settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(left.count))!
        buffer.frameLength = AVAudioFrameCount(left.count)
        for index in left.indices {
            buffer.floatChannelData![0][index] = left[index]
            buffer.floatChannelData![1][index] = right[index]
        }
        try file.write(from: buffer)
    }
    return try sha256(url)
}

private func decodeCafSamples(_ url: URL) throws -> [Float] {
    let file = try AVAudioFile(forReading: url)
    let format = file.processingFormat
    guard format.sampleRate == 8_000, format.channelCount == 1 else { throw TestFailure.expectation("CAF is readable by AVFoundation") }
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length))!
    try file.read(into: buffer)
    return Array(UnsafeBufferPointer(start: buffer.floatChannelData![0], count: Int(buffer.frameLength)))
}

@main
struct NativeStreamingTeachingAudioContractTests {
    static func main() throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("native-streaming-sfx-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root.appendingPathComponent("audio"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("assets-cache"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("teaching/outputs"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("teaching/licenses"), withIntermediateDirectories: true)

        let micURL = root.appendingPathComponent("audio/mic.caf")
        let systemURL = root.appendingPathComponent("audio/system.caf")
        let sfxURL = root.appendingPathComponent("assets-cache/click.caf")
        let micChecksum = try writeAudioFixture([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], to: micURL)
        let systemChecksum = try writeAudioFixture([0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25], to: systemURL)
        let sfxChecksum = try writeAudioFixture([1, 1, 1, 1], to: sfxURL)
        let licenseBinding = TeachingStreamingAudioLicenseBindingV1(assetID: "click", assetVersion: "1", checksum: sfxChecksum, licenseCacheIdentity: "license-v1")
        let licenseManifestURL = root.appendingPathComponent("teaching/licenses/catalog.json")
        let manifestEncoder = JSONEncoder(); manifestEncoder.outputFormatting = [.sortedKeys]
        try manifestEncoder.encode(TeachingStreamingAudioLicenseManifestV1(schemaVersion: 1, bindings: [licenseBinding])).write(to: licenseManifestURL, options: .atomic)
        let licenseManifest = TeachingStreamingAudioLicenseManifestRefV1(manifestRelativePath: "teaching/licenses/catalog.json", checksum: try sha256(licenseManifestURL))

        let input = TeachingStreamingAudioMixInputV1(
            schemaVersion: 1,
            sourceRecordingID: "lesson-001",
            sampleRate: 8_000,
            channelCount: 1,
            totalFrames: 8,
            outputRelativePath: "teaching/outputs/main-lesson.caf",
            baseTracks: [
                .init(kind: .microphone, manifestRelativePath: "audio/mic.caf", checksum: micChecksum),
                .init(kind: .systemAudio, manifestRelativePath: "audio/system.caf", checksum: systemChecksum),
            ],
            cues: [
                .init(cueID: "click-1", asset: .init(assetID: "click", assetVersion: "1", checksum: sfxChecksum, cacheRelativePath: "assets-cache/click.caf", licenseCacheIdentity: "license-v1"), startFrame: 2, endFrame: 6, gainDb: 0, gainCeilingDb: 0, fadeInFrames: 0, fadeOutFrames: 0, ducking: .init(attenuationDb: -6, attackFrames: 0, releaseFrames: 2)),
            ]
        )
        let first = try TeachingStreamingAudioMixer.mix(input, projectRoot: root, trustedLicenseManifest: licenseManifest)
        try expect(first.normalizationPasses == 1, "mix normalizes exactly once")
        try expect(first.maxChunkFrames <= 4_096, "mix reports bounded chunks")
        try expect(first.decoderOpenCount == 3, "each source opens once for the complete stream, not once per chunk")
        try expect(first.maxConcurrentReaders <= 10, "base and active cue decoder FDs have a fixed hard bound")
        try expect(first.maxActiveCueCount <= 8, "active cue sweep has a fixed overlap bound")
        try expect(first.cueFrameEvaluations <= 32, "cue work is proportional to active cues, not total cues per sample")
        try expect(first.durationFrames == 8, "duration is manifest controlled")
        let samples = try decodeCafSamples(root.appendingPathComponent(first.outputRelativePath))
        try expect(samples.count == 8, "streamed CAF has all frames")
        let baseline = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "lesson-baseline", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/baseline.caf", baseTracks: input.baseTracks, cues: [])
        let baselineOutput = try TeachingStreamingAudioMixer.mix(baseline, projectRoot: root)
        let baselineSamples = try decodeCafSamples(root.appendingPathComponent(baselineOutput.outputRelativePath))
        try expect(samples[0] < baselineSamples[0], "final normalization occurs after the full mix")
        try expect(samples[2] > samples[0], "effect remains mixed over ducked base")
        try expect(samples.map(abs).max()! <= 0.8914, "single final anti-clipping pass applies target peak")

        let stereoSystemURL = root.appendingPathComponent("audio/system-stereo.caf")
        let stereoSystemChecksum = try writeStereoAudioFixture(
            left: [Float](repeating: 0.4, count: 8),
            right: [Float](repeating: -0.4, count: 8),
            to: stereoSystemURL
        )
        let microphoneOnly = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "microphone-only", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/microphone-only.caf", baseTracks: [.init(kind: .microphone, manifestRelativePath: "audio/mic.caf", checksum: micChecksum)], cues: [])
        let microphoneOnlyOutput = try TeachingStreamingAudioMixer.mix(microphoneOnly, projectRoot: root)
        let microphoneOnlySamples = try decodeCafSamples(root.appendingPathComponent(microphoneOnlyOutput.outputRelativePath))
        let stereoSystemMix = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "stereo-system-mix", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/stereo-system-mix.caf", baseTracks: [
            .init(kind: .microphone, manifestRelativePath: "audio/mic.caf", checksum: micChecksum),
            .init(kind: .systemAudio, manifestRelativePath: "audio/system-stereo.caf", checksum: stereoSystemChecksum),
        ], cues: [])
        let stereoSystemOutput = try TeachingStreamingAudioMixer.mix(stereoSystemMix, projectRoot: root)
        let stereoSystemSamples = try decodeCafSamples(root.appendingPathComponent(stereoSystemOutput.outputRelativePath))
        try expect(zip(stereoSystemSamples, microphoneOnlySamples).allSatisfy { abs($0 - $1) < 0.000_01 }, "stereo system audio is deterministically averaged to mono before mixing with the mono microphone")

        let firstInode = try FileManager.default.attributesOfItem(atPath: root.appendingPathComponent(first.outputRelativePath).path)[.systemFileNumber] as? NSNumber
        let repeated = try TeachingStreamingAudioMixer.mix(input, projectRoot: root, trustedLicenseManifest: licenseManifest)
        let repeatedInode = try FileManager.default.attributesOfItem(atPath: root.appendingPathComponent(first.outputRelativePath).path)[.systemFileNumber] as? NSNumber
        try expect(repeated.inputChecksum == first.inputChecksum, "identical input has identical identity")
        try expect(firstInode == repeatedInode, "identical completed output is idempotent")

        let parallelInput = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "parallel-same", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/parallel-same.caf", baseTracks: [], cues: [])
        let sameResults = ConcurrentMixResults()
        DispatchQueue.concurrentPerform(iterations: 2) { _ in
            sameResults.record(Result { try TeachingStreamingAudioMixer.mix(parallelInput, projectRoot: root) })
        }
        let sameSnapshot = sameResults.snapshot
        try expect(sameSnapshot.outputs.count == 2 && sameSnapshot.errors.isEmpty, "same immutable input serializes and idempotently shares one publication")
        try expect(Set(sameSnapshot.outputs.map(\.checksum)).count == 1, "same concurrent input observes identical bytes")

        let competingA = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "parallel-a", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/parallel-different.caf", baseTracks: [], cues: [])
        let competingB = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "parallel-b", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/parallel-different.caf", baseTracks: [], cues: [])
        let differentResults = ConcurrentMixResults()
        DispatchQueue.concurrentPerform(iterations: 2) { index in
            let selected = index == 0 ? competingA : competingB
            differentResults.record(Result { try TeachingStreamingAudioMixer.mix(selected, projectRoot: root) })
        }
        let differentSnapshot = differentResults.snapshot
        try expect(differentSnapshot.outputs.count == 1 && differentSnapshot.errors == [.outputIdentityConflict], "different inputs cannot race to overwrite one output identity")

        let holderInput = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "lock-holder", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/cancellable-process-lock.caf", baseTracks: [], cues: [])
        let holderEntered = DispatchSemaphore(value: 0)
        let releaseHolder = DispatchSemaphore(value: 0)
        let holderFinished = DispatchGroup()
        let holderResults = ConcurrentMixResults()
        holderFinished.enter()
        DispatchQueue.global().async {
            defer { holderFinished.leave() }
            holderResults.record(Result {
                try TeachingStreamingAudioMixer.mix(holderInput, projectRoot: root, options: .init(afterSnapshotsVerified: {
                    holderEntered.signal()
                    releaseHolder.wait()
                }))
            })
        }
        try expect(holderEntered.wait(timeout: .now() + 2) == .success, "holder reaches the in-process critical section")
        DispatchQueue.global().asyncAfter(deadline: .now() + 1) { releaseHolder.signal() }
        let processWaitCancellation = CancellationFlag()
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.05) { processWaitCancellation.cancel() }
        let processWaitStarted = Date()
        do {
            let waiter = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "lock-waiter", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: holderInput.outputRelativePath, baseTracks: [], cues: [])
            _ = try TeachingStreamingAudioMixer.mix(waiter, projectRoot: root, options: .init(isCancelled: { processWaitCancellation.isCancelled() }))
            throw TestFailure.expectation("cancelled duplicate must not enter the in-process critical section")
        } catch TeachingStreamingAudioError.cancelled { }
        let processWaitDuration = Date().timeIntervalSince(processWaitStarted)
        releaseHolder.signal()
        try expect(holderFinished.wait(timeout: .now() + 2) == .success, "cancelling a duplicate does not affect the holder")
        try expect(processWaitDuration < 0.5, "in-process lock wait is cancellation responsive")
        try expect(holderResults.snapshot.outputs.count == 1 && holderResults.snapshot.errors.isEmpty, "holder publishes successfully after duplicate cancellation")

        let fileLockPath = "teaching/outputs/cancellable-file-lock.caf"
        let heldFileLock = try HeldFileLock(url: root.appendingPathComponent("teaching/outputs/.\(sha256Text(fileLockPath)).lock"))
        DispatchQueue.global().asyncAfter(deadline: .now() + 1) { heldFileLock.release() }
        let fileWaitCancellation = CancellationFlag()
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.05) { fileWaitCancellation.cancel() }
        let fileWaitStarted = Date()
        do {
            let waiter = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "file-lock-waiter", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: fileLockPath, baseTracks: [], cues: [])
            _ = try TeachingStreamingAudioMixer.mix(waiter, projectRoot: root, options: .init(isCancelled: { fileWaitCancellation.isCancelled() }))
            throw TestFailure.expectation("cancelled job must not wait for the cross-process file lock")
        } catch TeachingStreamingAudioError.cancelled { }
        let fileWaitDuration = Date().timeIntervalSince(fileWaitStarted)
        heldFileLock.release()
        try expect(fileWaitDuration < 0.5, "flock wait is cancellation responsive")

        let prefixA = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "prefix-a", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/lesson.caf", baseTracks: [], cues: [])
        let prefixB = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "prefix-b", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/lesson.caf.part.caf", baseTracks: [], cues: [])
        let prefixResults = ConcurrentMixResults()
        DispatchQueue.concurrentPerform(iterations: 2) { index in
            prefixResults.record(Result { try TeachingStreamingAudioMixer.mix(index == 0 ? prefixA : prefixB, projectRoot: root) })
        }
        try expect(prefixResults.snapshot.outputs.count == 2 && prefixResults.snapshot.errors.isEmpty, "full output-path hashes prevent prefix-colliding orphan namespaces")

        let pure = TeachingStreamingAudioMixInputV1(
            schemaVersion: 1, sourceRecordingID: "lesson-pure", sampleRate: 8_000, channelCount: 1, totalFrames: 4,
            outputRelativePath: "teaching/outputs/pure.caf", baseTracks: [],
            cues: [.init(cueID: "pure-sfx", asset: .init(assetID: "click", assetVersion: "1", checksum: sfxChecksum, cacheRelativePath: "assets-cache/click.caf", licenseCacheIdentity: "license-v1"), startFrame: 0, endFrame: 4, gainDb: 0, gainCeilingDb: 0, fadeInFrames: 0, fadeOutFrames: 0, ducking: nil)]
        )
        let pureOutput = try TeachingStreamingAudioMixer.mix(pure, projectRoot: root, trustedLicenseManifest: licenseManifest)
        try expect(try decodeCafSamples(root.appendingPathComponent(pureOutput.outputRelativePath)).allSatisfy { $0 > 0 }, "pure SFX has no required base track")

        let overlap = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "lesson-overlap", sampleRate: 8_000, channelCount: 1, totalFrames: 6, outputRelativePath: "teaching/outputs/overlap.caf", baseTracks: [], cues: [
            .init(cueID: "first", asset: .init(assetID: "click", assetVersion: "1", checksum: sfxChecksum, cacheRelativePath: "assets-cache/click.caf", licenseCacheIdentity: "license-v1"), startFrame: 1, endFrame: 5, gainDb: 0, gainCeilingDb: 0, fadeInFrames: 0, fadeOutFrames: 2, ducking: nil),
            .init(cueID: "second", asset: .init(assetID: "click", assetVersion: "1", checksum: sfxChecksum, cacheRelativePath: "assets-cache/click.caf", licenseCacheIdentity: "license-v1"), startFrame: 2, endFrame: 6, gainDb: 0, gainCeilingDb: 0, fadeInFrames: 2, fadeOutFrames: 0, ducking: nil),
        ])
        let overlapOutput = try TeachingStreamingAudioMixer.mix(overlap, projectRoot: root, trustedLicenseManifest: licenseManifest)
        let overlapSamples = try decodeCafSamples(root.appendingPathComponent(overlapOutput.outputRelativePath))
        try expect(overlapSamples[2] > overlapSamples[1], "overlapping SFX sum while fade-in is active")
        try expect(overlapSamples[4] < overlapSamples[3], "fade-out is applied before final normalization")

        do {
            _ = try TeachingStreamingAudioMixer.mix(input, projectRoot: root, options: .init(maxChunkFrames: 4_097))
            throw TestFailure.expectation("chunk limits must reject unsafe allocation")
        } catch TeachingStreamingAudioError.invalidChunkFrames { }

        let tooManyCues = (0...256).map { index in
            TeachingStreamingAudioCueV1(cueID: "cue-\(index)", asset: input.cues[0].asset, startFrame: 0, endFrame: 1, gainDb: 0, gainCeilingDb: 0, fadeInFrames: 0, fadeOutFrames: 0, ducking: nil)
        }
        let expandedLimit = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "expanded-limit", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/expanded-limit.caf", baseTracks: [], cues: tooManyCues)
        do {
            _ = try TeachingStreamingAudioMixer.mix(expandedLimit, projectRoot: root, trustedLicenseManifest: licenseManifest, options: .init(maxCues: 10_000))
            throw TestFailure.expectation("callers cannot expand the hard cue cap")
        } catch TeachingStreamingAudioError.cueLimitExceeded { }

        let boundedCues = (0..<256).map { index in
            TeachingStreamingAudioCueV1(cueID: "bounded-\(index)", asset: input.cues[0].asset, startFrame: index, endFrame: index + 1, gainDb: -12, gainCeilingDb: 0, fadeInFrames: 0, fadeOutFrames: 0, ducking: nil)
        }
        let boundedCueInput = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "bounded-cues", sampleRate: 8_000, channelCount: 1, totalFrames: 256, outputRelativePath: "teaching/outputs/bounded-cues.caf", baseTracks: [], cues: boundedCues)
        let boundedCueOutput = try TeachingStreamingAudioMixer.mix(boundedCueInput, projectRoot: root, trustedLicenseManifest: licenseManifest, options: .init(maxCues: 10_000))
        try expect(boundedCueOutput.maxActiveCueCount == 1, "event sweep tracks real overlap rather than all cues in a chunk")
        try expect(boundedCueOutput.maxConcurrentReaders <= 8 && boundedCueOutput.decoderOpenCount == 256, "cue decoder LRU keeps FDs hard bounded while processing the full cue cap")
        try expect(boundedCueOutput.cueFrameEvaluations == 256, "per-frame cue work is linear in active overlap")

        var distinctBindings: [TeachingStreamingAudioLicenseBindingV1] = []
        var distinctCues: [TeachingStreamingAudioCueV1] = []
        for index in 0..<256 {
            let assetID = "distinct-\(index)"
            let relativePath = "assets-cache/\(assetID).caf"
            let checksum = try writeAudioFixture([Float(index + 1) / 1_024], to: root.appendingPathComponent(relativePath))
            let binding = TeachingStreamingAudioLicenseBindingV1(assetID: assetID, assetVersion: "1", checksum: checksum, licenseCacheIdentity: "license-distinct")
            distinctBindings.append(binding)
            distinctCues.append(.init(cueID: "distinct-cue-\(index)", asset: .init(assetID: assetID, assetVersion: "1", checksum: checksum, cacheRelativePath: relativePath, licenseCacheIdentity: "license-distinct"), startFrame: index, endFrame: index + 1, gainDb: 0, gainCeilingDb: 0, fadeInFrames: 0, fadeOutFrames: 0, ducking: nil))
        }
        let distinctManifestURL = root.appendingPathComponent("teaching/licenses/distinct.json")
        try manifestEncoder.encode(TeachingStreamingAudioLicenseManifestV1(schemaVersion: 1, bindings: distinctBindings)).write(to: distinctManifestURL, options: .atomic)
        let distinctManifest = TeachingStreamingAudioLicenseManifestRefV1(manifestRelativePath: "teaching/licenses/distinct.json", checksum: try sha256(distinctManifestURL))
        let distinct128Input = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "distinct-assets-128", sampleRate: 8_000, channelCount: 1, totalFrames: 128, outputRelativePath: "teaching/outputs/distinct-assets-128.caf", baseTracks: [], cues: Array(distinctCues.prefix(128)))
        let distinct128Output = try TeachingStreamingAudioMixer.mix(distinct128Input, projectRoot: root, trustedLicenseManifest: distinctManifest)
        try expect(distinct128Output.durationFrames == 128 && distinct128Output.decoderOpenCount == 128 && distinct128Output.maxConcurrentReaders <= 8, "the default public cue limit supports 128 distinct sequential assets with bounded readers")
        let distinctInput = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "distinct-assets", sampleRate: 8_000, channelCount: 1, totalFrames: 256, outputRelativePath: "teaching/outputs/distinct-assets.caf", baseTracks: [], cues: distinctCues)
        let fdBaseline = currentOpenFDCount()
        let snapshotFDProbe = IntegerProbe()
        let distinctOutput = try TeachingStreamingAudioMixer.mix(distinctInput, projectRoot: root, trustedLicenseManifest: distinctManifest, options: .init(maxCues: 256, afterSnapshotsVerified: { snapshotFDProbe.record(currentOpenFDCount()) }))
        try expect(distinctOutput.durationFrames == 256 && distinctOutput.decoderOpenCount == 256, "all 256 public cue identities can use distinct sequential assets")
        try expect(distinctOutput.maxConcurrentReaders <= 8 && distinctOutput.maxActiveCueCount == 1, "256 distinct assets retain the documented FD and overlap bounds")
        try expect(snapshotFDProbe.value != nil && snapshotFDProbe.value! <= fdBaseline + 16, "256 verified snapshots do not retain one file descriptor per asset")
        let budgetedInput = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "snapshot-budget", sampleRate: 8_000, channelCount: 1, totalFrames: 4, outputRelativePath: "teaching/outputs/snapshot-budget.caf", baseTracks: [], cues: pure.cues)
        do {
            _ = try TeachingStreamingAudioMixer.mix(budgetedInput, projectRoot: root, trustedLicenseManifest: licenseManifest, options: .init(maxSnapshotBytes: 1))
            throw TestFailure.expectation("snapshot staging must obey the public aggregate byte budget")
        } catch TeachingStreamingAudioError.snapshotBudgetExceeded { }
        try expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent(budgetedInput.outputRelativePath).path), "snapshot budget failure never publishes")

        let forgedAsset = TeachingStreamingAudioAssetRefV1(assetID: "click", assetVersion: "1", checksum: sfxChecksum, cacheRelativePath: "assets-cache/click.caf", licenseCacheIdentity: "forged-license")
        let forgedCue = TeachingStreamingAudioCueV1(cueID: "forged", asset: forgedAsset, startFrame: 0, endFrame: 4, gainDb: 0, gainCeilingDb: 0, fadeInFrames: 0, fadeOutFrames: 0, ducking: nil)
        let invalidLicense = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "invalid-license", sampleRate: 8_000, channelCount: 1, totalFrames: 4, outputRelativePath: "teaching/outputs/invalid-license.caf", baseTracks: [], cues: [forgedCue])
        do {
            _ = try TeachingStreamingAudioMixer.mix(invalidLicense, projectRoot: root, trustedLicenseManifest: licenseManifest)
            throw TestFailure.expectation("asset tuple must have an authoritative exact license binding")
        } catch TeachingStreamingAudioError.assetIdentityInvalid { }
        do {
            _ = try TeachingStreamingAudioMixer.mix(pure, projectRoot: root)
            throw TestFailure.expectation("cue request cannot self-authorize without a separately supplied trusted manifest")
        } catch TeachingStreamingAudioError.assetIdentityInvalid { }
        let requestOwnedManifest = TeachingStreamingAudioLicenseManifestRefV1(manifestRelativePath: "assets-cache/request-owned.json", checksum: licenseManifest.checksum)
        do {
            _ = try TeachingStreamingAudioMixer.mix(pure, projectRoot: root, trustedLicenseManifest: requestOwnedManifest)
            throw TestFailure.expectation("trusted license authority is confined to the main-owned manifest namespace")
        } catch TeachingStreamingAudioError.assetIdentityInvalid { }

        let wrongNamespace = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "wrong-namespace", sampleRate: 8_000, channelCount: 1, totalFrames: 1, outputRelativePath: "audio/wrong.caf", baseTracks: [], cues: [])
        do {
            _ = try TeachingStreamingAudioMixer.mix(wrongNamespace, projectRoot: root)
            throw TestFailure.expectation("outputs are confined to teaching/outputs")
        } catch TeachingStreamingAudioError.invalidOwnedPath { }

        let plan = try TeachingStreamingAudioMixer.streamingPlan(totalFrames: 172_800_000, maxChunkFrames: 4_096)
        try expect(plan.maxResidentFrames == 4_096 && plan.chunkCount == 42_188, "60-minute planning never scales resident PCM with duration")

        let corrupt = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "bad-checksum", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/bad.caf", baseTracks: [.init(kind: .microphone, manifestRelativePath: "audio/mic.caf", checksum: String(repeating: "0", count: 64))], cues: [])
        do {
            _ = try TeachingStreamingAudioMixer.mix(corrupt, projectRoot: root)
            throw TestFailure.expectation("checksum mismatch must fail closed")
        } catch TeachingStreamingAudioError.checksumMismatch { }

        let linkURL = root.appendingPathComponent("audio/link.caf")
        try FileManager.default.createSymbolicLink(at: linkURL, withDestinationURL: micURL)
        let symlinked = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "symlink", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/link.caf", baseTracks: [.init(kind: .microphone, manifestRelativePath: "audio/link.caf", checksum: micChecksum)], cues: [])
        do {
            _ = try TeachingStreamingAudioMixer.mix(symlinked, projectRoot: root)
            throw TestFailure.expectation("symbolic links must fail closed")
        } catch TeachingStreamingAudioError.symlinkedOwnedPath { }

        let heldCache = root.appendingPathComponent("assets-cache-held")
        try FileManager.default.moveItem(at: root.appendingPathComponent("assets-cache"), to: heldCache)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("assets-cache"), withDestinationURL: heldCache)
        do {
            _ = try TeachingStreamingAudioMixer.mix(TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "cache-dir-swap", sampleRate: 8_000, channelCount: 1, totalFrames: 4, outputRelativePath: "teaching/outputs/cache-dir-swap.caf", baseTracks: [], cues: pure.cues), projectRoot: root, trustedLicenseManifest: licenseManifest)
            throw TestFailure.expectation("intermediate cache directory symlink must fail closed")
        } catch TeachingStreamingAudioError.invalidOwnedPath { }
        try FileManager.default.removeItem(at: root.appendingPathComponent("assets-cache"))
        try FileManager.default.moveItem(at: heldCache, to: root.appendingPathComponent("assets-cache"))

        let cancellationCounter = CancellationCounter()
        let cancelledOutput = TeachingStreamingAudioMixInputV1(
            schemaVersion: 1, sourceRecordingID: "lesson-cancel", sampleRate: 8_000, channelCount: 1, totalFrames: 8,
            outputRelativePath: "teaching/outputs/cancel.caf", baseTracks: [], cues: []
        )
        do {
            _ = try TeachingStreamingAudioMixer.mix(cancelledOutput, projectRoot: root, options: .init(isCancelled: { cancellationCounter.shouldCancel() }))
            throw TestFailure.expectation("cancelled mix must not publish an output")
        } catch TeachingStreamingAudioError.cancelled { }
        try expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent("teaching/outputs/cancel.caf").path), "cancel preserves old output")

        let hashURL = root.appendingPathComponent("audio/hash-source.caf")
        let hashChecksum = try writeAudioFixture([Float](repeating: 0.1, count: 20_000), to: hashURL)
        let hashCounter = CancellationCounter(cancelAfter: 5)
        let cancelHash = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "cancel-hash", sampleRate: 8_000, channelCount: 1, totalFrames: 20_000, outputRelativePath: "teaching/outputs/cancel-hash.caf", baseTracks: [.init(kind: .microphone, manifestRelativePath: "audio/hash-source.caf", checksum: hashChecksum)], cues: [])
        do {
            _ = try TeachingStreamingAudioMixer.mix(cancelHash, projectRoot: root, options: .init(isCancelled: { hashCounter.shouldCancel() }))
            throw TestFailure.expectation("hash and immutable snapshot copying are cancellable")
        } catch TeachingStreamingAudioError.cancelled { }
        try expect(hashCounter.count == 6, "cancellation occurred inside the bounded source snapshot loop")
        try expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent("teaching/outputs/cancel-hash.caf").path), "cancelled source snapshot never publishes")
        let cancelledWork = root.appendingPathComponent("teaching/outputs/.teaching-audio-work-\(sha256Text(cancelHash.outputRelativePath))")
        try expect(try FileManager.default.contentsOfDirectory(atPath: cancelledWork.path).isEmpty, "cancelled snapshot creation immediately removes large partial clones/copies")

        let replacementURL = root.appendingPathComponent("replacement-source.caf")
        _ = try writeAudioFixture([Float](repeating: -0.75, count: 8), to: replacementURL)
        let replaceInput = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "snapshot-entry-replace", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/snapshot-entry-replace.caf", baseTracks: [.init(kind: .microphone, manifestRelativePath: "audio/mic.caf", checksum: micChecksum)], cues: [])
        let entryReplacement = SnapshotTamper(root: root, outputRelativePath: replaceInput.outputRelativePath, mode: .replaceEntry(replacementURL))
        do {
            let replaced = try TeachingStreamingAudioMixer.mix(replaceInput, projectRoot: root, options: .init(afterSnapshotsVerified: { entryReplacement.perform() }))
            let replacedSamples = try decodeCafSamples(root.appendingPathComponent(replaced.outputRelativePath))
            try expect(replacedSamples.allSatisfy { $0 > 0 }, "decoder remains bound to the verified FD when the snapshot directory entry is replaced")
        } catch {
            try expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent(replaceInput.outputRelativePath).path), "entry replacement fails closed without publishing attacker bytes")
        }
        try expect(entryReplacement.didTamper, "entry replacement test reached the verified snapshot boundary")

        let sameInodeInput = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "snapshot-same-inode", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/snapshot-same-inode.caf", baseTracks: [.init(kind: .microphone, manifestRelativePath: "audio/mic.caf", checksum: micChecksum)], cues: [])
        let sameInodeTamper = SnapshotTamper(root: root, outputRelativePath: sameInodeInput.outputRelativePath, mode: .overwriteSameInode)
        do {
            _ = try TeachingStreamingAudioMixer.mix(sameInodeInput, projectRoot: root, options: .init(afterSnapshotsVerified: { sameInodeTamper.perform() }))
            throw TestFailure.expectation("same-inode modification after verification must be detected")
        } catch TeachingStreamingAudioError.checksumMismatch { }
        try expect(sameInodeTamper.didTamper, "same-inode test modified the retained verified snapshot")
        try expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent(sameInodeInput.outputRelativePath).path), "same-inode modification cannot publish")

        let renderRaceInput = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "snapshot-render-race", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/snapshot-render-race.caf", baseTracks: [.init(kind: .microphone, manifestRelativePath: "audio/mic.caf", checksum: micChecksum)], cues: [])
        let renderRaceTamper = SnapshotTamper(root: root, outputRelativePath: renderRaceInput.outputRelativePath, mode: .overwriteSameInode)
        do {
            _ = try TeachingStreamingAudioMixer.mix(renderRaceInput, projectRoot: root, options: .init(beforePublish: { renderRaceTamper.perform() }))
            throw TestFailure.expectation("same-inode modification during rendering must be detected before publication")
        } catch TeachingStreamingAudioError.checksumMismatch { }
        try expect(renderRaceTamper.didTamper, "render-race test modified the retained verified snapshot")
        try expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent(renderRaceInput.outputRelativePath).path), "render-time same-inode modification cannot publish")

        let longInput = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "long-bounded", sampleRate: 8_000, channelCount: 1, totalFrames: 20_000, outputRelativePath: "teaching/outputs/long-bounded.caf", baseTracks: [.init(kind: .microphone, manifestRelativePath: "audio/hash-source.caf", checksum: hashChecksum)], cues: [])
        let longOutput = try TeachingStreamingAudioMixer.mix(longInput, projectRoot: root, options: .init(maxChunkFrames: 1_024))
        try expect(longOutput.durationFrames == 20_000 && longOutput.maxChunkFrames == 1_024 && longOutput.maxConcurrentReaders == 1, "real longer decode/mix/encode run remains chunk and FD bounded")

        let writeFailure = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "write-failure", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/write-failure.caf", baseTracks: [], cues: [])
        do {
            _ = try TeachingStreamingAudioMixer.mix(writeFailure, projectRoot: root, options: .init(failBeforePublish: { true }))
            throw TestFailure.expectation("staging write failure must fail before publish")
        } catch TeachingStreamingAudioError.outputWriteFailed { }
        try expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent("teaching/outputs/write-failure.caf").path), "staging write failure leaves no partial output")

        let publishCancellation = CancellationFlag()
        let cancelPublish = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "cancel-publish", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/cancel-publish.caf", baseTracks: [], cues: [])
        do {
            _ = try TeachingStreamingAudioMixer.mix(cancelPublish, projectRoot: root, options: .init(isCancelled: { publishCancellation.isCancelled() }, beforePublish: { publishCancellation.cancel() }))
            throw TestFailure.expectation("cancellation after staging but before rename must abort publication")
        } catch TeachingStreamingAudioError.cancelled { }
        try expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent("teaching/outputs/cancel-publish.caf").path), "publish cancellation leaves no visible output")

        let secondPublishFailure = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "second-publish-failure", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/second-publish-failure.caf", baseTracks: [], cues: [])
        do {
            _ = try TeachingStreamingAudioMixer.mix(secondPublishFailure, projectRoot: root, options: .init(failAfterMetadataPublish: { true }))
            throw TestFailure.expectation("audio publish failure must roll back metadata")
        } catch TeachingStreamingAudioError.outputWriteFailed { }
        try expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent("teaching/outputs/second-publish-failure.caf").path), "second publish failure preserves absent old audio")

        let swap = DirectorySwap(teaching: root.appendingPathComponent("teaching"), outside: root.appendingPathComponent("outside-output"))
        let swapInput = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "directory-swap", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/directory-swap.caf", baseTracks: [], cues: [])
        _ = try TeachingStreamingAudioMixer.mix(swapInput, projectRoot: root, options: .init(beforePublish: { swap.perform() }))
        try expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent("outside-output/directory-swap.caf").path), "directory swap cannot redirect dirfd-relative publication")
        try swap.restore()
        try expect(FileManager.default.fileExists(atPath: root.appendingPathComponent("teaching/outputs/directory-swap.caf").path), "publication remains in the originally opened output directory")

        let orphanPath = "teaching/outputs/orphan.caf"
        let orphanWork = root.appendingPathComponent("teaching/outputs/.teaching-audio-work-\(sha256Text(orphanPath))")
        try FileManager.default.createDirectory(at: orphanWork, withIntermediateDirectories: true)
        let orphanName = "crashed.staging"
        try Data("orphan".utf8).write(to: orphanWork.appendingPathComponent(orphanName))
        let orphanInput = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "orphan", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/orphan.caf", baseTracks: [], cues: [])
        _ = try TeachingStreamingAudioMixer.mix(orphanInput, projectRoot: root)
        try expect(!FileManager.default.fileExists(atPath: orphanWork.appendingPathComponent(orphanName).path), "locked output recovery removes only the exact SHA256 namespace")

        let outsideMetadataTarget = root.appendingPathComponent("outside-metadata-target")
        try Data("do-not-touch".utf8).write(to: outsideMetadataTarget)
        let metadataSwapURL = root.appendingPathComponent("teaching/outputs/metadata-swap.caf")
        try FileManager.default.createSymbolicLink(at: metadataSwapURL, withDestinationURL: outsideMetadataTarget)
        let metadataSwapInput = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "metadata-swap", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/metadata-swap.caf", baseTracks: [], cues: [])
        do {
            _ = try TeachingStreamingAudioMixer.mix(metadataSwapInput, projectRoot: root)
            throw TestFailure.expectation("published file/xattr metadata symlink cannot be followed or replaced")
        } catch TeachingStreamingAudioError.outputIdentityConflict { }
        try expect(try Data(contentsOf: outsideMetadataTarget) == Data("do-not-touch".utf8), "metadata symlink target is untouched")

        let oldOutput = root.appendingPathComponent("teaching/outputs/old.caf")
        try Data("old-output".utf8).write(to: oldOutput)
        let conflict = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "conflict", sampleRate: 8_000, channelCount: 1, totalFrames: 8, outputRelativePath: "teaching/outputs/old.caf", baseTracks: [], cues: [])
        do {
            _ = try TeachingStreamingAudioMixer.mix(conflict, projectRoot: root)
            throw TestFailure.expectation("existing output is never overwritten on failed publish")
        } catch TeachingStreamingAudioError.outputIdentityConflict { }
        try expect(try Data(contentsOf: oldOutput) == Data("old-output".utf8), "failed publish preserves old output bytes")

        let escaped = TeachingStreamingAudioMixInputV1(
            schemaVersion: 1, sourceRecordingID: "escape", sampleRate: 8_000, channelCount: 1, totalFrames: 1,
            outputRelativePath: "../escape.caf", baseTracks: [], cues: []
        )
        do {
            _ = try TeachingStreamingAudioMixer.mix(escaped, projectRoot: root)
            throw TestFailure.expectation("path traversal must fail closed")
        } catch TeachingStreamingAudioError.invalidOwnedPath { }

        let outsideAudio = root.deletingLastPathComponent().appendingPathComponent("native-streaming-outside-\(UUID().uuidString).caf")
        defer { try? FileManager.default.removeItem(at: outsideAudio) }
        let outsideChecksum = try writeAudioFixture([Float](repeating: 0.2, count: 8), to: outsideAudio)
        let escapedSource = TeachingStreamingAudioMixInputV1(
            schemaVersion: 1, sourceRecordingID: "source-escape", sampleRate: 8_000, channelCount: 1, totalFrames: 8,
            outputRelativePath: "teaching/outputs/source-escape.caf",
            baseTracks: [.init(kind: .microphone, manifestRelativePath: "audio/../../\(outsideAudio.lastPathComponent)", checksum: outsideChecksum)],
            cues: []
        )
        do {
            _ = try TeachingStreamingAudioMixer.mix(escapedSource, projectRoot: root)
            throw TestFailure.expectation("source path traversal must not escape its owned namespace")
        } catch TeachingStreamingAudioError.invalidOwnedPath { }
        try expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent(escapedSource.outputRelativePath).path), "escaped source cannot publish")

        let unsupportedContainer = TeachingStreamingAudioMixInputV1(schemaVersion: 1, sourceRecordingID: "unsupported-container", sampleRate: 8_000, channelCount: 1, totalFrames: 1, outputRelativePath: "teaching/outputs/not-really-m4a.m4a", baseTracks: [], cues: [])
        do {
            _ = try TeachingStreamingAudioMixer.mix(unsupportedContainer, projectRoot: root)
            throw TestFailure.expectation("this vertical slice must reject a container it cannot encode truthfully")
        } catch TeachingStreamingAudioError.invalidInput { }

        print("Native streaming teaching audio contract tests passed")
    }
}
