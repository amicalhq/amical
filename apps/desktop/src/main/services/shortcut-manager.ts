import { EventEmitter } from "events";
import { globalShortcut } from "electron";
import { SettingsService } from "@/services/settings-service";
import { SwiftIOBridge } from "@/services/platform/swift-bridge-service";
import { matchesShortcutKey, getKeyNameFromPayload } from "@/utils/keycode-map";
import { KeyEventPayload, HelperEvent } from "@amical/types";
import { logger } from "@/main/logger";

const log = logger.main;

interface KeyInfo {
  key: string;
  timestamp: number;
}

interface ShortcutConfig {
  pushToTalk: string;
  toggleRecording: string;
}

export class ShortcutManager extends EventEmitter {
  private activeKeys = new Map<string, KeyInfo>();
  private shortcuts: ShortcutConfig = {
    pushToTalk: "",
    toggleRecording: "",
  };
  private settingsService: SettingsService;
  private swiftIOBridge: SwiftIOBridge | null = null;

  constructor(settingsService: SettingsService) {
    super();
    this.settingsService = settingsService;
  }

  async initialize(swiftIOBridge: SwiftIOBridge | null) {
    this.swiftIOBridge = swiftIOBridge;
    await this.loadShortcuts();
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

  async reloadShortcuts() {
    await this.loadShortcuts();
  }

  private setupEventListeners() {
    if (!this.swiftIOBridge) {
      log.warn("SwiftIOBridge not available, shortcuts will not work");
      return;
    }

    this.swiftIOBridge.on("helperEvent", (event: HelperEvent) => {
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

    // Track modifier keys
    const modifiers = [
      { flag: payload.metaKey, name: "Cmd" },
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
    // Check PTT shortcut
    const isPTTPressed = this.isPTTShortcutPressed();
    this.emit("ptt-state-changed", isPTTPressed);

    // Check toggle recording shortcut
    if (this.isToggleRecordingShortcutPressed()) {
      this.emit("toggle-recording-triggered");
    }
  }

  private isPTTShortcutPressed(): boolean {
    if (!this.shortcuts.pushToTalk) {
      return false;
    }

    const pttKeys = this.shortcuts.pushToTalk.split("+");
    const activeKeysList = this.getActiveKeys();

    // Check if PTT keys match active keys exactly
    return (
      pttKeys.length === activeKeysList.length &&
      pttKeys.every((key) => activeKeysList.includes(key))
    );
  }

  private isToggleRecordingShortcutPressed(): boolean {
    if (!this.shortcuts.toggleRecording) {
      return false;
    }

    const toggleKeys = this.shortcuts.toggleRecording.split("+");
    const activeKeysList = this.getActiveKeys();

    // Check if toggle recording keys match active keys exactly
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
