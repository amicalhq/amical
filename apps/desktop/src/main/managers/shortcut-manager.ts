import { EventEmitter } from "events";
import { globalShortcut } from "electron";
import { SettingsService } from "@/services/settings-service";
import { NativeBridge } from "@/services/platform/native-bridge-service";
import { KeyEventPayload, HelperEvent } from "@amical/types";
import { logger } from "@/main/logger";
import { getKeyFromKeycode } from "@/utils/keycode-map";
import {
  validateShortcutComprehensive,
  type ShortcutType,
  type ValidationResult,
} from "@/utils/shortcut-validation";

const log = logger.main;
const PRESSED_KEYS_RECHECK_INTERVAL_MS = 10000;

interface KeyInfo {
  keyCode: number;
  timestamp: number;
}

interface ShortcutConfig {
  pushToTalk: number[];
  toggleRecording: number[];
  pasteLastTranscript: number[];
  newNote: number[];
}

export class ShortcutManager extends EventEmitter {
  private activeKeys = new Map<number, KeyInfo>();
  private shortcuts: ShortcutConfig = {
    pushToTalk: [],
    toggleRecording: [],
    pasteLastTranscript: [],
    newNote: [],
  };
  private settingsService: SettingsService;
  private nativeBridge: NativeBridge;
  private isRecordingShortcut: boolean = false;
  private recheckInFlight = false;
  private recheckInterval: NodeJS.Timeout | null = null;
  private exactMatchState = {
    toggleRecording: false,
    pasteLastTranscript: false,
    newNote: false,
  };

  // PTT activates on an exact match but stays active while every PTT key remains
  // held (subset). This hysteresis keeps a transient extra key — e.g. the Space
  // that upgrades PTT→toggle — from dropping and re-asserting PTT, which would
  // fire a phantom press and stop a hands-free session.
  private pttActive = false;

  constructor(settingsService: SettingsService, nativeBridge: NativeBridge) {
    super();
    this.settingsService = settingsService;
    this.nativeBridge = nativeBridge;
  }

  async initialize() {
    await this.loadShortcuts();
    this.syncShortcutsToNative(); // fire-and-forget
    this.setupEventListeners();
    this.startPeriodicRecheck();
  }

  private async loadShortcuts() {
    try {
      const shortcuts = await this.settingsService.getShortcuts();
      this.shortcuts = shortcuts;
      log.info("Shortcuts loaded", { shortcuts });
    } catch (error) {
      log.error("Failed to load shortcuts", { error });
    }
  }

  /**
   * Sync the configured shortcuts to the native helper for key consumption.
   * This tells the native helper which key combinations to consume
   * (prevent default behavior like cursor movement for arrow keys).
   */
  private async syncShortcutsToNative() {
    try {
      await this.nativeBridge.setShortcuts({
        pushToTalk: this.shortcuts.pushToTalk,
        toggleRecording: this.shortcuts.toggleRecording,
        pasteLastTranscript: this.shortcuts.pasteLastTranscript,
        newNote: this.shortcuts.newNote,
      });
      log.info("Shortcuts synced to native helper");
    } catch (error) {
      log.error("Failed to sync shortcuts to native helper", { error });
    }
  }

  async reloadShortcuts() {
    await this.loadShortcuts();
    this.syncShortcutsToNative(); // fire-and-forget
  }

  /**
   * Recheck currently pressed keys against OS truth.
   * Clears stale keys locally to avoid stuck states.
   */
  async recheckPressedKeys(): Promise<void> {
    if (this.recheckInFlight) {
      return;
    }

    const pressedKeyCodes = this.getActiveKeys();
    if (pressedKeyCodes.length === 0) {
      return;
    }

    const requestStartedAt = Date.now();
    this.recheckInFlight = true;

    try {
      const result = await this.nativeBridge.recheckPressedKeys({
        pressedKeyCodes,
      });
      const staleKeyCodes = result.staleKeyCodes ?? [];
      if (staleKeyCodes.length === 0) {
        return;
      }

      const keysToClear: number[] = [];
      for (const keyCode of staleKeyCodes) {
        const keyInfo = this.activeKeys.get(keyCode);
        if (!keyInfo) continue;
        if (keyInfo.timestamp > requestStartedAt) {
          continue;
        }
        keysToClear.push(keyCode);
      }

      if (keysToClear.length === 0) {
        return;
      }

      this.removeActiveKeys(keysToClear);
      log.info("Cleared stale pressed keys after recheck", {
        staleKeyCodes: keysToClear,
      });
    } catch (error) {
      log.warn("Failed to recheck pressed keys", { error });
    } finally {
      this.recheckInFlight = false;
    }
  }

