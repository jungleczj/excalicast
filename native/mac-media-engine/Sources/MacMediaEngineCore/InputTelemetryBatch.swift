import Foundation

public enum InputTelemetryBatchError: Error, Equatable, Sendable {
    case invalidEnvelope
    case sessionMismatch
    case invalidSequence
    case tooManyProducerEpochs
    case payloadTooLarge
}

public struct InputTelemetryAcknowledgement: Codable, Equatable, Sendable {
    public let producerId: String
    public let producerEpoch: String
    public let acknowledgedSequence: Int
    public let segmentIndex: Int?
    public let duplicate: Bool
    public let dropped: Bool
}

private struct ProducerKey: Hashable {
    let producerId: String
    let producerEpoch: String
}

private struct ProducerEvent {
    let producerId: String
    let producerEpoch: String
    let producerSequence: Int
    let surfaceId: String
    let kind: String
    let payload: [String: Any]
}

public final class InputTelemetryCoordinator: @unchecked Sendable {
    public static let maximumEventCount = 256
    public static let maximumPayloadBytes = 4 * 1_024 * 1_024

    private let sessionId: String
    private var nextSegmentIndex = 0
    private var lastGlobalAtUs: Int64 = -1
    private var acknowledgedSequences: [ProducerKey: Int] = [:]
    private let lock = NSLock()

    public init(sessionId: String) {
        self.sessionId = sessionId
    }

    public func append(
        payload: Data,
        projectAtUs: Int64,
        persist: (_ index: Int, _ startUs: Int64, _ durationUs: Int64, _ data: Data) throws -> Void
    ) throws -> InputTelemetryAcknowledgement {
        let events = try Self.parse(payload: payload, expectedSessionId: sessionId)
        guard let first = events.first, let last = events.last, projectAtUs >= 0 else {
            throw InputTelemetryBatchError.invalidEnvelope
        }
        let key = ProducerKey(producerId: first.producerId, producerEpoch: first.producerEpoch)

        lock.lock()
        defer { lock.unlock() }
        try admitEpoch(key)
        let acknowledged = acknowledgedSequences[key]
        if let acknowledged, last.producerSequence <= acknowledged {
            return InputTelemetryAcknowledgement(
                producerId: first.producerId,
                producerEpoch: first.producerEpoch,
                acknowledgedSequence: acknowledged,
                segmentIndex: nil,
                duplicate: true,
                dropped: false
            )
        }
        let expectedFirst = (acknowledged ?? -1) + 1
        guard first.producerSequence <= expectedFirst,
              events.contains(where: { $0.producerSequence == expectedFirst }) else {
            throw InputTelemetryBatchError.invalidSequence
        }
        let unseen = events.filter { $0.producerSequence >= expectedFirst }
        let segmentIndex = nextSegmentIndex
        let startUs = max(projectAtUs, lastGlobalAtUs + 1)
        var authoritativeEvents: [[String: Any]] = []
        for (offset, event) in unseen.enumerated() {
            var authoritative = event.payload
            authoritative["schemaVersion"] = 1
            authoritative["sessionId"] = sessionId
            authoritative["atUs"] = startUs + Int64(offset)
            authoritative["kind"] = event.kind
            authoritative["producerId"] = event.producerId
            authoritative["producerEpoch"] = event.producerEpoch
            authoritative["producerSequence"] = event.producerSequence
            authoritative["surfaceId"] = event.surfaceId
            authoritativeEvents.append(authoritative)
        }
        let endUs = startUs + Int64(authoritativeEvents.count - 1)
        let authoritativeBatch: [String: Any] = [
            "schemaVersion": 1,
            "sessionId": sessionId,
            "index": segmentIndex,
            "startUs": startUs,
            "endUs": endUs,
            "events": authoritativeEvents,
        ]
        let data = try JSONSerialization.data(withJSONObject: authoritativeBatch, options: [.sortedKeys])
        try persist(segmentIndex, startUs, max(1, endUs - startUs + 1), data)

        nextSegmentIndex += 1
        lastGlobalAtUs = endUs
        acknowledgedSequences[key] = last.producerSequence
        return InputTelemetryAcknowledgement(
            producerId: first.producerId,
            producerEpoch: first.producerEpoch,
            acknowledgedSequence: last.producerSequence,
            segmentIndex: segmentIndex,
            duplicate: false,
            dropped: false
        )
    }

