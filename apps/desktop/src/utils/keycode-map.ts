import { isWindows } from "./platform";

// macOS keycode mappings
const macOSKeycodeToKey: Record<number, string> = {
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
};

// Windows Virtual Key code mappings
const windowsVKToKey: Record<number, string> = {
  // Mouse buttons (0x01-0x06)
  0x01: "LButton",
  0x02: "RButton",
  0x04: "MButton",
  0x05: "XButton1",
  0x06: "XButton2",

  // Standard keys
  0x08: "Backspace",
  0x09: "Tab",
  0x0c: "Clear",
  0x0d: "Enter",
  0x10: "Shift",
  0x11: "Ctrl",
  0x12: "Alt",
  0x13: "Pause",
  0x14: "CapsLock",
  0x1b: "Escape",
  0x20: "Space",
  0x21: "PageUp",
  0x22: "PageDown",
  0x23: "End",
  0x24: "Home",
  0x25: "Left",
  0x26: "Up",
  0x27: "Right",
  0x28: "Down",
  0x29: "Select",
  0x2a: "Print",
  0x2b: "Execute",
  0x2c: "PrintScreen",
  0x2d: "Insert",
  0x2e: "Delete",
  0x2f: "Help",

  // Numbers (0-9)
  0x30: "0",
  0x31: "1",
  0x32: "2",
  0x33: "3",
  0x34: "4",
  0x35: "5",
  0x36: "6",
  0x37: "7",
  0x38: "8",
  0x39: "9",

  // Letters (A-Z)
  0x41: "A",
  0x42: "B",
  0x43: "C",
  0x44: "D",
  0x45: "E",
  0x46: "F",
  0x47: "G",
  0x48: "H",
  0x49: "I",
  0x4a: "J",
  0x4b: "K",
  0x4c: "L",
  0x4d: "M",
  0x4e: "N",
  0x4f: "O",
  0x50: "P",
  0x51: "Q",
  0x52: "R",
  0x53: "S",
  0x54: "T",
  0x55: "U",
  0x56: "V",
  0x57: "W",
  0x58: "X",
  0x59: "Y",
  0x5a: "Z",

  // Windows keys
  0x5b: "LWin",
  0x5c: "RWin",
  0x5d: "Apps",
  0x5f: "Sleep",

  // Numpad
  0x60: "Numpad0",
  0x61: "Numpad1",
  0x62: "Numpad2",
  0x63: "Numpad3",
  0x64: "Numpad4",
  0x65: "Numpad5",
  0x66: "Numpad6",
  0x67: "Numpad7",
  0x68: "Numpad8",
  0x69: "Numpad9",
  0x6a: "Multiply",
  0x6b: "Add",
  0x6c: "Separator",
  0x6d: "Subtract",
  0x6e: "Decimal",
  0x6f: "Divide",

  // Function keys (F1-F24)
  0x70: "F1",
  0x71: "F2",
  0x72: "F3",
  0x73: "F4",
  0x74: "F5",
  0x75: "F6",
  0x76: "F7",
  0x77: "F8",
  0x78: "F9",
  0x79: "F10",
  0x7a: "F11",
  0x7b: "F12",
  0x7c: "F13",
  0x7d: "F14",
  0x7e: "F15",
  0x7f: "F16",
  0x80: "F17",
  0x81: "F18",
  0x82: "F19",
  0x83: "F20",
  0x84: "F21",
  0x85: "F22",
  0x86: "F23",
  0x87: "F24",

  // Other keys
  0x90: "NumLock",
  0x91: "ScrollLock",
  0xa0: "LShift",
  0xa1: "RShift",
  0xa2: "LCtrl",
  0xa3: "RCtrl",
  0xa4: "LAlt",
  0xa5: "RAlt",

  // Browser control keys
  0xa6: "BrowserBack",
  0xa7: "BrowserForward",
  0xa8: "BrowserRefresh",
  0xa9: "BrowserStop",
  0xaa: "BrowserSearch",
  0xab: "BrowserFavorites",
  0xac: "BrowserHome",

  // Volume control keys
  0xad: "VolumeMute",
  0xae: "VolumeDown",
  0xaf: "VolumeUp",

  // Media control keys
  0xb0: "MediaNextTrack",
  0xb1: "MediaPrevTrack",
  0xb2: "MediaStop",
  0xb3: "MediaPlayPause",

  // Launch keys
  0xb4: "LaunchMail",
  0xb5: "LaunchMediaSelect",
  0xb6: "LaunchApp1",
  0xb7: "LaunchApp2",

  // OEM keys (punctuation and symbols)
  0xba: ";", // OEM_1
  0xbb: "=", // OEM_PLUS
  0xbc: ",", // OEM_COMMA
  0xbd: "-", // OEM_MINUS
  0xbe: ".", // OEM_PERIOD
  0xbf: "/", // OEM_2
  0xc0: "`", // OEM_3
  0xdb: "[", // OEM_4
  0xdc: "\\", // OEM_5
  0xdd: "]", // OEM_6
  0xde: "'", // OEM_7
  0xdf: "OEM_8",

  // Additional keys
  0xe1: "OEM_AX",
  0xe2: "OEM_102",
  0xe3: "ICOHelp",
  0xe4: "ICO00",
  0xe5: "ProcessKey",
  0xe6: "ICOClear",
  0xe7: "Packet",
};

// Export the appropriate mapping based on platform
export const keycodeToKey: Record<number, string> = isWindows()
  ? windowsVKToKey
  : macOSKeycodeToKey;

export function getKeyFromKeycode(keycode: number): string | undefined {
  // Use the appropriate mapping based on platform
  const mapping = isWindows() ? windowsVKToKey : macOSKeycodeToKey;
  return mapping[keycode];
}

export function matchesShortcutKey(
  keycode: number | undefined,
  keyName: string,
): boolean {
  if (keycode === undefined) return false;

  const mappedKey = getKeyFromKeycode(keycode);
  if (!mappedKey) return false;

  // Normalize Windows modifier key names for comparison
  const normalizedMappedKey = normalizeKeyName(mappedKey);
  const normalizedKeyName = normalizeKeyName(keyName);

  return normalizedMappedKey.toUpperCase() === normalizedKeyName.toUpperCase();
}

export function getKeyNameFromPayload(payload: {
  key?: string;
  keyCode?: number;
}): string | undefined {
  // Try to get key name from various sources
  if (payload.key) return payload.key;
  if (payload.keyCode !== undefined) {
    const keyName = getKeyFromKeycode(payload.keyCode);
    if (keyName) {
      // Normalize key names for consistency across platforms
      return normalizeKeyName(keyName);
    }
  }
  return undefined;
}

// Helper function to normalize key names across platforms
function normalizeKeyName(keyName: string): string {
  // Normalize left/right variants to single names
  const normalizations: Record<string, string> = {
    LWin: "Win",
    RWin: "Win",
    LShift: "Shift",
    RShift: "Shift",
    LCtrl: "Ctrl",
    RCtrl: "Ctrl",
    LAlt: "Alt",
    RAlt: "Alt",
    // Keep other keys as-is
  };

  return normalizations[keyName] || keyName;
}
