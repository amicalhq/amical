/**
 * Shortcut validation utilities
 * Provides comprehensive validation for keyboard shortcuts
 */

import { getKeyFromKeycode } from "./keycode-map";
import {
  MAC_MODIFIER_KEYCODES,
  WINDOWS_MODIFIER_KEYCODES,
  MAC_MODIFIER_PAIRS,
  WINDOWS_MODIFIER_PAIRS,
  MAC_SPECIAL_KEYCODES,
  WINDOWS_SPECIAL_KEYCODES,
  RESERVED_SHORTCUTS_MACOS,
  RESERVED_SHORTCUTS_WINDOWS,
} from "./shortcut-constants";

export type ShortcutType =
  | "pushToTalk"
  | "toggleRecording"
  | "pasteLastTranscript";

export interface ValidationContext {
  candidateShortcut: number[];
  candidateType: ShortcutType;
  shortcutsByType: Record<ShortcutType, number[]>;
  platform: NodeJS.Platform;
}

export interface ValidationResult {
  valid: boolean;
  error?: I18nMessage;
  warning?: I18nMessage;
}

export interface I18nMessage {
  key: string;
  params?: Record<string, string | number>;
}

// Maximum number of keys allowed in a shortcut
const MAX_KEY_COMBINATION_LENGTH = 4;

/**
 * Helper function to compare two sorted arrays
 */
function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, idx) => val === b[idx]);
}

/**
 * Normalize and sort keys for comparison
 */
function normalizeKeys(keys: number[]): number[] {
  return [...keys].sort((a, b) => a - b);
}

function keycodesToDisplayNames(keys: number[]): string[] {
  return keys.map((keycode) => getKeyFromKeycode(keycode) ?? `Key${keycode}`);
}

/**
 * Check if the shortcut has too many keys
 */
export function checkMaxKeysLength(keys: number[]): ValidationResult {
  if (keys.length === 0) {
    return {
      valid: false,
      error: { key: "settings.shortcuts.validation.noKeysDetected" },
    };
  }
  if (keys.length > MAX_KEY_COMBINATION_LENGTH) {
    return {
      valid: false,
      error: {
        key: "settings.shortcuts.validation.tooManyKeys",
        params: { max: MAX_KEY_COMBINATION_LENGTH },
      },
    };
  }
  return { valid: true };
}

/**
 * Check if the shortcut is already assigned to another action
 */
export function checkDuplicateShortcut(
  currentKeys: number[],
  otherShortcuts: number[][],
): ValidationResult {
  if (otherShortcuts.length === 0) return { valid: true };

  const currentNormalized = normalizeKeys(currentKeys);

  for (const otherKeys of otherShortcuts) {
    if (otherKeys.length === 0) continue;
    const otherNormalized = normalizeKeys(otherKeys);
    if (arraysEqual(currentNormalized, otherNormalized)) {
      return {
        valid: false,
        error: { key: "settings.shortcuts.validation.alreadyAssigned" },
      };
    }
  }
  return { valid: true };
}

/**
 * Check if the shortcut conflicts with a system shortcut
 */
export function checkReservedShortcut(
  keys: number[],
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
      const displayShortcut = keycodesToDisplayNames(keys).join("+");
      return {
        valid: false,
        error: {
          key: "settings.shortcuts.validation.conflictsWithSystem",
          params: { shortcut: displayShortcut },
        },
      };
    }
  }
  return { valid: true };
}

/**
 * Check if all keys are alphanumeric (letters, digits, punctuation only)
 * Without a modifier, such shortcuts are not valid
 */
