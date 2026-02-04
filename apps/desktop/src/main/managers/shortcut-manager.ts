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
}

export class ShortcutManager extends EventEmitter {
  private activeKeys = new Map<number, KeyInfo>();
  private shortcuts: ShortcutConfig = {
    pushToTalk: [],
    toggleRecording: [],
    pasteLastTranscript: [],
  };
  private settingsService: SettingsService;
  private nativeBridge: NativeBridge;
  private isRecordingShortcut: boolean = false;
  private recheckInFlight = false;
  private recheckInterval: NodeJS.Timeout | null = null;
  private exactMatchState = {
    toggleRecording: false,
    pasteLastTranscript: false,
  };

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
    this.checkShortcuts();
  }

  private handleKeyUp(payload: KeyEventPayload) {
    const keyCode = this.getKeycodeFromPayload(payload);
    if (!this.isKnownKeycode(keyCode)) {
      return;
    }
    this.removeActiveKey(keyCode);
    this.checkShortcuts();
  }

  private addActiveKey(keyCode: number) {
    this.activeKeys.set(keyCode, { keyCode, timestamp: Date.now() });
    this.emitActiveKeysChanged();
  }

  private removeActiveKey(keyCode: number) {
    this.activeKeys.delete(keyCode);
    this.emitActiveKeysChanged();
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
      this.checkShortcuts();
    }
  }

  private emitActiveKeysChanged() {
    this.emit("activeKeysChanged", this.getActiveKeys());
  }

  getActiveKeys(): number[] {
    return Array.from(this.activeKeys.keys());
  }

  private checkShortcuts() {
    // Skip shortcut detection when recording shortcuts
    if (this.isRecordingShortcut) {
      return;
    }

    // Check PTT shortcut
    const isPTTPressed = this.isPTTShortcutPressed();
    this.emit("ptt-state-changed", isPTTPressed);

    // Check toggle recording shortcut
    const toggleMatch = this.isToggleRecordingShortcutPressed();
    if (toggleMatch && !this.exactMatchState.toggleRecording) {
      this.emit("toggle-recording-triggered");
    }
    this.exactMatchState.toggleRecording = toggleMatch;

    // Check paste last transcript shortcut
    const pasteMatch = this.isPasteLastTranscriptShortcutPressed();
    if (pasteMatch && !this.exactMatchState.pasteLastTranscript) {
      this.emit("paste-last-transcript-triggered");
    }
    this.exactMatchState.pasteLastTranscript = pasteMatch;
  }

  private isPTTShortcutPressed(): boolean {
    const pttKeys = this.shortcuts.pushToTalk;
    if (!pttKeys || pttKeys.length === 0) {
      return false;
    }

    const activeKeysList = this.getActiveKeys();

    // PTT: subset match - all PTT keys must be pressed (can have extra keys)
    return pttKeys.every((keyCode) => activeKeysList.includes(keyCode));
  }

  private isToggleRecordingShortcutPressed(): boolean {
    const toggleKeys = this.shortcuts.toggleRecording;
    if (!toggleKeys || toggleKeys.length === 0) {
      return false;
    }

    const activeKeysList = this.getActiveKeys();

    // Toggle: exact match - only these keys pressed, no extra keys
    return (
      toggleKeys.length === activeKeysList.length &&
      toggleKeys.every((keyCode) => activeKeysList.includes(keyCode))
    );
  }

  private isPasteLastTranscriptShortcutPressed(): boolean {
    const pasteKeys = this.shortcuts.pasteLastTranscript;
    if (!pasteKeys || pasteKeys.length === 0) {
      return false;
    }

    const activeKeysList = this.getActiveKeys();

    // Exact match - only these keys pressed, no extra keys
    return (
      pasteKeys.length === activeKeysList.length &&
      pasteKeys.every((keyCode) => activeKeysList.includes(keyCode))
    );
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
