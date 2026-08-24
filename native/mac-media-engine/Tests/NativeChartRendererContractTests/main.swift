import CryptoKit
import CoreGraphics
import Foundation
import ImageIO
@_spi(ContractTests) import MacMediaEngineChartRenderer

private enum ContractFailure: Error {
    case expectation(String)
}

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw ContractFailure.expectation(message) }
}

private func sha256(_ url: URL) throws -> String {
    let data = try Data(contentsOf: url)
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func containsTranslucentPixel(_ data: Data) -> Bool {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return false }
    var rgba = [UInt8](repeating: 0, count: image.width * image.height * 4)
    let rendered = rgba.withUnsafeMutableBytes { bytes -> Bool in
        guard let context = CGContext(
            data: bytes.baseAddress,
            width: image.width,
            height: image.height,
            bitsPerComponent: 8,
            bytesPerRow: image.width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
        ) else { return false }
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return true
    }
    guard rendered else { return false }
    return stride(from: 3, to: rgba.count, by: 4).contains { (1...254).contains(Int(rgba[$0])) }
}

private final class ConcurrentErrors: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [Error] = []

    func append(_ error: Error) {
        lock.lock()
        values.append(error)
        lock.unlock()
    }

    var isEmpty: Bool {
        lock.lock()
        defer { lock.unlock() }
        return values.isEmpty
    }

    var snapshot: [Error] {
        lock.lock()
        defer { lock.unlock() }
        return values
    }
}

private final class ConcurrentOutputs: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [TeachingChartRenderOutputV1] = []

    func append(_ output: TeachingChartRenderOutputV1) {
        lock.lock()
        values.append(output)
        lock.unlock()
    }

    var snapshot: [TeachingChartRenderOutputV1] {
        lock.lock()
        defer { lock.unlock() }
        return values
    }
}

