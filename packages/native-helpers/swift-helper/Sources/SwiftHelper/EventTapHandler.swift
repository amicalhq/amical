import ApplicationServices
import CoreGraphics
import Foundation

// Function to handle the event tap
func eventTapCallback(
    proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard let refcon = refcon else {
        return Unmanaged.passRetained(event)
    }
    let anInstance = Unmanaged<SwiftHelper>.fromOpaque(refcon).takeUnretainedValue()

    if type == .keyDown || type == .keyUp {
        let shouldConsume = handleKeyEvent(anInstance, type: type, event: event)
        return shouldConsume ? nil : Unmanaged.passRetained(event)
    } else if type == .flagsChanged {
        handleFlagsChangedEvent(anInstance, event: event)
    } else if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        handleTapDisabledEvent(anInstance)
    }

    return Unmanaged.passRetained(event)
}

private func handleKeyEvent(_ helper: SwiftHelper, type: CGEventType, event: CGEvent) -> Bool {
    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
    let eventTypeString = (type == .keyDown) ? "keyDown" : "keyUp"

    // Modifiers are handled via flagsChanged to preserve left/right identity
    if isModifierKeyCode(Int(keyCode)) {
        return false
    }

    // Track regular key state for multi-key shortcuts
    // We need to track which non-modifier keys are held down so that
    // shortcuts like Shift+A+B can work properly
    if type == .keyUp {
        ShortcutManager.shared.removeRegularKey(Int(keyCode))
    }

    if ShortcutManager.shared.isShortcutKey(Int(keyCode)) {
        let excludeKeyCode = Int(keyCode)
        let resyncResult = ShortcutManager.shared.validateAndResyncKeyState(
            flags: event.flags,
            excluding: excludeKeyCode
        )
        emitResyncKeyEvents(helper, event: event, resyncResult: resyncResult, excluding: excludeKeyCode)
    }

    // Emit the current key event
    emitHelperEvent(helper, type: eventTypeString, keyName: nil, keyCode: Int(keyCode), event: event)

    if type == .keyDown {
        ShortcutManager.shared.addRegularKey(Int(keyCode))
    }

    // Check if this key event matches a configured shortcut and should be consumed
    return ShortcutManager.shared.shouldConsumeKey(keyCode: Int(keyCode))
}

private func handleFlagsChangedEvent(_ helper: SwiftHelper, event: CGEvent) {
    // Handle modifier state changes (like Fn/Cmd/Ctrl/Alt/Shift)
    // Modifier-only events always pass through - they don't cause unwanted behavior on their own
    let keyCode = Int(event.getIntegerValueField(.keyboardEventKeycode))
    guard isModifierKeyCode(keyCode) else {
        return
    }

    // ====================================================================
    // IMPORTANT: Track modifier state via flagsChanged (NOT keyDown flags)
    // ====================================================================
    // macOS reports UNRELIABLE .maskSecondaryFn on keyDown events,
    // especially on MacBooks. The flag can be TRUE even when Fn is NOT
    // pressed! flagsChanged events are reliable, so we track modifier state
    // here and use it in ShortcutManager.shouldConsumeKey().
    // See ShortcutManager.swift for more details.
    // ====================================================================
    guard let flag = modifierFlag(for: keyCode) else {
        return
    }

    let isDown = event.flags.contains(flag)
    let wasDown = ShortcutManager.shared.isModifierPressed(keyCode)
    if wasDown == isDown {
        return
    }

    if ShortcutManager.shared.isShortcutKey(keyCode) {
        let resyncResult = ShortcutManager.shared.validateAndResyncKeyState(
            flags: event.flags,
            excluding: keyCode
        )
        emitResyncKeyEvents(helper, event: event, resyncResult: resyncResult, excluding: keyCode)
    }

    let updatedWasDown = ShortcutManager.shared.isModifierPressed(keyCode)
    if updatedWasDown == isDown {
        return
    }

    ShortcutManager.shared.setModifierKey(keyCode, isDown: isDown)

    let eventTypeString = isDown ? "keyDown" : "keyUp"
    emitHelperEvent(helper, type: eventTypeString, keyName: nil, keyCode: keyCode, event: event)
}

private func handleTapDisabledEvent(_ helper: SwiftHelper) {
    // Re-enable the tap if it times out or is disabled by user input
    if let tap = helper.eventTap {
        CGEvent.tapEnable(tap: tap, enable: true)
    }
}

