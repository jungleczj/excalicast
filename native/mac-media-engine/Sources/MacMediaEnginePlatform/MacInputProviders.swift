import AppKit
import CoreGraphics
@preconcurrency import CoreMedia
import Foundation
import MacMediaEngineCore

public final class CoreMediaHostClock: NativeInputHostClock, @unchecked Sendable {
    public init() {}

    public func nowUs() -> Int64 {
        CMClockGetTime(CMClockGetHostTimeClock())
            .convertScale(1_000_000, method: .roundTowardZero)
            .value
    }
}

public final class MacDisplayGeometryProvider: NativeInputDisplayProviding, @unchecked Sendable {
    public init() {}

    public func activeDisplays() -> [NativeDisplayGeometry] {
        var count: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
        var identifiers = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetActiveDisplayList(count, &identifiers, &count) == .success else { return [] }
        return identifiers.prefix(Int(count)).map { identifier in
            let bounds = CGDisplayBounds(identifier)
            let scale: Double
            if let mode = CGDisplayCopyDisplayMode(identifier), mode.width > 0 {
                scale = Double(mode.pixelWidth) / Double(mode.width)
            } else {
                scale = 1
            }
            return NativeDisplayGeometry(
                displayId: Int(identifier),
                bounds: NativeGlobalRect(
                    x: bounds.origin.x,
                    y: bounds.origin.y,
                    width: bounds.width,
                    height: bounds.height
                ),
                scale: max(1, scale)
            )
        }
    }
}

public struct MacFrontmostApplication: Equatable, Sendable {
    public let processId: Int
    public let application: String
    public let bundleIdentifier: String

    public init(processId: Int, application: String, bundleIdentifier: String) {
        self.processId = processId
        self.application = application
        self.bundleIdentifier = bundleIdentifier
    }
}

public struct MacWindowSnapshot: Equatable, Sendable {
    public let processId: Int
    public let windowId: Int
    public let layer: Int
    public let isOnscreen: Bool
    public let title: String
    public let bounds: NativeGlobalRect

    public init(
        processId: Int,
        windowId: Int,
        layer: Int,
        isOnscreen: Bool,
        title: String,
        bounds: NativeGlobalRect
    ) {
        self.processId = processId
        self.windowId = windowId
        self.layer = layer
        self.isOnscreen = isOnscreen
        self.title = title
        self.bounds = bounds
    }
}

public enum MacActiveWindowSelector {
    public static func select(
        frontmost: MacFrontmostApplication,
        windows: [MacWindowSnapshot],
        excludingWindowIDs: Set<UInt32>,
        hostUs: Int64
    ) -> NativeActiveWindowSnapshot? {
        guard let window = windows.first(where: {
            $0.processId == frontmost.processId
                && $0.layer == 0
                && $0.isOnscreen
                && $0.bounds.width > 1
                && $0.bounds.height > 1
                && !excludingWindowIDs.contains(UInt32(clamping: $0.windowId))
        }) else { return nil }
        return NativeActiveWindowSnapshot(
            hostUs: hostUs,
            application: frontmost.application,
            bundleIdentifier: frontmost.bundleIdentifier,
            processId: frontmost.processId,
            windowId: window.windowId,
            title: window.title,
            bounds: window.bounds
        )
    }
}

public final class MacActiveWindowProvider: NativeInputWindowProviding, @unchecked Sendable {
    public init() {}

    public func activeWindow(
        hostUs: Int64,
        excludingWindowIDs: Set<UInt32>
    ) -> NativeActiveWindowSnapshot? {
        guard let application = NSWorkspace.shared.frontmostApplication else { return nil }
        let frontmost = MacFrontmostApplication(
            processId: Int(application.processIdentifier),
            application: application.localizedName ?? "",
            bundleIdentifier: application.bundleIdentifier ?? ""
        )
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let rawWindows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }
        let windows = rawWindows.compactMap(Self.decodeWindow)
        return MacActiveWindowSelector.select(
            frontmost: frontmost,
            windows: windows,
            excludingWindowIDs: excludingWindowIDs,
            hostUs: hostUs
        )
    }

    private static func decodeWindow(_ info: [String: Any]) -> MacWindowSnapshot? {
        guard let pid = (info[kCGWindowOwnerPID as String] as? NSNumber)?.intValue,
              let windowId = (info[kCGWindowNumber as String] as? NSNumber)?.intValue,
              let layer = (info[kCGWindowLayer as String] as? NSNumber)?.intValue,
              let onscreen = (info[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue,
              let boundsDictionary = info[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: boundsDictionary) else { return nil }
        guard bounds.origin.x.isFinite, bounds.origin.y.isFinite,
              bounds.width.isFinite, bounds.height.isFinite else { return nil }
        return MacWindowSnapshot(
            processId: pid,
            windowId: windowId,
            layer: layer,
            isOnscreen: onscreen,
            title: info[kCGWindowName as String] as? String ?? "",
            bounds: NativeGlobalRect(
                x: bounds.origin.x,
                y: bounds.origin.y,
                width: bounds.width,
                height: bounds.height
            )
        )
    }
}
