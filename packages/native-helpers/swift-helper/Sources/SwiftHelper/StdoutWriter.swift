import Foundation

enum StdoutWriter {
    private static let queue = DispatchQueue(
        label: "com.amical.swifthelper.stdout",
        qos: .userInteractive
    )

    static func writeEvent(_ event: HelperEvent) {
        queue.async {
            let encoder = JSONEncoder()
            do {
                let jsonData = try encoder.encode(event)
                if let jsonString = String(data: jsonData, encoding: .utf8) {
                    writeLineUnlocked(jsonString)
                }
            } catch {
                HelperLogger.logRawToStderr("Error encoding HelperEvent: \(error)\n")
            }
        }
    }

    static func writeLine(_ line: String) {
        queue.async {
            writeLineUnlocked(line)
        }
    }

    private static func writeLineUnlocked(_ line: String) {
        let payload = line.hasSuffix("\n") ? line : "\(line)\n"
        if let data = payload.data(using: .utf8) {
            FileHandle.standardOutput.write(data)
            fflush(stdout)
        }
    }
}
