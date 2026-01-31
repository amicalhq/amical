import Foundation

// Define the proper event structures that match the TypeScript schemas
struct KeyEventPayload: Codable {
    let key: String?
    let code: String?
    let altKey: Bool?
    let ctrlKey: Bool?
    let shiftKey: Bool?
    let metaKey: Bool?
    let keyCode: Int?
    let fnKeyPressed: Bool?
}

struct HelperEvent: Codable {
    let type: String
    let payload: KeyEventPayload
    let timestamp: String?

    init(type: String, payload: KeyEventPayload, timestamp: String? = nil) {
        self.type = type
        self.payload = payload
        self.timestamp = timestamp
    }
}
