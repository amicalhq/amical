import Foundation

/// macOS CGKeyCode to key name mapping
/// Matches the TypeScript keycode-map.ts for consistency
///
/// Note: PrintScreen is not standard on macOS keyboards. External keyboards may send it,
/// but it may not have a standard macOS keycode. The fallback mechanism in main.swift
/// will handle unmapped keys (including PrintScreen) by generating a "Key{keycode}" name.
private let macOSKeycodeToKey: [Int: String] = [
    // Letters
    0: "A",
    1: "S",
    2: "D",
    3: "F",
    4: "H",
    5: "G",
    6: "Z",
    7: "X",
    8: "C",
    9: "V",
    11: "B",
    12: "Q",
    13: "W",
    14: "E",
    15: "R",
    16: "Y",
    17: "T",
    31: "O",
    32: "U",
    34: "I",
    35: "P",
    37: "L",
    38: "J",
    40: "K",
    45: "N",
    46: "M",

    // Numbers
    18: "1",
    19: "2",
    20: "3",
    21: "4",
    22: "6",
    23: "5",
    25: "9",
    26: "7",
    28: "8",
    29: "0",

    // Special keys
    48: "Tab",
    49: "Space",
    51: "Delete",
    52: "Enter",
    53: "Escape",
    57: "CapsLock",
    117: "ForwardDelete",  // Forward delete (different from Delete/Backspace)

    // Function keys (F1-F12 - using macOS keycodes)
    122: "F1",
    120: "F2",
    99: "F3",
    118: "F4",
    96: "F5",
    97: "F6",
    98: "F7",
    100: "F8",
    101: "F9",
    109: "F10",
    103: "F11",
    111: "F12",
    
    // Extended function keys (F13-F20)
    105: "F13",
    107: "F14",
    113: "F15",
    106: "F16",
    64: "F17",
    79: "F18",
    80: "F19",
    90: "F20",

    // Navigation keys
    115: "Home",
    116: "PageUp",
    121: "PageDown",
    119: "End",
    114: "Help",

    // Arrow keys
    123: "Left",
    124: "Right",
    125: "Down",
    126: "Up",

    // Punctuation and symbols
    27: "-",
    24: "=",
    33: "[",
    30: "]",
    42: "\\",
    41: ";",
    39: "'",
    43: ",",
    47: ".",
    44: "/",
    50: "`",
    
    // Keypad keys
    65: "KeypadDecimal",
    67: "KeypadMultiply",
    69: "KeypadPlus",
    71: "KeypadClear",
    75: "KeypadDivide",
    76: "KeypadEnter",
    78: "KeypadMinus",
    81: "KeypadEquals",
    82: "Keypad0",
    83: "Keypad1",
    84: "Keypad2",
    85: "Keypad3",
    86: "Keypad4",
    87: "Keypad5",
    88: "Keypad6",
    89: "Keypad7",
    91: "Keypad8",
    92: "Keypad9",
    
    // Media keys
    72: "VolumeUp",
    73: "VolumeDown",
    74: "Mute",
]

/// Reverse lookup: key name to keycode
private let macOSKeyToKeycode: [String: Int] = {
    var reverse: [String: Int] = [:]
    for (keyCode, name) in macOSKeycodeToKey {
        reverse[name] = keyCode
    }
    return reverse
}()

/// Convert a macOS CGKeyCode to a key name string
/// Returns nil if the keycode is not mapped
func keyCodeToName(_ keyCode: Int) -> String? {
    return macOSKeycodeToKey[keyCode]
}

/// Convert a key name string to a macOS CGKeyCode
/// Returns nil if the key name is not mapped
func nameToKeyCode(_ name: String) -> Int? {
    return macOSKeyToKeycode[name]
}
