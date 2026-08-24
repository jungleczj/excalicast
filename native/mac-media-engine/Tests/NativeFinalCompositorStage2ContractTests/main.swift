@preconcurrency import AVFoundation
import CoreGraphics
import CryptoKit
import Darwin
import Foundation
import ImageIO
import UniformTypeIdentifiers
#if canImport(MacMediaEngineFinalCompositorStage2)
import MacMediaEngineFinalCompositorStage2
#endif

private enum ContractFailure: Error {
    case expectation(String)
}

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw ContractFailure.expectation(message) }
}

private func expectThrows<T, E: Error & Equatable>(
    _ expected: E,
    _ message: String,
    _ operation: () throws -> T
) throws {
    do {
        _ = try operation()
        throw ContractFailure.expectation(message)
    } catch let error as E {
        try expect(error == expected, "\(message): received \(error), expected \(expected)")
    }
}

private func makeVideo(
    at url: URL,
    width: Int,
    height: Int,
    rgb: (UInt8, UInt8, UInt8),
    laterRGB: (UInt8, UInt8, UInt8)? = nil,
    frameCount: Int = 75,
    framesPerSecond: Int32 = 30
) throws {
    let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    let input = AVAssetWriterInput(
        mediaType: .video,
        outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
        ]
    )
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
        assetWriterInput: input,
        sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
        ]
    )
    guard writer.canAdd(input) else { throw ContractFailure.expectation("synthetic video input unavailable") }
    writer.add(input)
    guard writer.startWriting() else { throw writer.error ?? ContractFailure.expectation("synthetic writer failed") }
    writer.startSession(atSourceTime: .zero)
    for index in 0..<frameCount {
        while !input.isReadyForMoreMediaData { usleep(1_000) }
        var pixelBuffer: CVPixelBuffer?
        CVPixelBufferCreate(
            kCFAllocatorDefault,
            width,
            height,
            kCVPixelFormatType_32BGRA,
            nil,
            &pixelBuffer
        )
        guard let pixelBuffer else { throw ContractFailure.expectation("pixel buffer allocation failed") }
        let frameRGB = index >= 45 ? (laterRGB ?? rgb) : rgb
        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        let bytes = CVPixelBufferGetBaseAddress(pixelBuffer)!.assumingMemoryBound(to: UInt8.self)
        let stride = CVPixelBufferGetBytesPerRow(pixelBuffer)
        for y in 0..<height {
            for x in 0..<width {
                let offset = y * stride + x * 4
                bytes[offset] = frameRGB.2
                bytes[offset + 1] = frameRGB.1
                bytes[offset + 2] = frameRGB.0
                bytes[offset + 3] = 255
            }
        }
        CVPixelBufferUnlockBaseAddress(pixelBuffer, [])
        guard adaptor.append(
            pixelBuffer,
            withPresentationTime: CMTime(value: Int64(index), timescale: framesPerSecond)
        ) else {
            throw writer.error ?? ContractFailure.expectation("synthetic frame append failed")
        }
    }
    input.markAsFinished()
    let semaphore = DispatchSemaphore(value: 0)
    writer.finishWriting { semaphore.signal() }
    guard semaphore.wait(timeout: .now() + .seconds(30)) == .success else {
        writer.cancelWriting()
        throw ContractFailure.expectation("synthetic video finish timed out")
    }
    guard writer.status == .completed else { throw writer.error ?? ContractFailure.expectation("synthetic video finish failed") }
}

private func makeAudio(at url: URL, frequency: Double, totalFrames: Int = 120_000) throws {
    let storageSettings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: 48_000,
        AVNumberOfChannelsKey: 2,
        AVLinearPCMBitDepthKey: 32,
        AVLinearPCMIsFloatKey: true,
        AVLinearPCMIsNonInterleaved: false,
    ]
    let file = try AVAudioFile(
        forWriting: url,
        settings: storageSettings,
        commonFormat: .pcmFormatFloat32,
        interleaved: false
    )
    let format = file.processingFormat
    var cursor = 0
    while cursor < totalFrames {
        let count = min(1_024, totalFrames - cursor)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))!
        buffer.frameLength = AVAudioFrameCount(count)
        for channel in 0..<2 {
            let samples = buffer.floatChannelData![channel]
            for frame in 0..<count {
                samples[frame] = Float(sin(2 * Double.pi * frequency * Double(cursor + frame) / 48_000) * 0.08)
            }
        }
        try file.write(from: buffer)
        cursor += count
    }
}

