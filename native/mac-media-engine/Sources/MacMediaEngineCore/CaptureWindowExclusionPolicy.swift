import Foundation

public enum CaptureWindowExclusionPolicy {
    public static let maximumWindowCount = 32

    public static func normalized(_ windowIDs: [UInt32]) -> [UInt32] {
        var seen = Set<UInt32>()
        var result: [UInt32] = []
        for windowID in windowIDs where windowID > 0 {
            guard result.count < maximumWindowCount else { break }
            if seen.insert(windowID).inserted { result.append(windowID) }
        }
        return result
    }

    public static func matchingWindowIDs(
        requested: [UInt32],
        available: [UInt32]
    ) -> [UInt32] {
        let availableSet = Set(available)
        return normalized(requested).filter(availableSet.contains)
    }
}
