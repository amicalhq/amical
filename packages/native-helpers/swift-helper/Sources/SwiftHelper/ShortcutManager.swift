import Foundation

/// Represents the state of modifier keys at a given moment
struct ModifierState {
    let fn: Bool
    let cmd: Bool
    let ctrl: Bool
    let alt: Bool
    let shift: Bool
}

/// Manages configured shortcuts and determines if key events should be consumed
/// Thread-safe singleton that can be updated from IOBridge (background thread)
/// and queried from event tap callback (main thread)
class ShortcutManager {
    static let shared = ShortcutManager()

    private var pushToTalkKeys: [String] = []
    private var toggleRecordingKeys: [String] = []
    private let lock = NSLock()
    private let dateFormatter: DateFormatter

    private init() {
        self.dateFormatter = DateFormatter()
        self.dateFormatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
    }

    private func logToStderr(_ message: String) {
        let timestamp = dateFormatter.string(from: Date())
        let logMessage = "[\(timestamp)] \(message)\n"
        FileHandle.standardError.write(logMessage.data(using: .utf8)!)
    }

    /// Update the configured shortcuts
    /// Called from IOBridge when setShortcuts RPC is received
    func setShortcuts(pushToTalk: [String], toggleRecording: [String]) {
        lock.lock()
        defer { lock.unlock() }
        self.pushToTalkKeys = pushToTalk
        self.toggleRecordingKeys = toggleRecording
        logToStderr("[ShortcutManager] Shortcuts updated - PTT: \(pushToTalk), Toggle: \(toggleRecording)")
    }

    /// Check if this key event should be consumed (prevent default behavior)
    /// Called from event tap callback for keyDown/keyUp events only
    func shouldConsumeKey(keyCode: Int, modifiers: ModifierState) -> Bool {
        lock.lock()
        defer { lock.unlock() }

        // Early exit if no shortcuts configured
        if pushToTalkKeys.isEmpty && toggleRecordingKeys.isEmpty {
            return false
        }

        // Build set of currently active keys (modifiers + this regular key)
        var activeKeys = Set<String>()
        if modifiers.fn { activeKeys.insert("Fn") }
        if modifiers.cmd { activeKeys.insert("Cmd") }
        if modifiers.ctrl { activeKeys.insert("Ctrl") }
        if modifiers.alt { activeKeys.insert("Alt") }
        if modifiers.shift { activeKeys.insert("Shift") }

        // Add the regular key being pressed
        if let keyName = keyCodeToName(keyCode) {
            activeKeys.insert(keyName)
        }

        // PTT: subset match (all PTT keys pressed, possibly with extras)
        let pttKeys = Set(pushToTalkKeys)
        let pttMatch = !pttKeys.isEmpty && pttKeys.isSubset(of: activeKeys)

        // Toggle: exact match (only these keys pressed)
        let toggleKeys = Set(toggleRecordingKeys)
        let toggleMatch = !toggleKeys.isEmpty && toggleKeys == activeKeys

        return pttMatch || toggleMatch
    }
}