@main
struct NativeChartRendererContractTests {
    static func main() throws {
        let sandbox = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("native-chart-renderer-contract-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: sandbox) }
        try FileManager.default.createDirectory(at: sandbox, withIntermediateDirectories: true)

        let input = TeachingChartRenderInputV1(
            schemaVersion: 1,
            sourceRecordingId: "recording-001",
            operationId: "chart-operation-001",
            asset: .init(assetId: "chart-bars-01", catalogVersion: "2026.08", assetVersion: "1"),
            frame: .init(width: 960, height: 540),
            chart: .init(
                labels: ["Mon", "Tue", "Wed", "Thu"],
                series: [
                    .init(name: "Students", values: [12, 18, 15, 22]),
                    .init(name: "Completed", values: [8, 14, 12, 19]),
                ]
            )
        )

        let first = try TeachingChartRenderer.render(input, into: sandbox)
        try expect(first.schemaVersion == 1, "output schema is versioned")
        try expect(first.mimeType == "image/png", "renderer produces a PNG asset")
        try expect(first.hasAlpha, "renderer output has alpha")
        try expect(first.relativePath == "rendered-charts/chart-operation-001.png", "relative output path is deterministic")
        let firstURL = sandbox.appendingPathComponent(first.relativePath)
        try expect(FileManager.default.fileExists(atPath: firstURL.path), "renderer atomically produces its output")
        try expect(first.byteLength > 100, "renderer produces nonempty image data")
        try expect(first.inputSha256.count == 64, "output binds the immutable input checksum")
        let writtenChecksum = try sha256(firstURL)
        let writtenBytes = try Data(contentsOf: firstURL)
        try expect(first.sha256 == writtenChecksum, "reported checksum matches bytes")
        try expect(writtenBytes.prefix(8) == Data([137, 80, 78, 71, 13, 10, 26, 10]), "output is PNG")
        try expect([4, 6].contains(writtenBytes[25]), "PNG color type explicitly contains alpha")
        try expect(containsTranslucentPixel(writtenBytes), "decoded RGBA pixels contain real translucency")

        let originalFileNumber = (try FileManager.default.attributesOfItem(atPath: firstURL.path)[.systemFileNumber] as? NSNumber)?.uint64Value
        let second = try TeachingChartRenderer.render(input, into: sandbox)
        try expect(second.sha256 == first.sha256, "equal input gives equal output bytes")
        try expect(second.byteLength == first.byteLength, "equal input gives equal byte length")
        let repeatedFileNumber = (try FileManager.default.attributesOfItem(atPath: firstURL.path)[.systemFileNumber] as? NSNumber)?.uint64Value
        try expect(originalFileNumber == repeatedFileNumber, "matching completed output is idempotent and is not replaced")

        do {
            _ = try TeachingChartRenderer.render(
                TeachingChartRenderInputV1(
                    schemaVersion: 1,
                    sourceRecordingId: input.sourceRecordingId,
                    operationId: input.operationId,
                    asset: input.asset,
                    frame: input.frame,
                    chart: .init(
                        labels: input.chart.labels,
                        series: [
                            .init(name: "Students", values: [12, 18, 15, 23]),
                            .init(name: "Completed", values: [8, 14, 12, 19]),
                        ]
                    )
                ),
                into: sandbox
            )
            throw ContractFailure.expectation("same operation ID cannot overwrite different immutable content")
        } catch TeachingChartRendererError.operationIdentityConflict {
            let checksumAfterConflict = try sha256(firstURL)
            try expect(checksumAfterConflict == first.sha256, "identity conflict preserves the original asset")
        }

        let preservedChecksum = second.sha256
        do {
            _ = try TeachingChartRenderer.render(
                TeachingChartRenderInputV1(
                    schemaVersion: 1,
                    sourceRecordingId: "recording-001",
                    operationId: input.operationId,
                    asset: input.asset,
                    frame: input.frame,
                    chart: .init(labels: ["Broken"], series: [.init(name: "Series", values: [-1])])
                ),
                into: sandbox
            )
            throw ContractFailure.expectation("invalid update must fail before replacing the existing asset")
        } catch TeachingChartRendererError.invalidChartData {
            let checksumAfterFailure = try sha256(firstURL)
            try expect(checksumAfterFailure == preservedChecksum, "failed update preserves completed output")
        }

        do {
            _ = try TeachingChartRenderer.render(
                TeachingChartRenderInputV1(
                    schemaVersion: 2,
                    sourceRecordingId: "recording-001",
                    operationId: "bad-version",
                    asset: .init(assetId: "chart-bars-01", catalogVersion: "2026.08", assetVersion: "1"),
                    frame: .init(width: 960, height: 540),
                    chart: input.chart
                ),
                into: sandbox
            )
            throw ContractFailure.expectation("unknown schema version must fail closed")
        } catch TeachingChartRendererError.unsupportedSchemaVersion(2) {
            // expected
        }

        do {
            _ = try TeachingChartRenderer.render(
                TeachingChartRenderInputV1(
                    schemaVersion: 1,
                    sourceRecordingId: "recording-001",
                    operationId: "../escape",
                    asset: .init(assetId: "chart-bars-01", catalogVersion: "2026.08", assetVersion: "1"),
                    frame: .init(width: 960, height: 540),
                    chart: input.chart
                ),
                into: sandbox
            )
            throw ContractFailure.expectation("path traversal must fail closed")
        } catch TeachingChartRendererError.invalidOperationID {
            // expected
        }

        do {
            _ = try TeachingChartRenderer.render(
                TeachingChartRenderInputV1(
                    schemaVersion: 1,
                    sourceRecordingId: "recording-001",
                    operationId: "point-limit",
                    asset: .init(assetId: "chart-bars-01", catalogVersion: "2026.08", assetVersion: "1"),
                    frame: .init(width: 960, height: 540),
                    chart: .init(labels: Array(repeating: "x", count: 513), series: [.init(name: "Series", values: Array(repeating: 1, count: 513))])
                ),
                into: sandbox
            )
            throw ContractFailure.expectation("point budget must fail closed")
        } catch TeachingChartRendererError.pointLimitExceeded {
            // expected
        }

        do {
            _ = try TeachingChartRenderer.render(
                TeachingChartRenderInputV1(
                    schemaVersion: 1,
                    sourceRecordingId: "recording-001",
                    operationId: "pixel-limit",
                    asset: input.asset,
                    frame: .init(width: 3_840, height: 2_160),
                    chart: input.chart
                ),
                into: sandbox
            )
            throw ContractFailure.expectation("oversize frame must fail closed")
        } catch TeachingChartRendererError.pixelBudgetExceeded {
            // expected
        }

        do {
            _ = try TeachingChartRenderer.render(
                TeachingChartRenderInputV1(
                    schemaVersion: 1,
                    sourceRecordingId: "recording-001",
                    operationId: "text-budget",
                    asset: input.asset,
                    frame: input.frame,
                    chart: .init(
                        labels: Array(repeating: String(repeating: "a", count: 128), count: 33),
                        series: [.init(name: "Series", values: Array(repeating: 1, count: 33))]
                    )
                ),
                into: sandbox
            )
            throw ContractFailure.expectation("chart text byte budget must fail closed")
        } catch TeachingChartRendererError.textByteBudgetExceeded {
            // expected
        }

        for invalidValue in [Double.nan, Double.infinity] {
            do {
                _ = try TeachingChartRenderer.render(
                    TeachingChartRenderInputV1(
                        schemaVersion: 1,
                        sourceRecordingId: "recording-001",
                        operationId: invalidValue.isNaN ? "nan-value" : "infinite-value",
                        asset: input.asset,
                        frame: input.frame,
                        chart: .init(labels: ["One"], series: [.init(name: "Series", values: [invalidValue])])
                    ),
                    into: sandbox
                )
                throw ContractFailure.expectation("non-finite chart values must fail closed")
            } catch TeachingChartRendererError.invalidChartData {
                // expected
            }
        }

        do {
            _ = try TeachingChartRenderer.render(
                TeachingChartRenderInputV1(
                    schemaVersion: 1,
                    sourceRecordingId: "recording-001",
                    operationId: "oversized-label",
                    asset: input.asset,
                    frame: input.frame,
                    chart: .init(labels: [String(repeating: "a", count: 129)], series: [.init(name: "Series", values: [1])])
                ),
                into: sandbox
            )
            throw ContractFailure.expectation("single oversized label must fail closed")
        } catch TeachingChartRendererError.invalidChartData {
            // expected
        }

        do {
            _ = try TeachingChartRenderer.render(
                TeachingChartRenderInputV1(
                    schemaVersion: 1,
                    sourceRecordingId: "recording-001",
                    operationId: "oversized-series",
                    asset: input.asset,
                    frame: input.frame,
                    chart: .init(labels: ["One"], series: [.init(name: String(repeating: "a", count: 129), values: [1])])
                ),
                into: sandbox
            )
            throw ContractFailure.expectation("single oversized series name must fail closed")
        } catch TeachingChartRendererError.invalidChartData {
            // expected
        }

        do {
            _ = try TeachingChartRenderer.render(
                TeachingChartRenderInputV1(
                    schemaVersion: 1,
                    sourceRecordingId: "recording-001",
                    operationId: "output-budget",
                    asset: input.asset,
                    frame: input.frame,
                    chart: input.chart,
                    outputByteBudget: 100
                ),
                into: sandbox
            )
            throw ContractFailure.expectation("declared PNG byte budget must fail closed")
        } catch TeachingChartRendererError.outputByteBudgetExceeded {
            // expected
        }

        let outside = sandbox.deletingLastPathComponent().appendingPathComponent("outside-\(UUID().uuidString)", isDirectory: true)
        let symlinkRoot = sandbox.appendingPathComponent("symlink-root", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: outside) }
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: symlinkRoot, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(
            at: symlinkRoot.appendingPathComponent("rendered-charts"),
            withDestinationURL: outside
        )
        do {
            _ = try TeachingChartRenderer.render(input, into: symlinkRoot)
            throw ContractFailure.expectation("output directory symlink must not escape the project root")
        } catch TeachingChartRendererError.outputPathEscapesRoot {
            try expect(!FileManager.default.fileExists(atPath: outside.appendingPathComponent("chart-operation-001.png").path), "escape target stays untouched")
        }


        for injectedFailure in [
            TeachingChartRendererInjectedFailure.stagingWrite,
            TeachingChartRendererInjectedFailure.stagingFsync,
        ] {
            let failureRoot = sandbox.appendingPathComponent("failure-\(String(describing: injectedFailure))", isDirectory: true)
            try FileManager.default.createDirectory(at: failureRoot, withIntermediateDirectories: true)
            do {
                _ = try TeachingChartRenderer.renderForContractTests(
                    TeachingChartRenderInputV1(
                        schemaVersion: 1,
                        sourceRecordingId: "recording-001",
                        operationId: "failure-output",
                        asset: input.asset,
                        frame: input.frame,
                        chart: input.chart
                    ),
                    into: failureRoot,
                    injectedStagingFailure: injectedFailure
                )
                throw ContractFailure.expectation("injected staging failure must fail closed")
            } catch TeachingChartRendererError.outputWriteFailed {
                let outputDirectory = failureRoot.appendingPathComponent("rendered-charts", isDirectory: true)
                let entries = try FileManager.default.contentsOfDirectory(atPath: outputDirectory.path)
                try expect(entries.isEmpty, "write/fsync failure leaves no staging or completed output")
            }
        }

        let targetLink = sandbox.appendingPathComponent("rendered-charts/chart-link.png")
        try FileManager.default.createSymbolicLink(at: targetLink, withDestinationURL: outside.appendingPathComponent("target.png"))
        do {
            _ = try TeachingChartRenderer.render(
                TeachingChartRenderInputV1(
                    schemaVersion: 1,
                    sourceRecordingId: "recording-001",
                    operationId: "chart-link",
                    asset: input.asset,
                    frame: input.frame,
                    chart: input.chart
                ),
                into: sandbox
            )
            throw ContractFailure.expectation("existing output symlink must fail closed")
        } catch TeachingChartRendererError.outputPathEscapesRoot {
            try expect(!FileManager.default.fileExists(atPath: outside.appendingPathComponent("target.png").path), "target symlink stays untouched")
        }

        let concurrentInput = TeachingChartRenderInputV1(
            schemaVersion: 1,
            sourceRecordingId: "recording-001",
            operationId: "concurrent-output",
            asset: input.asset,
            frame: input.frame,
            chart: input.chart
        )
        let group = DispatchGroup()
        let errors = ConcurrentErrors()
        let outputs = ConcurrentOutputs()
        for _ in 0..<12 {
            group.enter()
            DispatchQueue.global().async {
                defer { group.leave() }
                do {
                    outputs.append(try TeachingChartRenderer.render(concurrentInput, into: sandbox))
                } catch {
                    errors.append(error)
                }
            }
        }
        group.wait()
        try expect(errors.isEmpty, "same-operation concurrent renders publish without staging collisions")
        let concurrentURL = sandbox.appendingPathComponent("rendered-charts/concurrent-output.png")
        let concurrentChecksum = try sha256(concurrentURL)
        try expect(concurrentChecksum.count == 64, "concurrent publication leaves complete bytes")
        try expect(outputs.snapshot.count == 12, "every concurrent caller receives a completed output")
        try expect(outputs.snapshot.allSatisfy { $0.sha256 == concurrentChecksum }, "every concurrent result checksum matches the final file")

        let conflictingOperation = "concurrent-conflict"
        let conflictA = TeachingChartRenderInputV1(
            schemaVersion: 1,
            sourceRecordingId: "recording-001",
            operationId: conflictingOperation,
            asset: input.asset,
            frame: input.frame,
            chart: input.chart
        )
        let conflictB = TeachingChartRenderInputV1(
            schemaVersion: 1,
            sourceRecordingId: "recording-001",
            operationId: conflictingOperation,
            asset: input.asset,
            frame: input.frame,
            chart: .init(
                labels: input.chart.labels,
                series: [
                    .init(name: "Students", values: [13, 18, 15, 22]),
                    .init(name: "Completed", values: [8, 14, 12, 19]),
                ]
            )
        )
        let conflictGroup = DispatchGroup()
        let conflictErrors = ConcurrentErrors()
        let conflictOutputs = ConcurrentOutputs()
        for candidate in [conflictA, conflictB] {
            conflictGroup.enter()
            DispatchQueue.global().async {
                defer { conflictGroup.leave() }
                do {
                    conflictOutputs.append(try TeachingChartRenderer.render(candidate, into: sandbox))
                } catch {
                    conflictErrors.append(error)
                }
            }
        }
        conflictGroup.wait()
        try expect(conflictOutputs.snapshot.count == 1, "only one immutable input can claim an operation ID")
        try expect(
            conflictErrors.snapshot.count == 1 && conflictErrors.snapshot.allSatisfy {
                ($0 as? TeachingChartRendererError) == .operationIdentityConflict
            },
            "the competing immutable input receives an identity conflict"
        )
        let conflictURL = sandbox.appendingPathComponent("rendered-charts/\(conflictingOperation).png")
        let conflictFinalChecksum = try sha256(conflictURL)
        try expect(conflictOutputs.snapshot[0].sha256 == conflictFinalChecksum, "winning concurrent checksum matches the final file")

        let corruptURL = sandbox.appendingPathComponent("rendered-charts/corrupt-output.png")
        try Data([0, 1, 2, 3, 4, 5, 6, 7]).write(to: corruptURL)
        do {
            _ = try TeachingChartRenderer.render(
                TeachingChartRenderInputV1(
                    schemaVersion: 1,
                    sourceRecordingId: "recording-001",
                    operationId: "corrupt-output",
                    asset: input.asset,
                    frame: input.frame,
                    chart: input.chart
                ),
                into: sandbox
            )
            throw ContractFailure.expectation("corrupt existing output must fail closed")
        } catch TeachingChartRendererError.existingOutputInvalid {
            let corruptBytes = try Data(contentsOf: corruptURL)
            try expect(corruptBytes.count == 8, "corrupt existing output is not overwritten")
        }

        let oversizedURL = sandbox.appendingPathComponent("rendered-charts/oversized-output.png")
        try Data(repeating: 0xA5, count: 1_025).write(to: oversizedURL)
        do {
            _ = try TeachingChartRenderer.render(
                TeachingChartRenderInputV1(
                    schemaVersion: 1,
                    sourceRecordingId: "recording-001",
                    operationId: "oversized-output",
                    asset: input.asset,
                    frame: input.frame,
                    chart: input.chart,
                    outputByteBudget: 1_024
                ),
                into: sandbox
            )
            throw ContractFailure.expectation("existing output over the byte budget must fail before reading")
        } catch TeachingChartRendererError.outputByteBudgetExceeded {
            let size = (try FileManager.default.attributesOfItem(atPath: oversizedURL.path)[.size] as? NSNumber)?.intValue
            try expect(size == 1_025, "oversized existing output is preserved")
        }

        let raceRoot = sandbox.appendingPathComponent("race-root", isDirectory: true)
        let raceOutside = sandbox.appendingPathComponent("race-outside", isDirectory: true)
        let heldDirectory = raceRoot.appendingPathComponent("rendered-charts-held", isDirectory: true)
        try FileManager.default.createDirectory(at: raceRoot, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: raceOutside, withIntermediateDirectories: true)
        do {
            _ = try TeachingChartRenderer.renderForContractTests(input, into: raceRoot) {
                let outputDirectory = raceRoot.appendingPathComponent("rendered-charts", isDirectory: true)
                try FileManager.default.moveItem(at: outputDirectory, to: heldDirectory)
                try FileManager.default.createSymbolicLink(at: outputDirectory, withDestinationURL: raceOutside)
            }
            throw ContractFailure.expectation("directory replacement after open must fail closed")
        } catch TeachingChartRendererError.outputPathEscapesRoot {
            try expect(!FileManager.default.fileExists(atPath: raceOutside.appendingPathComponent("chart-operation-001.png").path), "controlled race cannot publish outside root")
            try expect(!FileManager.default.fileExists(atPath: heldDirectory.appendingPathComponent("chart-operation-001.png").path), "failed raced publication removes staging/output")
        }
    }
}