private func makeChartPNG(at url: URL) throws {
    let width = 64
    let height = 64
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: width * 4,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )!
    context.setFillColor(CGColor(red: 0, green: 1, blue: 0, alpha: 0.9))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    guard let image = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(
            url as CFURL,
            UTType.png.identifier as CFString,
            1,
            nil
          ) else { throw ContractFailure.expectation("chart PNG destination unavailable") }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw ContractFailure.expectation("chart PNG finalize failed")
    }
}

private func exportM4A(from source: URL, to destination: URL) async throws {
    let asset = AVURLAsset(url: source)
    guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
        throw ContractFailure.expectation("AAC exporter unavailable")
    }
    try await exporter.export(to: destination, as: .m4a)
}

private struct ContractSourceIdentity: Codable {
    let relativePath: String
    let byteLength: Int64
    let sha256: String
}

private struct ContractEffectiveIdentity: Codable {
    let requestSHA256: String
    let sources: [ContractSourceIdentity]
}

private func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func effectiveIdentity(
    _ request: NativeFinalCompositorStage2RequestV1,
    root: URL
) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let requestHash = sha256Hex(try encoder.encode(request))
    let paths = [
        request.screenRelativePath,
        request.cameraRelativePath,
        request.microphoneRelativePath,
        request.systemAudioRelativePath,
        request.teachingAudioRelativePath,
        request.chartRelativePath,
    ].compactMap { $0 }
    let sources = try Array(Set(paths)).sorted().map { path -> ContractSourceIdentity in
        let data = try Data(contentsOf: root.appendingPathComponent(path))
        return .init(relativePath: path, byteLength: Int64(data.count), sha256: sha256Hex(data))
    }
    return sha256Hex(try encoder.encode(ContractEffectiveIdentity(requestSHA256: requestHash, sources: sources)))
}

private func decodedAudioPeak(_ asset: AVAsset) async throws -> (peak: Float, samples: Int) {
    guard let track = try await asset.loadTracks(withMediaType: .audio).first else {
        throw ContractFailure.expectation("decoded audio track missing")
    }
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(
        track: track,
        outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsNonInterleaved: false,
        ]
    )
    reader.add(output)
    guard reader.startReading() else { throw reader.error ?? ContractFailure.expectation("audio reader failed") }
    var peak: Float = 0
    var sampleCount = 0
    while let sample = output.copyNextSampleBuffer(),
          let block = CMSampleBufferGetDataBuffer(sample) {
        var length = 0
        var pointer: UnsafeMutablePointer<Int8>?
        guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &pointer) == noErr,
              let pointer else { throw ContractFailure.expectation("decoded audio bytes unavailable") }
        let floats = UnsafeRawPointer(pointer).assumingMemoryBound(to: Float.self)
        for index in 0..<(length / MemoryLayout<Float>.size) {
            let value = floats[index]
            try expect(value.isFinite, "final audio never contains NaN or infinity")
            peak = max(peak, abs(value))
            sampleCount += 1
        }
    }
    return (peak, sampleCount)
}

