public struct LatestFrameQueue<Element> {
    public let capacity: Int
    public private(set) var droppedCount = 0
    private var elements: [Element] = []

    public init(capacity: Int) {
        precondition(capacity > 0, "Frame queue capacity must be positive")
        self.capacity = capacity
        elements.reserveCapacity(capacity)
    }

    public var count: Int { elements.count }

    public mutating func offer(_ element: Element) {
        if elements.count == capacity {
            elements.removeFirst()
            droppedCount += 1
        }
        elements.append(element)
    }

    public mutating func popOldest() -> Element? {
        guard !elements.isEmpty else { return nil }
        return elements.removeFirst()
    }

    public mutating func removeAll() -> [Element] {
        defer { elements.removeAll(keepingCapacity: true) }
        return elements
    }
}
