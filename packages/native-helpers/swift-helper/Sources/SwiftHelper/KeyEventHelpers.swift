import CoreGraphics
import Foundation

/// Check whether a keycode is a modifier we track.
func isModifierKeyCode(_ keyCode: Int) -> Bool {
    return modifierKeyCodeSet.contains(keyCode)
}

/// Build a key event payload from the current CGEvent
func buildKeyPayload(keyName: String?, keyCode: Int?, event: CGEvent) -> KeyEventPayload {
    return KeyEventPayload(
        key: keyName,
        code: nil,
        altKey: event.flags.contains(.maskAlternate),
        ctrlKey: event.flags.contains(.maskControl),
        shiftKey: event.flags.contains(.maskShift),
        metaKey: event.flags.contains(.maskCommand),
        keyCode: keyCode,
        fnKeyPressed: ShortcutManager.shared.isModifierPressed(fnKeyCode)
    )
}

/// Emit a helper event to stdout
func emitHelperEvent(
    _ helper: SwiftHelper,
    type: String,
    keyName: String?,
    keyCode: Int?,
    event: CGEvent
) {
    let payload = buildKeyPayload(keyName: keyName, keyCode: keyCode, event: event)
    let helperEvent = HelperEvent(
        type: type,
        payload: payload,
        timestamp: ISO8601DateFormatter().string(from: Date())
    )
    helper.sendKeyEvent(helperEvent)
}

/// Emit synthetic key events for any corrections performed during resync
func emitResyncKeyEvents(
    _ helper: SwiftHelper,
    event: CGEvent,
    resyncResult: KeyResyncResult,
    excluding keyCodeToExclude: Int? = nil
) {
    for keyCode in resyncResult.clearedModifiers {
        if keyCode == keyCodeToExclude { continue }
        emitHelperEvent(helper, type: "keyUp", keyName: nil, keyCode: keyCode, event: event)
    }

    for keyCode in resyncResult.clearedRegularKeys {
        if keyCode == keyCodeToExclude { continue }
        emitHelperEvent(helper, type: "keyUp", keyName: nil, keyCode: keyCode, event: event)
    }
}