    public func acknowledgeDropped(payload: Data) throws -> InputTelemetryAcknowledgement {
        let events = try Self.parse(payload: payload, expectedSessionId: sessionId)
        guard let first = events.first, let last = events.last else {
            throw InputTelemetryBatchError.invalidEnvelope
        }
        let key = ProducerKey(producerId: first.producerId, producerEpoch: first.producerEpoch)
        lock.lock()
        defer { lock.unlock() }
        try admitEpoch(key)
        let acknowledged = acknowledgedSequences[key]
        if let acknowledged, last.producerSequence <= acknowledged {
            return InputTelemetryAcknowledgement(
                producerId: first.producerId,
                producerEpoch: first.producerEpoch,
                acknowledgedSequence: acknowledged,
                segmentIndex: nil,
                duplicate: true,
                dropped: true
            )
        }
        let expectedFirst = (acknowledged ?? -1) + 1
        guard first.producerSequence <= expectedFirst,
              events.contains(where: { $0.producerSequence == expectedFirst }) else {
            throw InputTelemetryBatchError.invalidSequence
        }
        acknowledgedSequences[key] = last.producerSequence
        return InputTelemetryAcknowledgement(
            producerId: first.producerId,
            producerEpoch: first.producerEpoch,
            acknowledgedSequence: last.producerSequence,
            segmentIndex: nil,
            duplicate: false,
            dropped: true
        )
    }

    private func admitEpoch(_ key: ProducerKey) throws {
        if acknowledgedSequences[key] != nil { return }
        let epochCount = acknowledgedSequences.keys.filter { $0.producerId == key.producerId }.count
        guard epochCount < 64 else { throw InputTelemetryBatchError.tooManyProducerEpochs }
    }

    private static func parse(payload: Data, expectedSessionId: String) throws -> [ProducerEvent] {
        guard !payload.isEmpty else { throw InputTelemetryBatchError.invalidEnvelope }
        guard payload.count <= maximumPayloadBytes else { throw InputTelemetryBatchError.payloadTooLarge }
        guard let object = try? JSONSerialization.jsonObject(with: payload),
              let envelope = object as? [String: Any],
              Set(envelope.keys) == Set(["schemaVersion", "events"]),
              integer(envelope["schemaVersion"]) == 1,
              let rawEvents = envelope["events"] as? [[String: Any]],
              !rawEvents.isEmpty, rawEvents.count <= maximumEventCount else {
            throw InputTelemetryBatchError.invalidEnvelope
        }
        let eventKeys = Set([
            "schemaVersion", "sessionId", "producerId", "producerEpoch",
            "producerSequence", "surfaceId", "kind", "payload",
        ])
        let producerIds = Set(["main-whiteboard", "desktop-ink"])
        let kinds = Set([
            "active-window", "window-bounds", "cursor", "click", "dwell", "scroll",
            "ink", "undo", "mode-change", "camera-control",
        ])
        var result: [ProducerEvent] = []
        var identity: (String, String)?
        var previousSequence: Int?
        for raw in rawEvents {
            guard Set(raw.keys) == eventKeys,
                  integer(raw["schemaVersion"]) == 1,
                  let eventSessionId = raw["sessionId"] as? String,
                  let producerId = raw["producerId"] as? String, producerIds.contains(producerId),
                  let producerEpoch = raw["producerEpoch"] as? String, validIdentifier(producerEpoch),
                  let sequenceValue = integer(raw["producerSequence"]), sequenceValue <= Int64(Int.max),
                  let surfaceId = raw["surfaceId"] as? String, validIdentifier(surfaceId),
                  let kind = raw["kind"] as? String, kinds.contains(kind),
                  let eventPayload = raw["payload"] as? [String: Any],
                  !containsPathAuthority(eventPayload) else {
                throw InputTelemetryBatchError.invalidEnvelope
            }
            guard eventSessionId == expectedSessionId else { throw InputTelemetryBatchError.sessionMismatch }
            let sequence = Int(sequenceValue)
            if let identity {
                guard identity == (producerId, producerEpoch),
                      sequence == (previousSequence ?? -1) + 1 else {
                    throw InputTelemetryBatchError.invalidSequence
                }
            } else {
                identity = (producerId, producerEpoch)
            }
            previousSequence = sequence
            result.append(ProducerEvent(
                producerId: producerId,
                producerEpoch: producerEpoch,
                producerSequence: sequence,
                surfaceId: surfaceId,
                kind: kind,
                payload: eventPayload
            ))
        }
        return result
    }

    private static func integer(_ value: Any?) -> Int64? {
        guard let number = value as? NSNumber else { return nil }
        let double = number.doubleValue
        guard double.isFinite, double.rounded(.towardZero) == double,
              double >= 0, double <= Double(Int64.max) else { return nil }
        return Int64(double)
    }

    private static func validIdentifier(_ value: String) -> Bool {
        guard (1...128).contains(value.count) else { return false }
        return value.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) || $0 == "_" || $0 == "-"
        }
    }

    private static func containsPathAuthority(_ value: Any) -> Bool {
        if let dictionary = value as? [String: Any] {
            if dictionary.keys.contains(where: { ["path", "relativePath", "projectRoot"].contains($0) }) {
                return true
            }
            return dictionary.values.contains(where: containsPathAuthority)
        }
        if let array = value as? [Any] { return array.contains(where: containsPathAuthority) }
        return false
    }
}