@main
struct NativeFinalCompositorStage2ContractTests {
    static func main() async throws {
        let safe = NativeFinalCompositorStage2RequestV1(
            schemaVersion: 1,
            requestID: "stage2-contract",
            screenRelativePath: "materialized/screen.mp4",
            cameraRelativePath: "materialized/camera.mp4",
            microphoneRelativePath: nil,
            systemAudioRelativePath: nil,
            teachingAudioRelativePath: "teaching/outputs/final.caf",
            chartRelativePath: "rendered-charts/chart.png",
            outputRelativePath: "final/stage2-contract.mp4",
            cameraFrame: .init(x: 0.72, y: 0.68, width: 0.24, height: 0.24),
            chartFrame: .init(x: 0.05, y: 0.08, width: 0.42, height: 0.36),
            motionGraphics: false,
            limits: .init(videoFramesInFlight: 3, audioFramesPerChunk: 4_096),
            stage1PlanSHA256: String(repeating: "a", count: 64),
            sourceDurationUs: 2_500_000,
            keepRanges: [
                .init(startUs: 0, endUs: 800_000),
                .init(startUs: 1_500_000, endUs: 2_500_000),
            ]
        )

        let validated = try NativeFinalCompositorStage2.validate(safe)
        try expect(validated.videoFramesInFlight == 3, "Stage2 accepts the hard video bound")
        try expect(validated.audioFramesPerChunk == 4_096, "Stage2 accepts the hard audio bound")
        try expect(validated.checkpointIntervalUs == 2_000_000, "Stage2 checkpoints every two seconds")
        try expect(validated.producesPlayableMedia, "Stage2 is the first stage allowed to claim playable output")
        try expect(!validated.supportsInterruptedResume, "incomplete Stage2 work restarts; only ready output is reusable")

        var motion = safe
        motion.motionGraphics = true
        try expectThrows(
            NativeFinalCompositorStage2Error.motionGraphicsUnsupported,
            "motion graphics remain explicitly unsupported"
        ) {
            try NativeFinalCompositorStage2.validate(motion)
        }

        var excessVideo = safe
        excessVideo.limits = .init(videoFramesInFlight: 4, audioFramesPerChunk: 4_096)
        try expectThrows(
            NativeFinalCompositorStage2Error.videoFrameLimitExceeded(requested: 4, maximum: 3),
            "Stage2 cannot opt into an unbounded video queue"
        ) {
            try NativeFinalCompositorStage2.validate(excessVideo)
        }

        var excessAudio = safe
        excessAudio.limits = .init(videoFramesInFlight: 3, audioFramesPerChunk: 4_097)
        try expectThrows(
            NativeFinalCompositorStage2Error.audioFrameLimitExceeded(requested: 4_097, maximum: 4_096),
            "Stage2 cannot opt into oversized audio blocks"
        ) {
            try NativeFinalCompositorStage2.validate(excessAudio)
        }

        var impossibleVideoBudget = safe
        impossibleVideoBudget.limits = .init(videoFramesInFlight: 1, audioFramesPerChunk: 4_096)
        try expectThrows(
            NativeFinalCompositorStage2Error.invalidResourceLimit,
            "the declared video residency must cover both decoded and destination buffers"
        ) {
            try NativeFinalCompositorStage2.validate(impossibleVideoBudget)
        }

        var excessiveDuration = safe
        excessiveDuration.sourceDurationUs = 43_200_000_001
        excessiveDuration.keepRanges = [.init(startUs: 0, endUs: 43_200_000_001)]
        try expectThrows(
            NativeFinalCompositorStage2Error.invalidRequestIdentity,
            "Stage2 rejects source timelines longer than the bounded Stage1 contract"
        ) {
            try NativeFinalCompositorStage2.validate(excessiveDuration)
        }

        var duplicateBaseAudio = safe
        duplicateBaseAudio.microphoneRelativePath = "materialized/microphone.m4a"
        duplicateBaseAudio.systemAudioRelativePath = "materialized/systemAudio.m4a"
        try expectThrows(
            NativeFinalCompositorStage2Error.invalidAudioTopology,
            "canonical teaching mix cannot be summed with its base tracks again"
        ) { try NativeFinalCompositorStage2.validate(duplicateBaseAudio) }

        var escapedInputNamespace = safe
        escapedInputNamespace.screenRelativePath = "rendered-charts/screen.mp4"
        try expectThrows(
            NativeFinalCompositorStage2Error.invalidOwnedPath,
            "screen input is restricted to materialized"
        ) { try NativeFinalCompositorStage2.validate(escapedInputNamespace) }

        var escapedTeachingNamespace = safe
        escapedTeachingNamespace.teachingAudioRelativePath = "materialized/final.caf"
        try expectThrows(
            NativeFinalCompositorStage2Error.invalidOwnedPath,
            "teaching audio is restricted to teaching outputs"
        ) { try NativeFinalCompositorStage2.validate(escapedTeachingNamespace) }

        var escapedOutputNamespace = safe
        escapedOutputNamespace.outputRelativePath = "materialized/final.mp4"
        try expectThrows(
            NativeFinalCompositorStage2Error.invalidOwnedPath,
            "final MP4 can only publish under final"
        ) { try NativeFinalCompositorStage2.validate(escapedOutputNamespace) }

        let sandbox = FileManager.default.temporaryDirectory
            .appendingPathComponent("native-stage2-contract-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: sandbox, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: sandbox) }
        try FileManager.default.createDirectory(
            at: sandbox.appendingPathComponent("materialized", isDirectory: true),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: sandbox.appendingPathComponent("teaching/outputs", isDirectory: true),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: sandbox.appendingPathComponent("rendered-charts", isDirectory: true),
            withIntermediateDirectories: true
        )
        try makeVideo(
            at: sandbox.appendingPathComponent("materialized/screen.mp4"),
            width: 320,
            height: 180,
            rgb: (220, 30, 30),
            laterRGB: (220, 220, 30)
        )
        try makeVideo(
            at: sandbox.appendingPathComponent("materialized/camera.mp4"),
            width: 96,
            height: 96,
            rgb: (25, 60, 230)
        )
        try makeVideo(
            at: sandbox.appendingPathComponent("materialized/screen24.mp4"),
            width: 320,
            height: 180,
            rgb: (100, 40, 180),
            frameCount: 60,
            framesPerSecond: 24
        )
        let microphonePCM = sandbox.appendingPathComponent("materialized/microphone-source.caf")
        let systemAudioPCM = sandbox.appendingPathComponent("materialized/systemAudio-source.caf")
        try makeAudio(at: microphonePCM, frequency: 220)
        try makeAudio(at: systemAudioPCM, frequency: 330)
        try await exportM4A(from: microphonePCM, to: sandbox.appendingPathComponent("materialized/microphone.m4a"))
        try await exportM4A(from: systemAudioPCM, to: sandbox.appendingPathComponent("materialized/systemAudio.m4a"))
        try makeAudio(at: sandbox.appendingPathComponent("teaching/outputs/final.caf"), frequency: 660)
        try makeChartPNG(at: sandbox.appendingPathComponent("rendered-charts/chart.png"))

        var missingCameraVideo = safe
        missingCameraVideo.requestID = "stage2-camera-fail-closed"
        missingCameraVideo.cameraRelativePath = "materialized/microphone.m4a"
        missingCameraVideo.chartRelativePath = nil
        missingCameraVideo.outputRelativePath = "final/stage2-camera-fail-closed.mp4"
        do {
            _ = try await NativeFinalCompositorStage2.render(missingCameraVideo, projectRoot: sandbox)
            throw ContractFailure.expectation("requested camera without a video track was silently omitted")
        } catch let error as NativeFinalCompositorStage2Error {
            try expect(
                error == .missingCameraTrack("materialized/microphone.m4a"),
                "requested camera is fail-closed when its video track cannot be loaded"
            )
        }

        let symlinkRoot = sandbox.appendingPathComponent("symlink-root", isDirectory: true)
        try FileManager.default.createDirectory(at: symlinkRoot, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(
            at: symlinkRoot.appendingPathComponent("materialized"),
            withDestinationURL: sandbox.appendingPathComponent("materialized")
        )
        var symlinkRequest = safe
        symlinkRequest.requestID = "stage2-symlink"
        symlinkRequest.cameraRelativePath = nil
        symlinkRequest.microphoneRelativePath = nil
        symlinkRequest.systemAudioRelativePath = nil
        symlinkRequest.teachingAudioRelativePath = nil
        symlinkRequest.chartRelativePath = nil
        symlinkRequest.outputRelativePath = "final/stage2-symlink.mp4"
        do {
            _ = try await NativeFinalCompositorStage2.render(symlinkRequest, projectRoot: symlinkRoot)
            throw ContractFailure.expectation("symlinked input namespace unexpectedly rendered")
        } catch let error as NativeFinalCompositorStage2Error {
            try expect(error == .invalidOwnedPath, "every input directory is opened with O_NOFOLLOW")
        }

        let renderRequest = safe
        let rendered = try await NativeFinalCompositorStage2.render(renderRequest, projectRoot: sandbox)
        let outputURL = sandbox.appendingPathComponent(rendered.outputRelativePath)
        try expect(FileManager.default.fileExists(atPath: outputURL.path), "Stage2 atomically publishes the final MP4")
        try expect(rendered.byteLength > 0, "Stage2 reports a non-empty output")
        try expect(rendered.maximumVideoFramesInFlight <= 3, "observed video residency remains bounded")
        try expect(rendered.maximumVideoFramesInFlight == 2, "reported video residency counts decoded and destination buffers")
        try expect(rendered.maximumAudioFramesPerChunk <= 4_096, "observed audio chunks remain bounded")
        try expect(rendered.checkpointIntervalUs == 2_000_000, "render result preserves the recovery cadence")
        try expect(!rendered.supportsInterruptedResume, "render output never advertises unsupported fragment resume")
        try expect(
            rendered.audioProcessingPolicy == .canonicalRawPassthrough,
            "canonical teaching audio is explicitly raw passthrough, not falsely labelled normalized"
        )

        let finalAsset = AVURLAsset(url: outputURL)
        let finalDuration = try await finalAsset.load(.duration)
        let finalVideoTracks = try await finalAsset.loadTracks(withMediaType: .video)
        let finalAudioTracks = try await finalAsset.loadTracks(withMediaType: .audio)
        try expect(abs(CMTimeGetSeconds(finalDuration) - 1.8) < 0.12, "Stage1 keep ranges remove the middle 700ms from final media")
        try expect(finalVideoTracks.count == 1, "final MP4 contains one composited video track")
        try expect(finalAudioTracks.count == 1, "mic, system, and teaching audio land in one final audio track")
        let canonicalAudio = try await decodedAudioPeak(finalAsset)
        try expect(canonicalAudio.samples > 48_000, "canonical teaching mix has no silent timeline gap")
        try expect(canonicalAudio.peak > 0.01 && canonicalAudio.peak <= 1, "canonical final-audio boundary is audible and never clips")

        let generator = AVAssetImageGenerator(asset: finalAsset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        let image = try await generator.image(at: CMTime(seconds: 0.5, preferredTimescale: 600)).image
        var decodedBytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
        guard let decodedContext = CGContext(
            data: &decodedBytes,
            width: image.width,
            height: image.height,
            bitsPerComponent: 8,
            bytesPerRow: image.width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { throw ContractFailure.expectation("decoded composited frame unavailable") }
        decodedContext.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        func rgbaAt(normalizedX: Double, normalizedY: Double) -> (Int, Int, Int) {
            let x = min(image.width - 1, max(0, Int(Double(image.width) * normalizedX)))
            let topY = min(image.height - 1, max(0, Int(Double(image.height) * normalizedY)))
            let y = image.height - 1 - topY
            let offset = (y * image.width + x) * 4
            return (Int(decodedBytes[offset]), Int(decodedBytes[offset + 1]), Int(decodedBytes[offset + 2]))
        }
        let chartPixel = rgbaAt(normalizedX: 0.12, normalizedY: 0.16)
        let cameraPixel = rgbaAt(normalizedX: 0.82, normalizedY: 0.79)
        var greenBounds: (minX: Int, minY: Int, maxX: Int, maxY: Int)?
        var blueBounds: (minX: Int, minY: Int, maxX: Int, maxY: Int)?
        for y in 0..<image.height {
            for x in 0..<image.width {
                let pixel = rgbaAt(normalizedX: Double(x) / Double(image.width), normalizedY: Double(y) / Double(image.height))
                if pixel.1 > pixel.0 * 2 && pixel.1 > pixel.2 * 2 {
                    if let current = greenBounds {
                        greenBounds = (min(current.minX, x), min(current.minY, y), max(current.maxX, x), max(current.maxY, y))
                    } else {
                        greenBounds = (x, y, x, y)
                    }
                }
                if pixel.2 > pixel.0 * 2 && pixel.2 > pixel.1 * 2 {
                    if let current = blueBounds {
                        blueBounds = (min(current.minX, x), min(current.minY, y), max(current.maxX, x), max(current.maxY, y))
                    } else {
                        blueBounds = (x, y, x, y)
                    }
                }
            }
        }
        try expect(chartPixel.1 > chartPixel.0 && chartPixel.1 > chartPixel.2, "transparent chart PNG is visible in decoded media: \(chartPixel), green=\(String(describing: greenBounds))")
        try expect(cameraPixel.2 > cameraPixel.0 && cameraPixel.2 > cameraPixel.1, "camera overlay is visible in decoded media: \(cameraPixel), blue=\(String(describing: blueBounds))")

        let postCutImage = try await generator.image(at: CMTime(seconds: 1.0, preferredTimescale: 600)).image
        var postCutBytes = [UInt8](repeating: 0, count: postCutImage.width * postCutImage.height * 4)
        let postCutContext = CGContext(
            data: &postCutBytes,
            width: postCutImage.width,
            height: postCutImage.height,
            bitsPerComponent: 8,
            bytesPerRow: postCutImage.width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
        )!
        postCutContext.draw(postCutImage, in: CGRect(x: 0, y: 0, width: postCutImage.width, height: postCutImage.height))
        let centerY = postCutImage.height / 2
        let centerX = postCutImage.width * 3 / 5
        let centerOffset = (centerY * postCutImage.width + centerX) * 4
        try expect(
            Int(postCutBytes[centerOffset]) > 150 && Int(postCutBytes[centerOffset + 1]) > 150,
            "the frame after the cut comes from the retained later source interval: \(Array(postCutBytes[centerOffset..<(centerOffset + 4)]))"
        )
        try expect(rendered.stage1PlanSHA256 == String(repeating: "a", count: 64), "output identity binds the Stage1 plan")

        var baseAudioRequest = renderRequest
        baseAudioRequest.requestID = "stage2-base-m4a"
        baseAudioRequest.outputRelativePath = "final/stage2-base-m4a.mp4"
        baseAudioRequest.cameraRelativePath = nil
        baseAudioRequest.chartRelativePath = nil
        baseAudioRequest.teachingAudioRelativePath = nil
        baseAudioRequest.microphoneRelativePath = "materialized/microphone.m4a"
        baseAudioRequest.systemAudioRelativePath = "materialized/systemAudio.m4a"
        let baseAudioOutput = try await NativeFinalCompositorStage2.render(baseAudioRequest, projectRoot: sandbox)
        let baseAudioAsset = AVURLAsset(url: sandbox.appendingPathComponent(baseAudioOutput.outputRelativePath))
        let basePeak = try await decodedAudioPeak(baseAudioAsset)
        try expect(basePeak.samples > 48_000, "real AAC microphone and system tracks survive the keep-range mix")
        try expect(basePeak.peak > 0.01 && basePeak.peak <= 1, "base M4A summing keeps deterministic headroom")
        try expect(
            baseAudioOutput.audioProcessingPolicy == .rawSourceMixWithFixedHeadroom,
            "raw mic/system inputs declare fixed headroom without claiming normalization"
        )

        var sourceRateRequest = renderRequest
        sourceRateRequest.requestID = "stage2-source-rate"
        sourceRateRequest.screenRelativePath = "materialized/screen24.mp4"
        sourceRateRequest.cameraRelativePath = nil
        sourceRateRequest.teachingAudioRelativePath = nil
        sourceRateRequest.chartRelativePath = nil
        sourceRateRequest.outputRelativePath = "final/stage2-source-rate.mp4"
        let sourceRateOutput = try await NativeFinalCompositorStage2.render(sourceRateRequest, projectRoot: sandbox)
        let sourceRateAsset = AVURLAsset(url: sandbox.appendingPathComponent(sourceRateOutput.outputRelativePath))
        let sourceRateTrack = try await sourceRateAsset.loadTracks(withMediaType: .video)[0]
        let sourceRate = try await sourceRateTrack.load(.nominalFrameRate)
        try expect(abs(sourceRate - 24) < 1, "output frame cadence follows the bounded source rate instead of hard-coded 30fps")

        let oversizedURL = sandbox.appendingPathComponent("materialized/oversized.mp4")
        FileManager.default.createFile(atPath: oversizedURL.path, contents: Data([0]))
        let oversizedHandle = try FileHandle(forWritingTo: oversizedURL)
        try oversizedHandle.truncate(atOffset: UInt64(NativeFinalCompositorStage2.maximumMediaInputBytes + 1))
        try oversizedHandle.close()
        var oversizedRequest = sourceRateRequest
        oversizedRequest.requestID = "stage2-oversized-input"
        oversizedRequest.screenRelativePath = "materialized/oversized.mp4"
        oversizedRequest.outputRelativePath = "final/stage2-oversized-input.mp4"
        do {
            _ = try await NativeFinalCompositorStage2.render(oversizedRequest, projectRoot: sandbox)
            throw ContractFailure.expectation("oversized media input entered the clone/hash/decode pipeline")
        } catch let error as NativeFinalCompositorStage2Error {
            try expect(
                error == .inputResourceLimitExceeded("materialized/oversized.mp4"),
                "input bytes are rejected from fstat before expensive copy, hash, or AVFoundation load"
            )
        }

        var lockCancellationRequest = sourceRateRequest
        lockCancellationRequest.requestID = "stage2-lock-cancel"
        lockCancellationRequest.outputRelativePath = "final/stage2-lock-cancel.mp4"
        let externalLockURL = sandbox.appendingPathComponent("final/.stage2-id-stage2-lock-cancel.lock")
        let externalLockFD = Darwin.open(
            externalLockURL.path,
            O_RDWR | O_CREAT | O_CLOEXEC,
            S_IRUSR | S_IWUSR
        )
        try expect(externalLockFD >= 0, "contract acquires an external lock descriptor")
        try expect(flock(externalLockFD, LOCK_EX) == 0, "contract holds the cross-process render lock")
        let cancellationStart = DispatchTime.now().uptimeNanoseconds
        do {
            _ = try await NativeFinalCompositorStage2.render(
                lockCancellationRequest,
                projectRoot: sandbox,
                options: .init(isCancelled: {
                    DispatchTime.now().uptimeNanoseconds - cancellationStart >= 50_000_000
                })
            )
            throw ContractFailure.expectation("render lock wait ignored cancellation")
        } catch let error as NativeFinalCompositorStage2Error {
            try expect(error == .cancelled, "cross-process flock wait polls cancellation")
        }
        let cancellationElapsed = DispatchTime.now().uptimeNanoseconds - cancellationStart
        try expect(cancellationElapsed < 1_000_000_000, "flock cancellation is bounded well below one second")
        _ = flock(externalLockFD, LOCK_UN)
        Darwin.close(externalLockFD)

        var concurrentRequest = renderRequest
        concurrentRequest.requestID = "stage2-concurrent"
        concurrentRequest.outputRelativePath = "final/stage2-concurrent.mp4"
        async let concurrentFirst = NativeFinalCompositorStage2.render(concurrentRequest, projectRoot: sandbox)
        async let concurrentSecond = NativeFinalCompositorStage2.render(concurrentRequest, projectRoot: sandbox)
        let concurrentOutputs = try await [concurrentFirst, concurrentSecond]
        try expect(
            Set(concurrentOutputs.map(\.sha256)).count == 1,
            "concurrent callers for one effective request adopt one immutable output"
        )
        try expect(
            concurrentOutputs.filter(\.reusedReadyOutput).count == 1,
            "the serialized concurrent follower reuses the verified ready output"
        )

        let sharedOutputName = "stage2-shared-output.mp4"
        var sharedOutputA = sourceRateRequest
        sharedOutputA.requestID = "stage2-shared-output-a"
        sharedOutputA.outputRelativePath = "final/\(sharedOutputName)"
        var sharedOutputB = sharedOutputA
        sharedOutputB.requestID = "stage2-shared-output-b"
        let sharedTaskA = Task {
            do {
                _ = try await NativeFinalCompositorStage2.render(sharedOutputA, projectRoot: sandbox)
                return (sharedOutputA.requestID, true, nil as NativeFinalCompositorStage2Error?)
            } catch let error as NativeFinalCompositorStage2Error {
                return (sharedOutputA.requestID, false, error)
            }
        }
        let sharedTaskB = Task {
            do {
                _ = try await NativeFinalCompositorStage2.render(sharedOutputB, projectRoot: sandbox)
                return (sharedOutputB.requestID, true, nil as NativeFinalCompositorStage2Error?)
            } catch let error as NativeFinalCompositorStage2Error {
                return (sharedOutputB.requestID, false, error)
            }
        }
        let sharedResults = [try await sharedTaskA.value, try await sharedTaskB.value]
        try expect(sharedResults.filter { $0.1 }.count == 1, "one immutable output has one winning identity")
        let sharedLosers = sharedResults.filter { !$0.1 }
        try expect(
            sharedLosers.count == 1 && sharedLosers[0].2 == .outputIdentityConflict,
            "the second identity for an owned output is rejected"
        )
        let losingCheckpoint = sandbox.appendingPathComponent(
            "final/.\(sharedLosers[0].0).stage2-checkpoint.json"
        )
        try expect(
            !FileManager.default.fileExists(atPath: losingCheckpoint.path),
            "output locking rejects the losing identity before it renders or publishes checkpoint state"
        )

        var conflictingIdentity = concurrentRequest
        conflictingIdentity.outputRelativePath = "final/stage2-concurrent-other.mp4"
        do {
            _ = try await NativeFinalCompositorStage2.render(conflictingIdentity, projectRoot: sandbox)
            throw ContractFailure.expectation("one request ID accepted a second effective identity")
        } catch let error as NativeFinalCompositorStage2Error {
            try expect(
                error == .outputIdentityConflict,
                "one request ID is permanently bound to one effective input and output identity"
            )
        }

        let recovered = try await NativeFinalCompositorStage2.render(renderRequest, projectRoot: sandbox)
        try expect(recovered.reusedReadyOutput, "a verified ready checkpoint reuses the playable output after restart")

        let readyCheckpointURL = sandbox.appendingPathComponent("final/.stage2-contract.stage2-checkpoint.json")
        var interruptedAfterPublish = try JSONSerialization.jsonObject(
            with: Data(contentsOf: readyCheckpointURL)
        ) as! [String: Any]
        interruptedAfterPublish["status"] = "interrupted"
        try JSONSerialization.data(withJSONObject: interruptedAfterPublish).write(
            to: readyCheckpointURL,
            options: .atomic
        )
        let adoptedAfterPublish = try await NativeFinalCompositorStage2.render(renderRequest, projectRoot: sandbox)
        try expect(
            adoptedAfterPublish.reusedReadyOutput,
            "a verified final output is adopted when publish succeeded but ready checkpoint persistence failed"
        )
        let adoptedCheckpoint = try JSONSerialization.jsonObject(
            with: Data(contentsOf: readyCheckpointURL)
        ) as! [String: Any]
        try expect(adoptedCheckpoint["status"] as? String == "ready", "adoption repairs the terminal checkpoint")

        let validCheckpointData = try Data(contentsOf: readyCheckpointURL)
        var unboundInterruptedCheckpoint = try JSONSerialization.jsonObject(
            with: validCheckpointData
        ) as! [String: Any]
        unboundInterruptedCheckpoint["status"] = "interrupted"
        unboundInterruptedCheckpoint.removeValue(forKey: "output")
        try JSONSerialization.data(withJSONObject: unboundInterruptedCheckpoint).write(
            to: readyCheckpointURL,
            options: .atomic
        )
        do {
            _ = try await NativeFinalCompositorStage2.render(renderRequest, projectRoot: sandbox)
            throw ContractFailure.expectation("unbound existing output was adopted without a persisted checksum")
        } catch let error as NativeFinalCompositorStage2Error {
            try expect(
                error == .outputIdentityConflict,
                "post-publish recovery requires persisted size, checksum, and semantic metadata"
            )
        }
        try validCheckpointData.write(to: readyCheckpointURL, options: .atomic)

        var forgedCheckpoint = try JSONSerialization.jsonObject(with: validCheckpointData) as! [String: Any]
        var forgedOutput = forgedCheckpoint["output"] as! [String: Any]
        forgedOutput["byteLength"] = 1
        forgedCheckpoint["output"] = forgedOutput
        try JSONSerialization.data(withJSONObject: forgedCheckpoint).write(to: readyCheckpointURL, options: .atomic)
        do {
            _ = try await NativeFinalCompositorStage2.render(renderRequest, projectRoot: sandbox)
            throw ContractFailure.expectation("ready checkpoint with a forged output size was reused")
        } catch let error as NativeFinalCompositorStage2Error {
            try expect(error == .outputIdentityConflict, "ready recovery binds checksum and exact byte length")
        }
        try validCheckpointData.write(to: readyCheckpointURL, options: .atomic)

        var unsupportedCheckpointRequest = renderRequest
        unsupportedCheckpointRequest.requestID = "stage2-checkpoint-v2"
        unsupportedCheckpointRequest.outputRelativePath = "final/stage2-checkpoint-v2.mp4"
        let unsupportedCheckpointURL = sandbox.appendingPathComponent(
            "final/.stage2-checkpoint-v2.stage2-checkpoint.json"
        )
        try JSONSerialization.data(withJSONObject: [
            "schemaVersion": 2,
            "requestSHA256": String(repeating: "0", count: 64),
            "status": "interrupted",
            "progressUs": 0,
        ]).write(to: unsupportedCheckpointURL, options: .atomic)
        do {
            _ = try await NativeFinalCompositorStage2.render(unsupportedCheckpointRequest, projectRoot: sandbox)
            throw ContractFailure.expectation("unsupported checkpoint schema was silently replaced")
        } catch let error as NativeFinalCompositorStage2Error {
            try expect(
                error == .unsupportedCheckpointSchemaVersion(2),
                "unsupported checkpoint schema is rejected before any render or output mutation"
            )
        }

        let chartURL = sandbox.appendingPathComponent("rendered-charts/chart.png")
        let originalChartData = try Data(contentsOf: chartURL)
        try Data("replaced-chart-bytes".utf8).write(to: chartURL, options: .atomic)
        do {
            _ = try await NativeFinalCompositorStage2.render(renderRequest, projectRoot: sandbox)
            throw ContractFailure.expectation("same-path input replacement reused old ready media")
        } catch let error as NativeFinalCompositorStage2Error {
            try expect(error == .outputIdentityConflict, "ready identity binds every immutable input byte stream")
        }
        try originalChartData.write(to: chartURL, options: .atomic)

        var cancelledRequest = renderRequest
        cancelledRequest.requestID = "stage2-cancelled"
        cancelledRequest.outputRelativePath = "final/stage2-cancelled.mp4"
        do {
            _ = try await NativeFinalCompositorStage2.render(
                cancelledRequest,
                projectRoot: sandbox,
                options: .init(isCancelled: { true })
            )
            throw ContractFailure.expectation("cancelled render unexpectedly published output")
        } catch let error as NativeFinalCompositorStage2Error {
            try expect(error == .cancelled, "cancellation reaches an explicit interrupted-safe state")
        }
        try expect(
            !FileManager.default.fileExists(atPath: sandbox.appendingPathComponent(cancelledRequest.outputRelativePath).path),
            "cancelled work never publishes a partial MP4"
        )
        let cancelledEffectiveIdentity = try effectiveIdentity(cancelledRequest, root: sandbox)
        let simulatedCrashOrphan = sandbox.appendingPathComponent("final/.\(cancelledEffectiveIdentity)-crash.tmp.mp4")
        try Data("partial-fragment".utf8).write(to: simulatedCrashOrphan)
        let restarted = try await NativeFinalCompositorStage2.render(cancelledRequest, projectRoot: sandbox)
        try expect(!restarted.reusedReadyOutput, "a cancelled checkpoint restarts from a clean staging file")
        try expect(restarted.byteLength > 0, "restart after cancellation publishes playable media")
        try expect(!FileManager.default.fileExists(atPath: simulatedCrashOrphan.path), "restart removes an orphaned crash staging file")

        print("Native final compositor Stage2 contract tests passed")
    }
}
