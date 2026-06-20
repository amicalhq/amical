import CoreGraphics
import Foundation

struct KeyResyncResult {
    let clearedRegularKeys: [Int]
    let clearedModifiers: [Int]
}

/// Manages configured shortcuts and determines if key events should be consumed
/// Thread-safe singleton that can be updated from IOBridge (background thread)
/// and queried from event tap callback (main thread)
class ShortcutManager {
    static let shared = ShortcutManager()

    // Chords grouped by match rule (see SetShortcutsParamsSchema): subset chords
    // (push-to-talk, draft) consume while building toward the chord; exact chords
    // (toggle/paste/new-note) consume only when exactly held.
    private var subsetChords: [[Int]] = []
    private var exactChords: [[Int]] = []
    private var shortcutKeysSet = Set<Int>()

    // ============================================================================
    // Modifier Key State Tracking (left/right)
    // ============================================================================
    // We track modifier key state via flagsChanged events and keep left/right
    // modifiers distinct (e.g., Shift vs RShift).
    //
    // NOTE: We do NOT trust event.flags on keyDown/keyUp for Fn, and we do not
    // rely on combined modifier state. The helper owns modifier state.
    // ============================================================================
    private var pressedModifierKeys = Set<Int>()
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
    private var pressedRegularKeys = Set<Int>()

    private let lock = NSLock()

    private init() {}

    private func logToStderr(_ message: String) {
        HelperLogger.logToStderr(message)
    }

    /// Update the configured shortcuts
    /// Called from IOBridge when setShortcuts RPC is received
    func setShortcuts(
        subsetChords: [[Int]],
        exactChords: [[Int]]
    ) {
        lock.lock()
        defer { lock.unlock() }
        self.subsetChords = subsetChords
        self.exactChords = exactChords
        self.shortcutKeysSet = Set((subsetChords + exactChords).flatMap { $0 })
        logToStderr(
            "[ShortcutManager] Shortcuts updated - subset: \(subsetChords), exact: \(exactChords)"
        )
    }

    /// Update the tracked modifier key state (left/right)
    /// Called from event tap callback when flagsChanged event is received
    func setModifierKey(_ keyCode: Int, isDown: Bool) {
        lock.lock()
        defer { lock.unlock() }
        if isDown {
            pressedModifierKeys.insert(keyCode)
        } else {
            pressedModifierKeys.remove(keyCode)
        }
    }

    /// Check if a modifier is currently pressed
    func isModifierPressed(_ keyCode: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return pressedModifierKeys.contains(keyCode)
    }

    /// Check if a key is part of any configured shortcut
    func isShortcutKey(_ keyCode: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return shortcutKeysSet.contains(keyCode)
    }

    /// Add a regular (non-modifier) key to the tracked set
    /// Called from event tap callback on keyDown events
    func addRegularKey(_ keyCode: Int) {
        lock.lock()
        defer { lock.unlock() }
        pressedRegularKeys.insert(keyCode)
    }

    /// Remove a regular (non-modifier) key from the tracked set
    /// Called from event tap callback on keyUp events
    func removeRegularKey(_ keyCode: Int) {
        lock.lock()
        defer { lock.unlock() }
        pressedRegularKeys.remove(keyCode)
    }

    /// Check if a non-modifier key is actually pressed using CGEventSource.
    /// Must use .hidSystemState here: our event tap consumes shortcut key events
    /// (returns nil), which removes them from .combinedSessionState. This caused
    /// recheckPressedKeys to see held-but-consumed keys as "not pressed", emitting
    /// false keyUp events that stopped PTT recording mid-speech.
    private func isKeyActuallyPressed(_ keyCode: CGKeyCode) -> Bool {
        return CGEventSource.keyState(.hidSystemState, key: keyCode)
    }

    /// Check provided key codes against OS truth and return any stale entries.
    func getStalePressedKeyCodes(_ keyCodes: [Int]) -> [Int] {
        // Modifiers use .combinedSessionState: they pass through the event tap
        // unconsumed (via flagsChanged), so .combinedSessionState is accurate for
        // them and is more compatible with key remapping software (e.g. Karabiner).
        // Non-modifier keys use isKeyActuallyPressed (.hidSystemState) above.
        let flags = CGEventSource.flagsState(.combinedSessionState)
        var stale: [Int] = []
        for keyCode in keyCodes {
            if let modifierFlag = modifierFlag(for: keyCode) {
                if !flags.contains(modifierFlag) {
                    stale.append(keyCode)
                }
                continue
            }

            if !isKeyActuallyPressed(CGKeyCode(keyCode)) {
                stale.append(keyCode)
            }
        }

        if !stale.isEmpty {
            logToStderr("[ShortcutManager] Recheck: stale keys detected: \(stale)")
        }

        return stale
    }

