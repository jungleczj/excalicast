import CoreGraphics
import CoreText
import CryptoKit
import Darwin
import Foundation
import ImageIO
import UniformTypeIdentifiers

public struct TeachingChartRenderInputV1: Codable, Sendable, Equatable {
    public struct Asset: Codable, Sendable, Equatable {
        public let assetId: String
        public let catalogVersion: String
        public let assetVersion: String

        public init(assetId: String, catalogVersion: String, assetVersion: String) {
            self.assetId = assetId
            self.catalogVersion = catalogVersion
            self.assetVersion = assetVersion
        }
    }

    public struct Frame: Codable, Sendable, Equatable {
        public let width: Int
        public let height: Int

        public init(width: Int, height: Int) {
            self.width = width
            self.height = height
        }
    }

    public struct Series: Codable, Sendable, Equatable {
        public let name: String
        public let values: [Double]

        public init(name: String, values: [Double]) {
            self.name = name
            self.values = values
        }
    }

    public struct Chart: Codable, Sendable, Equatable {
        public let labels: [String]
        public let series: [Series]

        public init(labels: [String], series: [Series]) {
            self.labels = labels
            self.series = series
        }
    }

    public let schemaVersion: Int
    public let sourceRecordingId: String
    public let operationId: String
    public let asset: Asset
    public let frame: Frame
    public let chart: Chart
    /** A composition-owned bound; image bytes are never allowed to exceed it. */
    public let outputByteBudget: Int

    public init(
        schemaVersion: Int,
        sourceRecordingId: String,
        operationId: String,
        asset: Asset,
        frame: Frame,
        chart: Chart,
        outputByteBudget: Int = 16 * 1_024 * 1_024
    ) {
        self.schemaVersion = schemaVersion
        self.sourceRecordingId = sourceRecordingId
        self.operationId = operationId
        self.asset = asset
        self.frame = frame
        self.chart = chart
        self.outputByteBudget = outputByteBudget
    }
}

public struct TeachingChartRenderOutputV1: Codable, Sendable, Equatable {
    public let schemaVersion: Int
    public let operationId: String
    public let relativePath: String
    public let mimeType: String
    public let hasAlpha: Bool
    public let byteLength: Int
    public let sha256: String
    public let inputSha256: String

    public init(
        schemaVersion: Int,
        operationId: String,
        relativePath: String,
        mimeType: String,
        hasAlpha: Bool,
        byteLength: Int,
        sha256: String,
        inputSha256: String
    ) {
        self.schemaVersion = schemaVersion
        self.operationId = operationId
        self.relativePath = relativePath
        self.mimeType = mimeType
        self.hasAlpha = hasAlpha
        self.byteLength = byteLength
        self.sha256 = sha256
        self.inputSha256 = inputSha256
    }
}

public enum TeachingChartRendererError: Error, Equatable {
    case unsupportedSchemaVersion(Int)
    case invalidIdentifier
    case invalidOperationID
    case invalidFrame
    case pixelBudgetExceeded
    case seriesLimitExceeded
    case pointLimitExceeded
    case invalidChartData
    case textByteBudgetExceeded
    case outputByteBudgetExceeded
    case outputPathEscapesRoot
    case operationIdentityConflict
    case existingOutputInvalid
    case nativeRendererUnavailable
    case outputWriteFailed
}

@_spi(ContractTests)
public enum TeachingChartRendererInjectedFailure: Sendable {
    case stagingWrite
    case stagingFsync
}

public enum TeachingChartRenderer {
    public static let inputSchemaVersion = 1
    public static let outputSchemaVersion = 1
    public static let maximumWidth = 3_840
    public static let maximumHeight = 2_160
    public static let maximumPixels = 8_000_000
    public static let maximumSeries = 8
    public static let maximumPoints = 512
    public static let maximumOutputBytes = 16 * 1_024 * 1_024

