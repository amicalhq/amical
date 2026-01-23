import Foundation

/// macOS CGKeyCode to key name mapping
/// Matches the TypeScript keycode-map.ts for consistency
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

    // Function keys
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
