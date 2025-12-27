/**
 * Shortcut validation utilities
 * Provides comprehensive validation for keyboard shortcuts
 */

export type ShortcutType = "pushToTalk" | "toggleRecording";

export interface ValidationContext {
  currentShortcut: string[];
  otherShortcut: string[];
  shortcutType: ShortcutType;
  platform: NodeJS.Platform;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

// Maximum number of keys allowed in a shortcut
const MAX_KEY_COMBINATION_LENGTH = 4;

// Keys considered modifiers
const MODIFIER_KEYS = ["Cmd", "Win", "Ctrl", "Alt", "Shift", "Fn"];

// Left/right modifier pairs (for duplicate modifier detection)
const MODIFIER_PAIRS: [string, string][] = [
  ["LShift", "RShift"],
  ["LCtrl", "RCtrl"],
  ["LAlt", "RAlt"],
  ["LCmd", "RCmd"],
  ["LWin", "RWin"],
];

// Keys that are valid on their own (not alphanumeric)
const SPECIAL_KEYS = [
  "Space",
  "Tab",
  "Enter",
  "Escape",
  "Delete",
  "Backspace",
  "Up",
  "Down",
  "Left",
  "Right",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
  "F13",
  "F14",
  "F15",
  "F16",
  "F17",
  "F18",
  "F19",
  "F20",
  "F21",
  "F22",
  "F23",
  "F24",
];

// macOS reserved shortcuts
const RESERVED_SHORTCUTS_MACOS: string[][] = [
  // Clipboard
  ["Cmd", "C"],
  ["Cmd", "V"],
  ["Cmd", "X"],
  ["Cmd", "Z"],
  ["Cmd", "Shift", "Z"],
  // Window/App management
  ["Cmd", "Q"],
  ["Cmd", "W"],
  ["Cmd", "M"],
  ["Cmd", "H"],
  ["Cmd", "Tab"],
  ["Cmd", "Space"],
  // Screenshots
  ["Cmd", "Shift", "3"],
  ["Cmd", "Shift", "4"],
  ["Cmd", "Shift", "5"],
  // Mission Control
  ["Ctrl", "Up"],
  ["Ctrl", "Down"],
  ["Ctrl", "Left"],
  ["Ctrl", "Right"],
  // File operations
  ["Cmd", "N"],
  ["Cmd", "O"],
  ["Cmd", "S"],
  ["Cmd", "P"],
  // Edit
  ["Cmd", "A"],
  ["Cmd", "F"],
  ["Cmd", "G"],
  ["Cmd", "Shift", "G"],
  ["Cmd", "R"],
  // Text formatting
  ["Cmd", "B"],
  ["Cmd", "I"],
  ["Cmd", "U"],
  // Navigation
  ["Cmd", "Left"],
  ["Cmd", "Right"],
  ["Cmd", "Up"],
  ["Cmd", "Down"],
  // Selection
  ["Cmd", "Shift", "Left"],
  ["Cmd", "Shift", "Right"],
  ["Cmd", "Shift", "Up"],
  ["Cmd", "Shift", "Down"],
  // System
  ["Cmd", "Alt", "Escape"],
  // Delete
  ["Cmd", "Backspace"],
  ["Alt", "Backspace"],
  ["Alt", "Delete"],
  // Tabs
  ["Cmd", "T"],
  ["Cmd", "Shift", "T"],
  // Zoom
  ["Cmd", "="],
  ["Cmd", "-"],
  // Other common
  ["Cmd", ","],
];

// Windows reserved shortcuts
const RESERVED_SHORTCUTS_WINDOWS: string[][] = [
  // Clipboard
  ["Ctrl", "C"],
  ["Ctrl", "V"],
  ["Ctrl", "X"],
  ["Ctrl", "Z"],
  ["Ctrl", "Y"],
  // Window/App management
  ["Alt", "Tab"],
  ["Alt", "F4"],
  ["F11"],
  // File operations
  ["Ctrl", "N"],
  ["Ctrl", "O"],
  ["Ctrl", "S"],
  ["Ctrl", "P"],
  ["Ctrl", "T"],
  ["Ctrl", "W"],
  // Edit
  ["Ctrl", "A"],
  ["Ctrl", "F"],
  ["Ctrl", "G"],
  ["Ctrl", "R"],
  ["F5"],
  // Text formatting
  ["Ctrl", "B"],
  ["Ctrl", "I"],
  ["Ctrl", "U"],
  // Navigation
  ["Home"],
  ["End"],
  ["Ctrl", "Home"],
  ["Ctrl", "End"],
  ["Alt", "Left"],
  ["Alt", "Right"],
  // Selection
  ["Shift", "Home"],
  ["Shift", "End"],
  ["Ctrl", "Shift", "Home"],
  ["Ctrl", "Shift", "End"],
  // System
  ["Ctrl", "Alt", "Delete"],
  ["Ctrl", "Shift", "Escape"],
  // Windows key shortcuts
  ["Win", "E"],
  ["Win", "R"],
  ["Win", "L"],
  ["Win", "D"],
  ["Win", "Tab"],
  ["Win", "I"],
  ["Win", "S"],
  ["Win", "X"],
  ["Win", "P"],
  ["Win", "Up"],
  ["Win", "Down"],
  ["Win", "Q"],
  // Delete
  ["Ctrl", "Backspace"],
  ["Ctrl", "Delete"],
  // Tabs
  ["Ctrl", "Shift", "T"],
  // Zoom
  ["Ctrl", "="],
  ["Ctrl", "-"],
  // Other
  ["Ctrl", "K"],
];

/**
 * Helper function to compare two sorted arrays
 */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, idx) => val.toUpperCase() === b[idx].toUpperCase());
}