    // modifierFlag(for:) is defined in ModifierFlagHelpers.swift

    /// Validate all tracked key states against actual OS state.
    /// Removes any keys that are not actually pressed (stuck keys).
    /// Returns details about any corrections performed.
    ///
    /// Modifiers are validated against CGEventSource.flagsState(.combinedSessionState),
    /// NOT the triggering event's flags. Per-event flags are unreliable in both
    /// directions: macOS sets .maskSecondaryFn on function-section keys (arrows,
    /// nav cluster, F-keys) regardless of the physical Fn key, and synthetic or
    /// remapper-reposted events (third-party automation tools, Karabiner's
    /// virtual keyboard) carry whatever flags their creator set — which can
    /// falsely OMIT a genuinely-held modifier. Trusting such an event here would
    /// clear a held Fn and emit a phantom keyUp that stops PTT mid-speech, with
    /// no recovery until the user physically re-presses it. .combinedSessionState
    /// is accurate for modifiers (they pass through the event tap unconsumed)
    /// and is the same source getStalePressedKeyCodes already trusts.
    func validateAndResyncKeyState(
        excluding keyCodeToExclude: Int? = nil
    ) -> KeyResyncResult {
        lock.lock()
        defer { lock.unlock() }

        let flags = CGEventSource.flagsState(.combinedSessionState)
        var clearedModifiers: [Int] = []

        let modifierGroups: [(flag: CGEventFlags, keyCodes: [Int])] = [
            (.maskCommand, [leftCommandKeyCode, rightCommandKeyCode]),
            (.maskControl, [leftControlKeyCode, rightControlKeyCode]),
            (.maskAlternate, [leftOptionKeyCode, rightOptionKeyCode]),
            (.maskShift, [leftShiftKeyCode, rightShiftKeyCode]),
            (.maskSecondaryFn, [fnKeyCode]),
        ]

        // Validate modifier keys using event flags.
        for group in modifierGroups {
            let flagIsSet = flags.contains(group.flag)
            let trackedKeys = group.keyCodes.filter {
                pressedModifierKeys.contains($0) && $0 != keyCodeToExclude
            }

            if !flagIsSet && !trackedKeys.isEmpty {
                for keyCode in trackedKeys {
                    pressedModifierKeys.remove(keyCode)
                    clearedModifiers.append(keyCode)
                }
            }
        }

        if !clearedModifiers.isEmpty {
            logToStderr("[ShortcutManager] Resync: Modifiers were stuck, cleared: \(clearedModifiers)")
        }

        // Validate regular keys
        var staleKeys: [Int] = []
        for keyCode in pressedRegularKeys {
            if keyCode == keyCodeToExclude { continue }
            if !isKeyActuallyPressed(CGKeyCode(keyCode)) {
                staleKeys.append(keyCode)
            }
        }

        if !staleKeys.isEmpty {
            for keyCode in staleKeys {
                pressedRegularKeys.remove(keyCode)
            }
            logToStderr("[ShortcutManager] Resync: Regular keys were stuck, cleared: \(staleKeys)")
        }

        return KeyResyncResult(
            clearedRegularKeys: staleKeys,
            clearedModifiers: clearedModifiers
        )
    }

    /// Check if this key event should be consumed (prevent default behavior)
    /// Called from event tap callback for keyDown/keyUp events only
    func shouldConsumeKey(keyCode: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }

        // Early exit if no shortcuts configured
        if subsetChords.isEmpty && exactChords.isEmpty {
            return false
        }

        // Build set of currently active modifier keys (left/right distinct)
        let activeModifiers = pressedModifierKeys

        // Build full set of active keys (modifiers + tracked regular keys + current key)
        var activeKeys = activeModifiers
        activeKeys.formUnion(pressedRegularKeys)
        activeKeys.insert(keyCode)

        // Subset chords (PTT, draft): consume if building toward the chord.
        // - At least one modifier from the chord must be held (signals intent)
        // - All currently pressed keys must be part of the chord (activeKeys ⊆ chord)
        let subsetMatch = subsetChords.contains { chord in
            let chordKeys = Set(chord)
            let chordModifiers = chordKeys.intersection(modifierKeyCodeSet)
            return !chordKeys.isEmpty
                && !chordModifiers.isEmpty
                && !chordModifiers.isDisjoint(with: activeModifiers)
                && activeKeys.isSubset(of: chordKeys)
        }

        // Exact chords (toggle/paste/new-note): consume only when exactly held.
        let exactMatch = exactChords.contains { chord in
            !chord.isEmpty && Set(chord) == activeKeys
        }

        return subsetMatch || exactMatch
    }
}