  /**
   * Set a shortcut with full validation.
   * Validates, persists, updates internal state, and syncs to native.
   */
  async setShortcut(
    type: ShortcutType,
    keys: number[],
  ): Promise<ValidationResult> {
    // Validate the shortcut
    const result = validateShortcutComprehensive({
      candidateShortcut: keys,
      candidateType: type,
      shortcutsByType: this.shortcuts,
      platform: process.platform,
    });

    if (!result.valid) {
      return result;
    }

    // Persist to settings
    const updatedShortcuts = {
      ...this.shortcuts,
      [type]: keys,
    };
    await this.settingsService.setShortcuts(updatedShortcuts);

    // Update internal state
    this.shortcuts = updatedShortcuts;
    log.info("Shortcut updated", { type, keys });

    // Sync to native helper
    await this.syncShortcutsToNative();

    return result;
  }

  setIsRecordingShortcut(isRecording: boolean) {
    this.isRecordingShortcut = isRecording;
    if (isRecording) {
      this.exactMatchState.toggleRecording = false;
      this.exactMatchState.pasteLastTranscript = false;
      this.exactMatchState.newNote = false;
      this.pttActive = false;
    }
    log.info("Shortcut recording state changed", { isRecording });
  }

  private setupEventListeners() {
    this.nativeBridge.on("helperEvent", (event: HelperEvent) => {
      switch (event.type) {
        case "keyDown":
          this.handleKeyDown(event.payload);
          break;
        case "keyUp":
          this.handleKeyUp(event.payload);
          break;
      }
    });
  }

  private startPeriodicRecheck() {
    if (this.recheckInterval) {
      return;
    }

    this.recheckInterval = setInterval(() => {
      void this.recheckPressedKeys();
    }, PRESSED_KEYS_RECHECK_INTERVAL_MS);
  }

  private stopPeriodicRecheck() {
    if (!this.recheckInterval) {
      return;
    }
    clearInterval(this.recheckInterval);
    this.recheckInterval = null;
  }

  private handleKeyDown(payload: KeyEventPayload) {
    const keyCode = this.getKeycodeFromPayload(payload);
    if (!this.isKnownKeycode(keyCode)) {
      return;
    }
    this.addActiveKey(keyCode);
  }

  private handleKeyUp(payload: KeyEventPayload) {
    const keyCode = this.getKeycodeFromPayload(payload);
    if (!this.isKnownKeycode(keyCode)) {
      return;
    }
    this.removeActiveKey(keyCode);
  }

  private addActiveKey(keyCode: number) {
    const wasActive = this.activeKeys.has(keyCode);
    this.activeKeys.set(keyCode, { keyCode, timestamp: Date.now() });
    if (!wasActive) {
      this.emitActiveKeysChanged();
      this.checkShortcuts(true);
    }
  }

  private removeActiveKey(keyCode: number) {
    if (this.activeKeys.delete(keyCode)) {
      this.emitActiveKeysChanged();
      this.checkShortcuts(false);
    }
  }

  private removeActiveKeys(keyCodes: number[]) {
    let changed = false;
    for (const keyCode of keyCodes) {
      if (this.activeKeys.delete(keyCode)) {
        changed = true;
      }
    }
    if (changed) {
      this.emitActiveKeysChanged();
      this.checkShortcuts(false);
    }
  }

  private emitActiveKeysChanged() {
    this.emit("activeKeysChanged", this.getActiveKeys());
  }

  getActiveKeys(): number[] {
    return Array.from(this.activeKeys.keys());
  }