/**
 * Normalize and sort keys for comparison
 */
function normalizeKeys(keys: string[]): string[] {
  return keys.map((k) => k.toUpperCase()).sort();
}

/**
 * Check if the shortcut has too many keys
 */
export function checkMaxKeysLength(keys: string[]): ValidationResult {
  if (keys.length === 0) {
    return { valid: false, error: "No keys detected" };
  }
  if (keys.length > MAX_KEY_COMBINATION_LENGTH) {
    return {
      valid: false,
      error: `Too many keys - use ${MAX_KEY_COMBINATION_LENGTH} or fewer`,
    };
  }
  return { valid: true };
}

/**
 * Check if the shortcut is already assigned to another action
 */
export function checkDuplicateShortcut(
  currentKeys: string[],
  otherKeys: string[],
): ValidationResult {
  if (otherKeys.length === 0) return { valid: true };

  const currentNormalized = normalizeKeys(currentKeys);
  const otherNormalized = normalizeKeys(otherKeys);

  if (arraysEqual(currentNormalized, otherNormalized)) {
    return {
      valid: false,
      error: "Shortcut already assigned to another action",
    };
  }
  return { valid: true };
}

/**
 * Check if the shortcut conflicts with a system shortcut
 */
export function checkReservedShortcut(
  keys: string[],
  platform: NodeJS.Platform,
): ValidationResult {
  const reserved =
    platform === "darwin"
      ? RESERVED_SHORTCUTS_MACOS
      : RESERVED_SHORTCUTS_WINDOWS;

  const normalizedKeys = normalizeKeys(keys);

  for (const reservedShortcut of reserved) {
    const normalizedReserved = normalizeKeys(reservedShortcut);
    if (arraysEqual(normalizedKeys, normalizedReserved)) {
      const displayShortcut = keys.join("+");
      return {
        valid: false,
        error: `${displayShortcut} conflicts with a system shortcut`,
      };
    }
  }
  return { valid: true };
}

