// macOS keycode mappings
export const keycodeToKey: Record<number, string> = {
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

export function getKeyFromKeycode(keycode: number): string | undefined {
  return keycodeToKey[keycode];
}

export function matchesShortcutKey(
  keycode: number | undefined,
  keyName: string,
): boolean {
  if (keycode === undefined) return false;

  const mappedKey = keycodeToKey[keycode];
  if (!mappedKey) return false;

  return mappedKey.toUpperCase() === keyName.toUpperCase();
}

export function getKeyNameFromPayload(payload: any): string | undefined {
  // Try to get key name from various sources
  if (payload.key) return payload.key;
  if (payload.keyCode !== undefined && keycodeToKey[payload.keyCode]) {
    return keycodeToKey[payload.keyCode];
  }
  return undefined;
}