export function checkAlphanumericOnly(
  keys: number[],
  platform: NodeJS.Platform,
): ValidationResult {
  const modifierSet =
    platform === "darwin" ? MAC_MODIFIER_KEYCODES : WINDOWS_MODIFIER_KEYCODES;
  const specialSet =
    platform === "darwin" ? MAC_SPECIAL_KEYCODES : WINDOWS_SPECIAL_KEYCODES;

  // Check if any key is a modifier
  const hasModifier = keys.some((key) => modifierSet.has(key));
  if (hasModifier) {
    return { valid: true };
  }

  // Check if any key is a special key (Space, F1-F24, navigation, etc.)
  const hasSpecialKey = keys.some((key) => specialSet.has(key));
  if (hasSpecialKey) {
    return { valid: true };
  }

  // All keys are alphanumeric - need a modifier
  return {
    valid: false,
    error: { key: "settings.shortcuts.validation.addModifier" },
  };
}

/**
 * Check for duplicate left/right modifier pairs (Windows only)
 * macOS can't distinguish left/right modifiers via its event system
 */
export function checkDuplicateModifierPairs(
  keys: number[],
  platform: NodeJS.Platform,
): ValidationResult {
  const modifierPairs =
    platform === "darwin" ? MAC_MODIFIER_PAIRS : WINDOWS_MODIFIER_PAIRS;

  for (const [left, right] of modifierPairs) {
    if (keys.includes(left) && keys.includes(right)) {
      const baseName = getKeyFromKeycode(left) ?? "modifier";
      return {
        valid: false,
        error: {
          key: "settings.shortcuts.validation.duplicateModifierPairs",
          params: { modifier: baseName },
        },
      };
    }
  }
  return { valid: true };
}

/**
 * Check if toggle shortcut is a subset of PTT shortcut (soft warning)
 */
export function checkSubsetConflict(
  candidateShortcut: number[],
  candidateType: ShortcutType,
  shortcutsByType: Record<ShortcutType, number[]>,
): ValidationResult {
  if (candidateType !== "toggleRecording") return { valid: true };

  const pushToTalkKeys = shortcutsByType.pushToTalk ?? [];
  if (pushToTalkKeys.length === 0 || candidateShortcut.length === 0)
    return { valid: true };

  const toggleNormalized = normalizeKeys(candidateShortcut);
  const pttNormalized = normalizeKeys(pushToTalkKeys);

  // Check if toggle shortcut is a subset of PTT shortcut
  const isSubset = toggleNormalized.every((key) =>
    pttNormalized.some((pttKey) => pttKey === key),
  );

  if (isSubset && toggleNormalized.length < pttNormalized.length) {
    return {
      valid: true, // Still valid, just warning
      warning: { key: "settings.shortcuts.validation.overlapsWithPushToTalk" },
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
  const { candidateShortcut, candidateType, shortcutsByType, platform } =
    context;

  const otherShortcuts = Object.entries(shortcutsByType)
    .filter(([shortcutType]) => shortcutType !== candidateType)
    .map(([, shortcutKeys]) => shortcutKeys);

  // 1. Max keys length check
  const maxKeysCheck = checkMaxKeysLength(candidateShortcut);
  if (!maxKeysCheck.valid) return maxKeysCheck;

  // 2. Duplicate shortcut check
  const duplicateCheck = checkDuplicateShortcut(
    candidateShortcut,
    otherShortcuts,
  );
  if (!duplicateCheck.valid) return duplicateCheck;

  // 3. Reserved shortcut check
  const reservedCheck = checkReservedShortcut(candidateShortcut, platform);
  if (!reservedCheck.valid) return reservedCheck;

  // 4. Alphanumeric-only check
  const alphaCheck = checkAlphanumericOnly(candidateShortcut, platform);
  if (!alphaCheck.valid) return alphaCheck;

  // 5. Duplicate modifier pair check (Windows only)
  const pairCheck = checkDuplicateModifierPairs(candidateShortcut, platform);
  if (!pairCheck.valid) return pairCheck;

  // 6. Subset conflict check (soft warning - returns valid:true with warning)
  const subsetCheck = checkSubsetConflict(
    candidateShortcut,
    candidateType,
    shortcutsByType,
  );

  return {
    valid: true,
    warning: subsetCheck.warning,
  };
}