/**
 * Check if all keys are alphanumeric (letters, digits, punctuation only)
 * Without a modifier, such shortcuts are not valid
 */
export function checkAlphanumericOnly(keys: string[]): ValidationResult {
  // Check if any key is a modifier
  const hasModifier = keys.some((key) => MODIFIER_KEYS.includes(key));
  if (hasModifier) {
    return { valid: true };
  }

  // Check if any key is a special key (Space, F1-F24, navigation, etc.)
  const hasSpecialKey = keys.some((key) => SPECIAL_KEYS.includes(key));
  if (hasSpecialKey) {
    return { valid: true };
  }

  // All keys are alphanumeric - need a modifier
  return {
    valid: false,
    error: "Add a modifier key like Cmd, Ctrl, or Fn",
  };
}

/**
 * Check for duplicate left/right modifier pairs (Windows only)
 * macOS can't distinguish left/right modifiers via its event system
 */
export function checkDuplicateModifierPairs(
  keys: string[],
  platform: NodeJS.Platform,
): ValidationResult {
  // Only applies to Windows
  if (platform === "darwin") {
    return { valid: true };
  }

  for (const [left, right] of MODIFIER_PAIRS) {
    if (keys.includes(left) && keys.includes(right)) {
      // Extract base modifier name (remove L/R prefix)
      const baseName = left.substring(1);
      return {
        valid: false,
        error: `Can't use both left and right ${baseName} together`,
      };
    }
  }
  return { valid: true };
}

/**
 * Check if toggle shortcut is a subset of PTT shortcut (soft warning)
 * Only warns when setting toggleRecording
 */
export function checkSubsetConflict(
  currentKeys: string[],
  otherKeys: string[],
  shortcutType: ShortcutType,
): ValidationResult {
  // Only warn when setting toggleRecording
  if (shortcutType !== "toggleRecording") return { valid: true };
  if (otherKeys.length === 0 || currentKeys.length === 0)
    return { valid: true };

  const toggleNormalized = normalizeKeys(currentKeys);
  const pttNormalized = normalizeKeys(otherKeys);

  // Check if toggle shortcut is a subset of PTT shortcut
  const isSubset = toggleNormalized.every((key) =>
    pttNormalized.some((pttKey) => pttKey === key),
  );

  if (isSubset && toggleNormalized.length < pttNormalized.length) {
    return {
      valid: true, // Still valid, just warning
      warning:
        "This overlaps with your Push-to-talk shortcut and may cause issues",
    };
  }

  return { valid: true };
}

/**
 * Run all validation checks in order
 * Returns first error found, or warning if all pass
 */
export function validateShortcutComprehensive(
  context: ValidationContext,
): ValidationResult {
  const { currentShortcut, otherShortcut, shortcutType, platform } = context;

  // 1. Max keys length check
  const maxKeysCheck = checkMaxKeysLength(currentShortcut);
  if (!maxKeysCheck.valid) return maxKeysCheck;

  // 2. Duplicate shortcut check
  const duplicateCheck = checkDuplicateShortcut(currentShortcut, otherShortcut);
  if (!duplicateCheck.valid) return duplicateCheck;

  // 3. Reserved shortcut check
  const reservedCheck = checkReservedShortcut(currentShortcut, platform);
  if (!reservedCheck.valid) return reservedCheck;

  // 4. Alphanumeric-only check
  const alphaCheck = checkAlphanumericOnly(currentShortcut);
  if (!alphaCheck.valid) return alphaCheck;

  // 5. Duplicate modifier pair check (Windows only)
  const pairCheck = checkDuplicateModifierPairs(currentShortcut, platform);
  if (!pairCheck.valid) return pairCheck;

  // 6. Subset conflict check (soft warning - returns valid:true with warning)
  const subsetCheck = checkSubsetConflict(
    currentShortcut,
    otherShortcut,
    shortcutType,
  );

  return {
    valid: true,
    warning: subsetCheck.warning,
  };
}
