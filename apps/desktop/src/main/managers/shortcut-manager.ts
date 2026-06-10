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
  // Timestamp of the last DELIVERED key-up (handleKeyUp). A resync trigger
  // whose key-down predates this means the user released something after
  // pressing it — the held set collapsed by release, and a resync completing
  // that collapse must not be evaluated as a press.
  private lastDeliveredKeyUpAt = 0;
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
  // A resync requested while another was in flight (set = request pending;
  // triggerKeyCode set = it was driven by a real key-down, with that key-down's
  // time captured at request time). One follow-up runs once the in-flight
  // recheck settles, giving the queued key-down a fresh snapshot + OS sample.
  private pendingRecheck:
    | { triggerKeyCode?: number; triggerDownAt?: number }
    | undefined;
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
   *
   * Self-recovery: when a key-down-driven recheck prunes stale keys and the
   * triggering key SURVIVES the prune (see triggerSurvived below), the prune
   * is evaluated as that key-down — a PTT press that was masked by a stuck key
   * latches as if the stuck key had never been there. The periodic sweep, or a
   * trigger that was itself pruned, evaluates as a key-up and never latches.
   *
   * Known residual (deliberate trade-off): if an extra key genuinely held at
   * the trigger key-down is released DURING this recheck and that key-up is
   * MISSED, the prune collapses to the exact PTT set and latches a press the
   * user produced by release. A single later OS sample cannot distinguish
   * "already stale at press time" from "went stale just after" — the event
   * that would tell us is missed by definition. We accept it because it needs
   * an event miss to coincide with this sub-700ms window, the user is then
   * physically holding the exact PTT chord having just pressed the PTT key,
   * and the win — masked presses registering at all — is the common
   * stuck-key support case. The RPC timeout hard-bounds the window (700ms,
   * see NativeBridge.recheckPressedKeys); a slower answer is discarded.
   *
   * Single flight: at most one recheck is in flight, so at most one latch
   * authority exists at a time and it acts on the freshest sample we have.
   * Requests that land mid-flight queue the latest key-down trigger and
   * refire once settled. recheckInFlight MUST be cleared in `finally`: the
   * bridge always settles (700ms timeout, reject-on-crash, helper-unavailable
   * short-circuit) so this cannot deadlock, but clearing only on success
   * would wedge rechecks after a single timeout.
   */
  async recheckPressedKeys(
    triggerKeyCode?: number,
    triggerDownAt?: number,
  ): Promise<void> {
    // Capture the trigger's key-down time at request time: KeyInfo.timestamp
    // is refreshed by auto-repeat key-downs, and a refresh mid-recheck must
    // not re-order the trigger after a later delivered key-up (which would
    // turn a key-up collapse into a phantom press).
    const triggerPressedAt =
      triggerDownAt ??
      (triggerKeyCode === undefined
        ? undefined
        : this.activeKeys.get(triggerKeyCode)?.timestamp);

    if (this.recheckInFlight) {
      // A key-down always records its trigger, overwriting an earlier one
      // (latest intent wins — in a clean event stream it is the final
      // key-down of a chord that latches it, so the most recent press is the
      // faithful attribution); a passive request never downgrades a pending
      // key-down. Overwriting is safe because a trigger is EVIDENCE of a
      // recent press, not an instruction to latch: a latch additionally
      // requires the post-prune set to be exactly the PTT chord with the
      // trigger inside it, so a slot stolen by a non-PTT key can only fail
      // the guards and degrade to key-up semantics. The worst case is a lost
      // recovery (the masked press needs one re-press) — never a phantom.
      if (triggerKeyCode !== undefined || this.pendingRecheck === undefined) {
        this.pendingRecheck = {
          triggerKeyCode,
          triggerDownAt: triggerPressedAt,
        };
      }
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

      const keysToClear: number[] = [];
      for (const keyCode of staleKeyCodes) {
        const keyInfo = this.activeKeys.get(keyCode);
        if (!keyInfo) continue;
        if (keyInfo.timestamp > requestStartedAt) {
          continue;
        }
        keysToClear.push(keyCode);
      }

      // The trigger key-down is honored only when OS truth vouches for it:
      // its key was in the snapshot we asked about, wasn't pruned, is still
      // held, and no key-up was DELIVERED after it went down (per the time
      // captured at request) — a chord collapsing via a delivered release
      // must never read as a press.
      const triggerSurvived =
        triggerKeyCode !== undefined &&
        triggerPressedAt !== undefined &&
        this.activeKeys.has(triggerKeyCode) &&
        pressedKeyCodes.includes(triggerKeyCode) &&
        !keysToClear.includes(triggerKeyCode) &&
        this.lastDeliveredKeyUpAt < triggerPressedAt;

      if (keysToClear.length > 0) {
        this.removeActiveKeys(keysToClear, triggerSurvived);
        log.info("Cleared stale pressed keys after recheck", {
          staleKeyCodes: keysToClear,
        });
      } else if (triggerSurvived) {
        // Nothing to prune, but a validated key-down drove this recheck and
        // an earlier prune may have already cleared the keys that masked it
        // at press time — re-evaluate the clean state as that key-down.
        this.checkShortcuts(true);
      }
    } catch (error) {
      log.warn("Failed to recheck pressed keys", { error });
    } finally {
      this.recheckInFlight = false;
      const pending = this.pendingRecheck;
      this.pendingRecheck = undefined;
      if (pending) {
        void this.recheckPressedKeys(
          pending.triggerKeyCode,
          pending.triggerDownAt,
        );
      }
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
      this.checkShortcuts(true, keyCode);
    }
  }

  private removeActiveKey(keyCode: number) {
    if (this.activeKeys.delete(keyCode)) {
      this.lastDeliveredKeyUpAt = Date.now();
      this.emitActiveKeysChanged();
      this.checkShortcuts(false);
    }
  }

  // `triggeredByKeyDown` carries the origin of the prune through to shortcut
  // evaluation: a prune whose triggering key-down survived it is evaluated as
  // that key-down (self-recovery — an unmasked PTT match may latch); a passive
  // prune — the periodic sweep, or a trigger that was itself pruned — as a
  // key-up. A key-up prune still releases a latched PTT whose own key was
  // pruned (rescuing a recording stuck on a missed key-up) and still fires
  // edge shortcuts it frees.
  private removeActiveKeys(keyCodes: number[], triggeredByKeyDown: boolean) {
    let changed = false;
    for (const keyCode of keyCodes) {
      if (this.activeKeys.delete(keyCode)) {
        changed = true;
      }
    }
    if (changed) {
      this.emitActiveKeysChanged();
      this.checkShortcuts(triggeredByKeyDown);
    }
  }

  private emitActiveKeysChanged() {
    this.emit("activeKeysChanged", this.getActiveKeys());
  }

  getActiveKeys(): number[] {
    return Array.from(this.activeKeys.keys());
  }

  // `triggerKeyCode` is set only when this evaluation is driven by a real
  // key-down (handleKeyDown → addActiveKey); it identifies the pressed key so
  // a superset-triggered resync can verify the key survived the prune before
  // treating that prune as a key-down.
  private checkShortcuts(isKeyDown: boolean, triggerKeyCode?: number) {
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

    // If the held set strictly contains a shortcut, the extra key(s) may be
    // stuck from a missed key-up — which would block exact-match shortcuts from
    // ever firing. Resync against OS truth to prune anything no longer
    // physically held; the prune re-runs checkShortcuts, letting a freed exact
    // match fire. Deliberately stateless — fire on EVERY real key-down in this
    // state (edge-tracking "only when the superset newly arises" missed stale
    // keys whenever a later key completed a different shortcut). The cost is
    // bounded: the single-flight guard coalesces bursts to one RPC per
    // round-trip, auto-repeats never reach here (wasActive in addActiveKey),
    // and plain typing isn't a superset of modifier-style shortcuts. The prune
    // path passes no triggerKeyCode, so a prune can never chain into another
    // resync.
    if (
      triggerKeyCode !== undefined &&
      this.isStrictSupersetOfAnyShortcut(activeKeys)
    ) {
      void this.recheckPressedKeys(triggerKeyCode);
    }
  }

  // True when every key of some configured shortcut is held *and* at least one
  // extra key is also down (a strict superset). Empty shortcuts are ignored.
  private isStrictSupersetOfAnyShortcut(activeKeys: number[]): boolean {
    return Object.values(this.shortcuts).some(
      (keys) =>
        keys.length > 0 &&
        activeKeys.length > keys.length &&
        this.allHeld(keys, activeKeys),
    );
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
