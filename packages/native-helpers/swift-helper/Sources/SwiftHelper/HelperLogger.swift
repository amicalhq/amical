import Foundation

enum HelperLogger {
    private static let queue = DispatchQueue(label: "com.amical.swifthelper.log", qos: .utility)
    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        return formatter
    }()

    static func logToStderr(_ message: String) {
        let messageCopy = message
        queue.async {
            let timestamp = dateFormatter.string(from: Date())
            let logMessage = "[\(timestamp)] \(messageCopy)\n"
            writeRaw(logMessage)
        }
    }

    static func logRawToStderr(_ message: String) {
        let messageCopy = message
        queue.async {
            writeRaw(messageCopy)
        }
    }

    private static func writeRaw(_ message: String) {
        if let data = message.data(using: .utf8) {
            FileHandle.standardError.write(data)
        }
    }
}
