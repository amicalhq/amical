import { EventEmitter } from "events";
import { globalShortcut } from "electron";
import { SettingsService } from "@/services/settings-service";
import { NativeBridge } from "@/services/platform/native-bridge-service";
import { getKeyNameFromPayload } from "@/utils/keycode-map";
import { isWindows } from "@/utils/platform";
import { KeyEventPayload, HelperEvent } from "@amical/types";
import { logger } from "@/main/logger";
import {
  validateShortcutComprehensive,
  type ShortcutType,
  type ValidationResult,
} from "@/utils/shortcut-validation";

const log = logger.main;

interface KeyInfo {
  key: string;
  timestamp: number;
}

interface ShortcutConfig {
  pushToTalk: string[];
  toggleRecording: string[];
}

export class ShortcutManager extends EventEmitter {
  private activeKeys = new Map<string, KeyInfo>();
  private shortcuts: ShortcutConfig = {
    pushToTalk: [],
    toggleRecording: [],
  };
  private settingsService: SettingsService;
  private nativeBridge: NativeBridge | null = null;
  private isRecordingShortcut: boolean = false;

  constructor(settingsService: SettingsService) {
    super();
    this.settingsService = settingsService;
  }

  async initialize(nativeBridge: NativeBridge | null) {
    this.nativeBridge = nativeBridge;
    await this.loadShortcuts();
    this.syncShortcutsToNative(); // fire-and-forget
    this.setupEventListeners();
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
    if (!this.nativeBridge) {
      log.debug("Native bridge not available, skipping shortcut sync");
      return;
    }

    try {
      await this.nativeBridge.setShortcuts({
        pushToTalk: this.shortcuts.pushToTalk,
        toggleRecording: this.shortcuts.toggleRecording,
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
   * Set a shortcut with full validation.
   * Validates, persists, updates internal state, and syncs to native.
   */
  async setShortcut(
    type: ShortcutType,
    keys: string[],
  ): Promise<ValidationResult> {
    // Get the other shortcut for cross-validation
    const otherShortcut =
      type === "pushToTalk"
        ? this.shortcuts.toggleRecording
        : this.shortcuts.pushToTalk;

    // Validate the shortcut
    const result = validateShortcutComprehensive({
      currentShortcut: keys,
      otherShortcut,
      shortcutType: type,
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
    log.info("Shortcut recording state changed", { isRecording });
  }

  private setupEventListeners() {
    if (!this.nativeBridge) {
      log.warn("Native bridge not available, shortcuts will not work");
      return;
    }

    this.nativeBridge.on("helperEvent", (event: HelperEvent) => {
      switch (event.type) {
        case "flagsChanged":
          this.handleFlagsChanged(event.payload);
          break;
        case "keyDown":
          this.handleKeyDown(event.payload);
          break;
        case "keyUp":
          this.handleKeyUp(event.payload);
          break;
      }
    });
  }

  private handleFlagsChanged(payload: KeyEventPayload) {
    // Track Fn key state
    if (payload.fnKeyPressed !== undefined) {
      if (payload.fnKeyPressed) {
        this.addActiveKey("Fn");
      } else {
        this.removeActiveKey("Fn");
      }
    }

    // Track modifier keys with platform-aware names
    const modifiers = [
      { flag: payload.metaKey, name: isWindows() ? "Win" : "Cmd" },
      { flag: payload.ctrlKey, name: "Ctrl" },
      { flag: payload.altKey, name: "Alt" },
      { flag: payload.shiftKey, name: "Shift" },
    ];

    modifiers.forEach(({ flag, name }) => {
      if (flag !== undefined) {
        if (flag) {
          this.addActiveKey(name);
        } else {
          this.removeActiveKey(name);
        }
      }
    });

    this.checkShortcuts();
  }

  private handleKeyDown(payload: KeyEventPayload) {
    const keyName = getKeyNameFromPayload(payload);
    if (keyName) {
      this.addActiveKey(keyName);
      this.checkShortcuts();
    }
  }

  private handleKeyUp(payload: KeyEventPayload) {
    const keyName = getKeyNameFromPayload(payload);
    if (keyName) {
      this.removeActiveKey(keyName);
      this.checkShortcuts();
    }
  }

  private addActiveKey(key: string) {
    this.activeKeys.set(key, { key, timestamp: Date.now() });
    this.emitActiveKeysChanged();
  }

  private removeActiveKey(key: string) {
    this.activeKeys.delete(key);
    this.emitActiveKeysChanged();
  }

  private emitActiveKeysChanged() {
    this.emit("activeKeysChanged", this.getActiveKeys());
  }

  getActiveKeys(): string[] {
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
    if (this.isToggleRecordingShortcutPressed()) {
      this.emit("toggle-recording-triggered");
    }
  }

  private isPTTShortcutPressed(): boolean {
    const pttKeys = this.shortcuts.pushToTalk;
    if (!pttKeys || pttKeys.length === 0) {
      return false;
    }

    const activeKeysList = this.getActiveKeys();

    // PTT: subset match - all PTT keys must be pressed (can have extra keys)
    return pttKeys.every((key) => activeKeysList.includes(key));
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
      toggleKeys.every((key) => activeKeysList.includes(key))
    );
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
    this.removeAllListeners();
    this.activeKeys.clear();
  }
}
