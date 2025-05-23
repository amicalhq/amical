import Foundation

/**
 A type-erased wrapper for any `Codable` value.
 
 This is useful for decoding and encoding JSON where the type of a value is not known statically,
 or can be one of several types.
 */
public struct AnyCodable: Codable {
    public let value: Any

    public init<T>(_ value: T?) {
        self.value = value ?? ()
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self.value = () // Represent nil or null as an empty tuple or a specific marker
        } else if let bool = try? container.decode(Bool.self) {
            self.value = bool
        } else if let int = try? container.decode(Int.self) {
            self.value = int
        } else if let double = try? container.decode(Double.self) {
            self.value = double
        } else if let string = try? container.decode(String.self) {
            self.value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            self.value = array.map { $0.value }
        } else if let dictionary = try? container.decode([String: AnyCodable].self) {
            self.value = dictionary.mapValues { $0.value }
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "AnyCodable value cannot be decoded")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch value {
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dictionary as [String: Any]:
            try container.encode(dictionary.mapValues { AnyCodable($0) })
        case Optional<Any>.none: // Handles nil
            try container.encodeNil()
        case is (): // Handles the empty tuple used for nil in init(from:)
            try container.encodeNil()
        default:
            // For other Codable types, attempt to encode them directly if possible,
            // or throw an error if they are not directly encodable this way.
            // This basic AnyCodable might need extension for custom objects not fitting above.
            // A common approach is to require T to be Encodable in init or have specific handling.
            // For simplicity, this example focuses on JSON primitives, arrays, and dictionaries.
            throw EncodingError.invalidValue(value, EncodingError.Context(codingPath: container.codingPath, debugDescription: "AnyCodable value cannot be encoded"))
        }
    }
}

// Helper to get underlying data if it's a dictionary or array, for re-decoding
extension AnyCodable {
    func jsonData() throws -> Data {
        return try JSONSerialization.data(withJSONObject: self.value, options: [])
    }
}