  private checkShortcuts(isKeyDown: boolean) {
    // Skip shortcut detection when recording shortcuts
    if (this.isRecordingShortcut) {
      return;
    }

    // Snapshot the active keys once; every matcher below reads the same set.
    const activeKeys = this.getActiveKeys();

    // Check PTT shortcut
    const isPTTPressed = this.isPTTShortcutPressed(isKeyDown, activeKeys);
    this.emit("ptt-state-changed", isPTTPressed);

    // Toggle/paste/newNote are edge shortcuts (one-shot on the exact-match rising
    // edge); they deliberately don't take isKeyDown — a stray edge there is rare and
    // harmless, unlike PTT where a phantom press stops an active session.

    // Check toggle recording shortcut
    const toggleMatch = this.isToggleRecordingShortcutPressed(activeKeys);
    if (toggleMatch && !this.exactMatchState.toggleRecording) {
      this.emit("toggle-recording-triggered");
    }
    this.exactMatchState.toggleRecording = toggleMatch;

    // Check paste last transcript shortcut
    const pasteMatch = this.isPasteLastTranscriptShortcutPressed(activeKeys);
    if (pasteMatch && !this.exactMatchState.pasteLastTranscript) {
      this.emit("paste-last-transcript-triggered");
    }
    this.exactMatchState.pasteLastTranscript = pasteMatch;

    // Check open notes window shortcut
    const newNoteMatch = this.isNewNoteShortcutPressed(activeKeys);
    if (newNoteMatch && !this.exactMatchState.newNote) {
      this.emit("open-notes-window-triggered");
    }
    this.exactMatchState.newNote = newNoteMatch;
  }

  // True when every shortcut key is currently held (extra keys allowed).
  private allHeld(keys: number[], activeKeys: number[]): boolean {
    return keys.every((keyCode) => activeKeys.includes(keyCode));
  }

  // True when exactly the shortcut keys are held — no extra keys.
  private isExactMatch(keys: number[], activeKeys: number[]): boolean {
    return keys.length === activeKeys.length && this.allHeld(keys, activeKeys);
  }

  private isPTTShortcutPressed(isKeyDown: boolean, activeKeys: number[]): boolean {
    const pttKeys = this.shortcuts.pushToTalk;
    if (!pttKeys || pttKeys.length === 0) {
      this.pttActive = false;
      return false;
    }

    // Start only on an exact match and only on a key-down: never latch active on a
    // key-up that collapses a larger chord down to the PTT set (e.g. releasing Space
    // after Fn+Space started hands-free), which would fire a phantom press and stop
    // the session. Sustain (the other branch) is explained on pttActive.
    this.pttActive = this.pttActive
      ? this.allHeld(pttKeys, activeKeys)
      : isKeyDown && this.isExactMatch(pttKeys, activeKeys);

    return this.pttActive;
  }

  private isToggleRecordingShortcutPressed(activeKeys: number[]): boolean {
    const toggleKeys = this.shortcuts.toggleRecording;
    if (!toggleKeys || toggleKeys.length === 0) {
      return false;
    }

    return this.isExactMatch(toggleKeys, activeKeys);
  }

  private isPasteLastTranscriptShortcutPressed(activeKeys: number[]): boolean {
    const pasteKeys = this.shortcuts.pasteLastTranscript;
    if (!pasteKeys || pasteKeys.length === 0) {
      return false;
    }

    return this.isExactMatch(pasteKeys, activeKeys);
  }

  private isNewNoteShortcutPressed(activeKeys: number[]): boolean {
    const newNoteKeys = this.shortcuts.newNote;
    if (!newNoteKeys || newNoteKeys.length === 0) {
      return false;
    }

    return this.isExactMatch(newNoteKeys, activeKeys);
  }

  private getKeycodeFromPayload(payload: KeyEventPayload): number {
    return payload.keyCode;
  }

  private isKnownKeycode(keyCode: number): boolean {
    return getKeyFromKeycode(keyCode) !== undefined;
  }

  // Register/unregister global shortcuts (for non-Swift platforms)
  registerGlobalShortcuts() {
    // This can be implemented for Windows/Linux using Electron's globalShortcut
    // For now, we rely on Swift bridge for macOS
  }

  unregisterAllShortcuts() {
    globalShortcut.unregisterAll();
  }

  cleanup() {
    this.unregisterAllShortcuts();
    this.stopPeriodicRecheck();
    this.removeAllListeners();
    this.activeKeys.clear();
  }
}
