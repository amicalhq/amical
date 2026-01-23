import CoreGraphics
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

    // ============================================================================
    // IMPORTANT: Fn Key State Tracking
    // ============================================================================
    // We track the Fn key state ourselves via flagsChanged events instead of
    // trusting event.flags.contains(.maskSecondaryFn) on keyDown/keyUp events.
    //
    // WHY: macOS reports UNRELIABLE Fn flag on keyDown events, especially on
    // MacBooks with the Globe/Fn key. The flag can be true even when Fn is NOT
    // pressed, causing arrow keys and other keys to be incorrectly consumed.
    //
    // FIX: We update fnKeyDown only when we receive flagsChanged events (which
    // are reliable for modifier state), and use this tracked state for shortcut
    // matching in shouldConsumeKey().
    // ============================================================================
    private var fnKeyDown: Bool = false

    // ============================================================================
    // Non-Modifier Key State Tracking
    // ============================================================================
    // We track currently pressed non-modifier keys across keyDown/keyUp events.
    // This is necessary for multi-key shortcuts like Shift+A+B where we need to
    // know that 'A' is still held when 'B' is pressed.
    //
    // WARNING: pressedRegularKeys can get stuck if keyUp events are missed
    // (e.g., event tap disabled by timeout, sleep/wake cycles, accessibility
    // permission changes). This will cause shortcuts to stop matching because
    // activeKeys retains extra keys. Consider clearing this state on:
    // - flagsChanged showing all modifiers released
    // - App/tap re-initialization
    // - Sleep/wake notifications
    // ============================================================================
    private var pressedRegularKeys = Set<String>()

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

    /// Update the tracked Fn key state
    /// Called from event tap callback when flagsChanged event is received
    /// We track Fn separately because macOS can report unreliable Fn flag on keyDown events
    func setFnKeyState(_ isDown: Bool) {
        lock.lock()
        defer { lock.unlock() }
        fnKeyDown = isDown
    }

    /// Add a regular (non-modifier) key to the tracked set
    /// Called from event tap callback on keyDown events
    func addRegularKey(_ key: String) {
        lock.lock()
        defer { lock.unlock() }
        pressedRegularKeys.insert(key)
    }

    /// Remove a regular (non-modifier) key from the tracked set
    /// Called from event tap callback on keyUp events
    func removeRegularKey(_ key: String) {
        lock.lock()
        defer { lock.unlock() }
        pressedRegularKeys.remove(key)
    }

    /// Check if a key is actually pressed using CGEventSource
    private func isKeyActuallyPressed(_ keyCode: CGKeyCode) -> Bool {
        return CGEventSource.keyState(.combinedSessionState, key: keyCode)
    }

    /// Validate all tracked key states against actual OS state.
    /// Removes any keys that are not actually pressed (stuck keys).
    /// Returns true if state was valid, false if corrections were made.
    func validateAndResyncKeyState() -> Bool {
        lock.lock()
        defer { lock.unlock() }

        var stateValid = true

        // Validate Fn key state
        // Fn key code is 0x3F (63)
        let fnKeyCode: CGKeyCode = 0x3F
        if fnKeyDown && !isKeyActuallyPressed(fnKeyCode) {
            logToStderr("[ShortcutManager] Resync: Fn key was stuck, clearing")
            fnKeyDown = false
            stateValid = false
        }

        // Validate regular keys
        var staleKeys: [String] = []
        for keyName in pressedRegularKeys {
            if let keyCode = nameToKeyCode(keyName) {
                if !isKeyActuallyPressed(CGKeyCode(keyCode)) {
                    staleKeys.append(keyName)
                }
            }
        }

        if !staleKeys.isEmpty {
            for key in staleKeys {
                pressedRegularKeys.remove(key)
            }
            logToStderr("[ShortcutManager] Resync: Regular keys were stuck, cleared: \(staleKeys)")
            stateValid = false
        }

        return stateValid
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

        // If we can't map this key, don't consume it - prevents unmapped keys
        // (like PageUp, Home) from being incorrectly consumed when a modifier is held
        guard let currentKeyName = keyCodeToName(keyCode) else {
            return false
        }

        // Build set of currently active modifier keys
        // Note: We use tracked fnKeyDown instead of modifiers.fn because macOS
        // can report unreliable Fn flag on keyDown events (especially on MacBooks)
        var activeModifiers = Set<String>()
        if fnKeyDown { activeModifiers.insert("Fn") }
        if modifiers.cmd { activeModifiers.insert("Cmd") }
        if modifiers.ctrl { activeModifiers.insert("Ctrl") }
        if modifiers.alt { activeModifiers.insert("Alt") }
        if modifiers.shift { activeModifiers.insert("Shift") }

        // Build full set of active keys (modifiers + tracked regular keys + current key)
        var activeKeys = activeModifiers
        activeKeys.formUnion(pressedRegularKeys)
        activeKeys.insert(currentKeyName)

        // PTT: consume if building toward the shortcut
        // - At least one modifier from the shortcut must be held (signals intent)
        // - All currently pressed keys must be part of the shortcut (activeKeys ⊆ pttKeys)
        let pttKeys = Set(pushToTalkKeys)
        let pttModifiers = pttKeys.intersection(["Fn", "Cmd", "Ctrl", "Alt", "Shift"])
        let hasRequiredModifier = !pttModifiers.isEmpty && !pttModifiers.isDisjoint(with: activeModifiers)
        let pttMatch = !pttKeys.isEmpty && hasRequiredModifier && activeKeys.isSubset(of: pttKeys)

        // Toggle: exact match (only these keys pressed)
        let toggleKeys = Set(toggleRecordingKeys)
        let toggleMatch = !toggleKeys.isEmpty && toggleKeys == activeKeys

        return pttMatch || toggleMatch
    }
}