    private static let identifier = try! NSRegularExpression(pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
    private static let outputDirectoryName = "rendered-charts"
    private static let pngIdentityPrefix = "excalicast-input-sha256:"

    public static func render(_ input: TeachingChartRenderInputV1, into root: URL) throws -> TeachingChartRenderOutputV1 {
        try render(input, into: root, afterOpeningOutputDirectory: nil, injectedStagingFailure: nil)
    }

    @_spi(ContractTests)
    public static func renderForContractTests(
        _ input: TeachingChartRenderInputV1,
        into root: URL,
        afterOpeningOutputDirectory: @escaping () throws -> Void
    ) throws -> TeachingChartRenderOutputV1 {
        try render(
            input,
            into: root,
            afterOpeningOutputDirectory: afterOpeningOutputDirectory,
            injectedStagingFailure: nil
        )
    }

    @_spi(ContractTests)
    public static func renderForContractTests(
        _ input: TeachingChartRenderInputV1,
        into root: URL,
        injectedStagingFailure: TeachingChartRendererInjectedFailure
    ) throws -> TeachingChartRenderOutputV1 {
        try render(
            input,
            into: root,
            afterOpeningOutputDirectory: nil,
            injectedStagingFailure: injectedStagingFailure
        )
    }

    private static func render(
        _ input: TeachingChartRenderInputV1,
        into root: URL,
        afterOpeningOutputDirectory: (() throws -> Void)?,
        injectedStagingFailure: TeachingChartRendererInjectedFailure?
    ) throws -> TeachingChartRenderOutputV1 {
        try validate(input)
        guard root.isFileURL else { throw TeachingChartRendererError.outputWriteFailed }
        let rootFD = Darwin.open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard rootFD >= 0 else {
            throw errno == ELOOP ? TeachingChartRendererError.outputPathEscapesRoot : TeachingChartRendererError.outputWriteFailed
        }
        defer { Darwin.close(rootFD) }
        let directoryCreated: Bool
        if mkdirat(rootFD, outputDirectoryName, S_IRWXU) == 0 {
            directoryCreated = true
        } else if errno == EEXIST {
            directoryCreated = false
        } else {
            throw TeachingChartRendererError.outputWriteFailed
        }
        let directoryFD = openat(rootFD, outputDirectoryName, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directoryFD >= 0 else {
            throw errno == ELOOP || errno == ENOTDIR
                ? TeachingChartRendererError.outputPathEscapesRoot
                : TeachingChartRendererError.outputWriteFailed
        }
        defer { Darwin.close(directoryFD) }
        if directoryCreated, fsync(rootFD) != 0 {
            throw TeachingChartRendererError.outputWriteFailed
        }
        try afterOpeningOutputDirectory?()
        guard outputDirectoryStillMatches(rootFD: rootFD, directoryFD: directoryFD) else {
            throw TeachingChartRendererError.outputPathEscapesRoot
        }

        let relativePath = "rendered-charts/\(input.operationId).png"
        let outputName = "\(input.operationId).png"
        let inputChecksum = immutableInputChecksum(input)
        if let existing = try readExistingOutput(
            directoryFD: directoryFD,
            name: outputName,
            input: input,
            inputChecksum: inputChecksum,
            relativePath: relativePath
        ) {
            guard outputDirectoryStillMatches(rootFD: rootFD, directoryFD: directoryFD) else {
                throw TeachingChartRendererError.outputPathEscapesRoot
            }
            return existing
        }

        let data = try drawPNG(input, inputChecksum: inputChecksum)
        guard data.count > 0, data.count <= input.outputByteBudget else {
            throw TeachingChartRendererError.outputByteBudgetExceeded
        }
        let checksum = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        let stagingName = ".\(UUID().uuidString).tmp.png"
        var ownsStaging = true
        defer {
            if ownsStaging {
                _ = unlinkat(directoryFD, stagingName, 0)
                _ = fsync(directoryFD)
            }
        }
        try writeStaging(
            data,
            directoryFD: directoryFD,
            name: stagingName,
            injectedFailure: injectedStagingFailure
        )
        if renameatx_np(directoryFD, stagingName, directoryFD, outputName, UInt32(RENAME_EXCL)) != 0 {
            if errno == EEXIST {
                _ = unlinkat(directoryFD, stagingName, 0)
                ownsStaging = false
                guard fsync(directoryFD) == 0 else { throw TeachingChartRendererError.outputWriteFailed }
                guard let winner = try readExistingOutput(
                    directoryFD: directoryFD,
                    name: outputName,
                    input: input,
                    inputChecksum: inputChecksum,
                    relativePath: relativePath
                ) else { throw TeachingChartRendererError.outputWriteFailed }
                guard outputDirectoryStillMatches(rootFD: rootFD, directoryFD: directoryFD) else {
                    throw TeachingChartRendererError.outputPathEscapesRoot
                }
                return winner
            }
            throw TeachingChartRendererError.outputWriteFailed
        }
        ownsStaging = false
        guard fsync(directoryFD) == 0 else { throw TeachingChartRendererError.outputWriteFailed }
        guard outputDirectoryStillMatches(rootFD: rootFD, directoryFD: directoryFD) else {
            _ = unlinkat(directoryFD, outputName, 0)
            _ = fsync(directoryFD)
            throw TeachingChartRendererError.outputPathEscapesRoot
        }
        let result = TeachingChartRenderOutputV1(
            schemaVersion: outputSchemaVersion,
            operationId: input.operationId,
            relativePath: relativePath,
            mimeType: "image/png",
            hasAlpha: true,
            byteLength: data.count,
            sha256: checksum,
            inputSha256: inputChecksum
        )
        guard let published = try readExistingOutput(
            directoryFD: directoryFD,
            name: outputName,
            input: input,
            inputChecksum: inputChecksum,
            relativePath: relativePath
        ), published == result else { throw TeachingChartRendererError.outputWriteFailed }
        return published
    }

    private static func validate(_ input: TeachingChartRenderInputV1) throws {
        guard input.schemaVersion == inputSchemaVersion else {
            throw TeachingChartRendererError.unsupportedSchemaVersion(input.schemaVersion)
        }
        guard isIdentifier(input.sourceRecordingId), isIdentifier(input.operationId),
              isIdentifier(input.asset.assetId), isIdentifier(input.asset.catalogVersion), isIdentifier(input.asset.assetVersion) else {
            throw input.operationId.contains("/") || input.operationId.contains("\\") || input.operationId.contains(".")
                ? TeachingChartRendererError.invalidOperationID
                : TeachingChartRendererError.invalidIdentifier
        }
        guard input.frame.width >= 320, input.frame.height >= 180,
              input.frame.width <= maximumWidth, input.frame.height <= maximumHeight else {
            throw TeachingChartRendererError.invalidFrame
        }
        guard input.frame.width <= maximumPixels / input.frame.height else {
            throw TeachingChartRendererError.pixelBudgetExceeded
        }
        guard input.outputByteBudget > 0, input.outputByteBudget <= maximumOutputBytes else {
            throw TeachingChartRendererError.outputByteBudgetExceeded
        }
        guard !input.chart.labels.isEmpty, input.chart.labels.count <= maximumPoints else {
            throw TeachingChartRendererError.pointLimitExceeded
        }
        guard !input.chart.series.isEmpty, input.chart.series.count <= maximumSeries else {
            throw TeachingChartRendererError.seriesLimitExceeded
        }
        guard input.chart.labels.allSatisfy(validText), input.chart.series.allSatisfy({
            validText($0.name) && $0.values.count == input.chart.labels.count
                && $0.values.allSatisfy { $0.isFinite && $0 >= 0 }
        }) else {
            throw TeachingChartRendererError.invalidChartData
        }
        let textBytes = input.chart.labels.reduce(0) { $0 + $1.utf8.count }
            + input.chart.series.reduce(0) { $0 + $1.name.utf8.count }
        guard textBytes <= 4_096 else { throw TeachingChartRendererError.textByteBudgetExceeded }
    }

    private static func isIdentifier(_ value: String) -> Bool {
        let range = NSRange(value.startIndex..., in: value)
        return identifier.firstMatch(in: value, range: range) != nil
    }

    private static func validText(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 128
            && !value.unicodeScalars.contains { $0.value < 0x20 || $0.value == 0x7F }
    }

    private static func immutableInputChecksum(_ input: TeachingChartRenderInputV1) -> String {
        var bytes = Data()
        func appendUInt64(_ value: UInt64) {
            var bigEndian = value.bigEndian
            withUnsafeBytes(of: &bigEndian) { bytes.append(contentsOf: $0) }
        }
        func appendString(_ value: String) {
            let encoded = Data(value.utf8)
            appendUInt64(UInt64(encoded.count))
            bytes.append(encoded)
        }
        appendUInt64(UInt64(input.schemaVersion))
        appendString(input.sourceRecordingId)
        appendString(input.operationId)
        appendString(input.asset.assetId)
        appendString(input.asset.catalogVersion)
        appendString(input.asset.assetVersion)
        appendUInt64(UInt64(input.frame.width))
        appendUInt64(UInt64(input.frame.height))
        appendUInt64(UInt64(input.chart.labels.count))
        input.chart.labels.forEach(appendString)
        appendUInt64(UInt64(input.chart.series.count))
        for series in input.chart.series {
            appendString(series.name)
            appendUInt64(UInt64(series.values.count))
            series.values.forEach { appendUInt64($0.bitPattern) }
        }
        return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }

    private static func outputDirectoryStillMatches(rootFD: Int32, directoryFD: Int32) -> Bool {
        let currentFD = openat(rootFD, outputDirectoryName, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard currentFD >= 0 else { return false }
        defer { Darwin.close(currentFD) }
        var held = stat()
        var current = stat()
        guard fstat(directoryFD, &held) == 0, fstat(currentFD, &current) == 0 else { return false }
        return held.st_dev == current.st_dev && held.st_ino == current.st_ino
    }

    private static func readExistingOutput(
        directoryFD: Int32,
        name: String,
        input: TeachingChartRenderInputV1,
        inputChecksum: String,
        relativePath: String
    ) throws -> TeachingChartRenderOutputV1? {
        let fd = openat(directoryFD, name, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else {
            if errno == ENOENT { return nil }
            if errno == ELOOP { throw TeachingChartRendererError.outputPathEscapesRoot }
            throw TeachingChartRendererError.existingOutputInvalid
        }
        defer { Darwin.close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG else {
            throw TeachingChartRendererError.existingOutputInvalid
        }
        guard info.st_size > 0 else { throw TeachingChartRendererError.existingOutputInvalid }
        guard info.st_size <= off_t(input.outputByteBudget) else {
            throw TeachingChartRendererError.outputByteBudgetExceeded
        }
        let count = Int(info.st_size)
        var data = Data(count: count)
        var offset = 0
        while offset < count {
            let bytesRead = data.withUnsafeMutableBytes { buffer -> Int in
                guard let base = buffer.baseAddress else { return -1 }
                return Darwin.read(fd, base.advanced(by: offset), count - offset)
            }
            if bytesRead < 0, errno == EINTR { continue }
            guard bytesRead > 0 else { throw TeachingChartRendererError.existingOutputInvalid }
            offset += bytesRead
        }
        var finalInfo = stat()
        guard fstat(fd, &finalInfo) == 0,
              finalInfo.st_dev == info.st_dev,
              finalInfo.st_ino == info.st_ino,
              finalInfo.st_size == info.st_size else {
            throw TeachingChartRendererError.existingOutputInvalid
        }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) == 1,
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
              image.width == input.frame.width,
              image.height == input.frame.height,
              imageHasAlpha(image),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as NSDictionary?,
              let png = properties[kCGImagePropertyPNGDictionary] as? NSDictionary,
              let description = png[kCGImagePropertyPNGDescription] as? String,
              description.hasPrefix(pngIdentityPrefix) else {
            throw TeachingChartRendererError.existingOutputInvalid
        }
        let existingInputChecksum = String(description.dropFirst(pngIdentityPrefix.count))
        guard existingInputChecksum.count == 64 else { throw TeachingChartRendererError.existingOutputInvalid }
        guard existingInputChecksum == inputChecksum else {
            throw TeachingChartRendererError.operationIdentityConflict
        }
        return TeachingChartRenderOutputV1(
            schemaVersion: outputSchemaVersion,
            operationId: input.operationId,
            relativePath: relativePath,
            mimeType: "image/png",
            hasAlpha: true,
            byteLength: data.count,
            sha256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(),
            inputSha256: inputChecksum
        )
    }

    private static func imageHasAlpha(_ image: CGImage) -> Bool {
        switch image.alphaInfo {
        case .premultipliedLast, .premultipliedFirst, .last, .first, .alphaOnly:
            return true
        case .none, .noneSkipLast, .noneSkipFirst:
            return false
        @unknown default:
            return false
        }
    }

    private static func writeStaging(
        _ data: Data,
        directoryFD: Int32,
        name: String,
        injectedFailure: TeachingChartRendererInjectedFailure?
    ) throws {
        let fd = openat(
            directoryFD,
            name,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            S_IRUSR | S_IWUSR
        )
        guard fd >= 0 else { throw TeachingChartRendererError.outputWriteFailed }
        var closeRequired = true
        var completed = false
        defer {
            if closeRequired { Darwin.close(fd) }
            if !completed {
                _ = unlinkat(directoryFD, name, 0)
                _ = fsync(directoryFD)
            }
        }
        if case .stagingWrite = injectedFailure {
            throw TeachingChartRendererError.outputWriteFailed
        }
        var offset = 0
        while offset < data.count {
            let written = data.withUnsafeBytes { buffer -> Int in
                guard let base = buffer.baseAddress else { return -1 }
                return Darwin.write(fd, base.advanced(by: offset), data.count - offset)
            }
            if written < 0, errno == EINTR { continue }
            guard written > 0 else { throw TeachingChartRendererError.outputWriteFailed }
            offset += written
        }
        if case .stagingFsync = injectedFailure {
            throw TeachingChartRendererError.outputWriteFailed
        }
        guard fsync(fd) == 0 else { throw TeachingChartRendererError.outputWriteFailed }
        guard Darwin.close(fd) == 0 else {
            closeRequired = false
            throw TeachingChartRendererError.outputWriteFailed
        }
        closeRequired = false
        completed = true
    }

    private static func drawPNG(_ input: TeachingChartRenderInputV1, inputChecksum: String) throws -> Data {
        let width = input.frame.width
        let height = input.frame.height
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
        ) else { throw TeachingChartRendererError.nativeRendererUnavailable }

        context.setAllowsAntialiasing(true)
        context.setShouldAntialias(true)
        context.setFillColor(CGColor(red: 0.055, green: 0.071, blue: 0.125, alpha: 0.92))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let chartArea = CGRect(x: CGFloat(width) * 0.10, y: CGFloat(height) * 0.17, width: CGFloat(width) * 0.84, height: CGFloat(height) * 0.68)
        context.setStrokeColor(CGColor(red: 0.71, green: 0.76, blue: 0.89, alpha: 0.28))
        context.setLineWidth(1)
        for step in 0...4 {
            let y = chartArea.minY + chartArea.height * CGFloat(step) / 4
            context.move(to: CGPoint(x: chartArea.minX, y: y))
            context.addLine(to: CGPoint(x: chartArea.maxX, y: y))
            context.strokePath()
        }

        let maximum = max(1, input.chart.series.flatMap(\.values).max() ?? 1)
        let seriesCount = input.chart.series.count
        let groupWidth = chartArea.width / CGFloat(input.chart.labels.count)
        let barWidth = max(1, min(40, groupWidth * 0.72 / CGFloat(seriesCount)))
        let colors = [
            CGColor(red: 0.30, green: 0.60, blue: 1.0, alpha: 0.96),
            CGColor(red: 0.27, green: 0.88, blue: 0.65, alpha: 0.96),
            CGColor(red: 1.0, green: 0.64, blue: 0.32, alpha: 0.96),
            CGColor(red: 0.84, green: 0.50, blue: 1.0, alpha: 0.96),
        ]
        for (seriesIndex, series) in input.chart.series.enumerated() {
            context.setFillColor(colors[seriesIndex % colors.count])
            for (pointIndex, value) in series.values.enumerated() {
                let barHeight = chartArea.height * CGFloat(value / maximum)
                let groupStart = chartArea.minX + CGFloat(pointIndex) * groupWidth
                let barsWidth = barWidth * CGFloat(seriesCount)
                let x = groupStart + (groupWidth - barsWidth) / 2 + barWidth * CGFloat(seriesIndex)
                let rect = CGRect(x: x, y: chartArea.minY, width: max(1, barWidth - 1), height: max(0, barHeight))
                context.fill(rect)
            }
        }
        drawText("Teaching data", in: context, x: chartArea.minX, y: CGFloat(height) * 0.90, size: 15, color: CGColor(gray: 1, alpha: 0.88))
        for (index, label) in input.chart.labels.enumerated() {
            let x = chartArea.minX + (CGFloat(index) + 0.5) * groupWidth
            drawText(label, in: context, x: x - 18, y: CGFloat(height) * 0.09, size: 11, color: CGColor(gray: 1, alpha: 0.72))
        }
        guard let image = context.makeImage() else { throw TeachingChartRendererError.nativeRendererUnavailable }
        let mutableData = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(mutableData, UTType.png.identifier as CFString, 1, nil) else {
            throw TeachingChartRendererError.nativeRendererUnavailable
        }
        let properties: [CFString: Any] = [
            kCGImagePropertyPNGDictionary: [
                kCGImagePropertyPNGDescription: pngIdentityPrefix + inputChecksum,
            ] as [CFString: Any],
        ]
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw TeachingChartRendererError.outputWriteFailed }
        return mutableData as Data
    }

    private static func drawText(_ value: String, in context: CGContext, x: CGFloat, y: CGFloat, size: CGFloat, color: CGColor) {
        let font = CTFontCreateWithName("Helvetica" as CFString, size, nil)
        let attributes: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
        ]
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: value, attributes: attributes))
        context.textPosition = CGPoint(x: x, y: y)
        CTLineDraw(line, context)
    }
}
