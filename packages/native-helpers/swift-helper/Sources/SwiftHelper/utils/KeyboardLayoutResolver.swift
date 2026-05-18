import Carbon.HIToolbox
import CoreGraphics
import Foundation

/// Resolves the virtual keycode that, under the active keyboard layout,
/// produces a given Unicode character when held with Cmd.
///
/// Used by paste synthesis. A hardcoded `virtualKey: VK_V` is keycode 9 (the
/// QWERTY 'V' position); under Dvorak that position produces "K" and the
/// synthesized "Cmd+V" lands as Cmd+K in the target app. Chromium-based
/// apps (Chrome, Discord, Electron) make this strict: they read
/// `NSEvent.characters` (the with-Cmd translation), not
/// `charactersIgnoringModifiers`, so the synthesized event must hit the slot
/// whose Cmd-modified output is "v".
///
/// Strategy: ask `UCKeyTranslate` what each keycode produces with Cmd held,
/// against the current input source first, then the ASCII-capable companion
/// as a fallback for non-Latin layouts (Russian, Hebrew, …) where the
/// active layout has no Latin character to match.
enum KeyboardLayoutResolver {
    private static let cmdKeyState = UInt32((cmdKey >> 8) & 0xFF)

    static func keycode(for character: Character) -> CGKeyCode? {
        let providers: [() -> Unmanaged<TISInputSource>?] = [
            TISCopyCurrentKeyboardInputSource,
            TISCopyCurrentASCIICapableKeyboardInputSource,
        ]
        for provider in providers {
            guard let source = provider()?.takeRetainedValue() else { continue }
            if let kc = keycode(for: character, source: source) {
                return kc
            }
        }
        return nil
    }

    private static func keycode(for character: Character, source: TISInputSource) -> CGKeyCode? {
        guard let layoutDataPointer = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else {
            return nil
        }
        let layoutData = Unmanaged<CFData>.fromOpaque(layoutDataPointer).takeUnretainedValue()
        guard let layoutBytes = CFDataGetBytePtr(layoutData) else {
            return nil
        }
        let layout = UnsafeRawPointer(layoutBytes).assumingMemoryBound(to: UCKeyboardLayout.self)

        // Menu key-equivalents compare in lowercase form.
        guard let target = String(character).lowercased().utf16.first else {
            return nil
        }
        let kbdType = UInt32(LMGetKbdType())

        var deadKeyState: UInt32 = 0
        var chars = [UniChar](repeating: 0, count: 4)
        var length = 0

        for kc in 0..<128 {
            deadKeyState = 0
            length = 0
            let status = UCKeyTranslate(
                layout,
                UInt16(kc),
                UInt16(kUCKeyActionDisplay),
                cmdKeyState,
                kbdType,
                OptionBits(kUCKeyTranslateNoDeadKeysBit),
                &deadKeyState,
                chars.count,
                &length,
                &chars
            )
            guard status == noErr, length == 1, chars[0] == target else { continue }
            return CGKeyCode(kc)
        }
        return nil
    }
}
