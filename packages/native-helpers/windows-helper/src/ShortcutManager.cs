using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;

namespace WindowsHelper
{
    /// <summary>
    /// Manages configured shortcuts and determines if key events should be consumed.
    /// Thread-safe singleton that can be updated from RpcHandler (background thread)
    /// and queried from ShortcutMonitor hook callback (main thread).
    /// Mirrors swift-helper/Sources/SwiftHelper/ShortcutManager.swift
    /// </summary>
    public class ShortcutManager
    {
        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        private static readonly Lazy<ShortcutManager> _instance = new(() => new ShortcutManager());
        public static ShortcutManager Instance => _instance.Value;

        // Modifiers whose lone release steals focus: Alt → menu bar, Win → Start menu.
        // Ctrl/Shift are intentionally excluded — their lone release is harmless.
        private static readonly HashSet<int> MaskableModifierVks = new()
        {
            KeycodeConstants.VkLMenu,
            KeycodeConstants.VkRMenu,
            KeycodeConstants.VkLWin,
            KeycodeConstants.VkRWin,
        };

        private readonly object _lock = new();
        private int[] _pushToTalkKeys = Array.Empty<int>();
        private int[] _toggleRecordingKeys = Array.Empty<int>();
        private int[] _pasteLastTranscriptKeys = Array.Empty<int>();
        private int[] _newNoteKeys = Array.Empty<int>();
        private HashSet<int> _shortcutKeysSet = new();
        // Shortcut key → that key plus every key of every configured shortcut
        // containing it ("chord-mates"). Rebuilt in SetShortcuts; read-only on
        // the hook path (ValidateAndResyncKeyState).
        private Dictionary<int, HashSet<int>> _chordKeysByTrigger = new();
        private readonly HashSet<int> _activatedMaskKeys = new();

        // Track currently pressed modifier keys (left/right distinct).
        private readonly HashSet<int> _pressedModifierKeys = new();

        // Track currently pressed non-modifier keys across keyDown/keyUp events.
        // This is necessary for multi-key shortcuts like Shift+A+B where we need to
        // know that 'A' is still held when 'B' is pressed.
        //
        // WARNING: _pressedRegularKeys can get stuck if keyUp events are missed
        // (e.g., hook restarts, sleep/wake cycles). This will cause shortcuts to
        // stop matching because activeKeys retains extra keys. Consider clearing
        // this state on app re-initialization or power management events.
        private readonly HashSet<int> _pressedRegularKeys = new();

        private ShortcutManager() { }

        private void LogToStderr(string message)
        {
            HelperLogger.LogToStderr($"[ShortcutManager] {message}");
        }

        /// <summary>
        /// Update the configured shortcuts.
        /// Called from RpcHandler when setShortcuts RPC is received.
        /// </summary>
        public void SetShortcuts(int[] pushToTalk, int[] toggleRecording, int[] pasteLastTranscript, int[] newNote)
        {
            lock (_lock)
            {
                _pushToTalkKeys = pushToTalk ?? Array.Empty<int>();
                _toggleRecordingKeys = toggleRecording ?? Array.Empty<int>();
                _pasteLastTranscriptKeys = pasteLastTranscript ?? Array.Empty<int>();
                _newNoteKeys = newNote ?? Array.Empty<int>();
                _shortcutKeysSet = new HashSet<int>(_pushToTalkKeys
                    .Concat(_toggleRecordingKeys)
                    .Concat(_pasteLastTranscriptKeys)
                    .Concat(_newNoteKeys));
                _chordKeysByTrigger = BuildChordKeysByTrigger();
                _activatedMaskKeys.Clear();
                LogToStderr($"Shortcuts updated - PTT: [{string.Join(", ", _pushToTalkKeys)}], Toggle: [{string.Join(", ", _toggleRecordingKeys)}], Paste: [{string.Join(", ", _pasteLastTranscriptKeys)}], NewNote: [{string.Join(", ", _newNoteKeys)}]");
            }
        }

        /// <summary>
        /// Check if a key is part of any configured shortcut.
        /// </summary>
        public bool IsShortcutKey(int keyCode)
        {
            lock (_lock)
            {
                return _shortcutKeysSet.Contains(keyCode);
            }
        }

        /// <summary>
        /// Arm the currently-held Alt/Win keys for release-masking. Called from the hook
        /// when a configured shortcut has matched (ShouldConsumeKey returned true): any
        /// Alt/Win key held at that moment is part of that shortcut, so its eventual
        /// release should be masked rather than reach the OS as a lone modifier.
        /// </summary>
        public void ArmMaskableModifierKeys()
        {
            lock (_lock)
            {
                ArmHeldMaskableModifiers();
            }
        }

        /// <summary>
        /// Arm the held maskable Alt/Win keys when the full set of currently-held keys
        /// (modifiers + tracked regular keys) exactly matches a configured shortcut. Called
        /// from the hook on a key-down that may complete a shortcut.
        ///
        /// This covers what the non-modifier ShouldConsumeKey/ArmMaskableModifierKeys path
        /// misses: a shortcut completed by pressing a modifier last (e.g. Z, Shift, then Alt
        /// for the default Alt+Shift+Z paste), plus modifier-only shortcuts (e.g. the Ctrl+Win
        /// PTT) that never reach that path at all. Matches the held set exactly, mirroring the
        /// desktop matcher (apps/desktop ShortcutManager), which only starts a shortcut from an
        /// exact key set — so masking covers a real gesture but not an extra-key combo like
        /// Shift+Ctrl+Win that never activates the shortcut. Arming is sticky, so it survives
        /// the rest of the hold.
        /// </summary>
        public void ArmIfShortcutExactlyHeld()
        {
            lock (_lock)
            {
                // Nothing to mask unless a maskable modifier is currently held.
                if (!_pressedModifierKeys.Overlaps(MaskableModifierVks))
                {
                    return;
                }

                var heldKeys = new HashSet<int>(_pressedModifierKeys);
                heldKeys.UnionWith(_pressedRegularKeys);

                if (IsExactlyHeld(_pushToTalkKeys, heldKeys)
                    || IsExactlyHeld(_toggleRecordingKeys, heldKeys)
                    || IsExactlyHeld(_pasteLastTranscriptKeys, heldKeys)
                    || IsExactlyHeld(_newNoteKeys, heldKeys))
                {
                    ArmHeldMaskableModifiers();
                }
            }
        }

        // Add every currently-held maskable modifier to the armed set. Caller holds _lock.
        private void ArmHeldMaskableModifiers()
        {
            foreach (var vk in _pressedModifierKeys)
            {
                if (MaskableModifierVks.Contains(vk))
                {
                    _activatedMaskKeys.Add(vk);
                }
            }
        }

        // True if the shortcut is non-empty and exactly equals the held key set.
        private static bool IsExactlyHeld(int[] shortcutKeys, HashSet<int> heldKeys)
        {
            return shortcutKeys.Length > 0 && heldKeys.SetEquals(shortcutKeys);
        }

        /// <summary>
        /// True (once) if this key was armed for masking; disarms it as a side effect so
        /// each armed release is masked exactly once. Called from the hook on a modifier
        /// key-up.
        /// </summary>
        public bool ConsumeMaskOnRelease(int vkCode)
        {
            lock (_lock)
            {
                return _activatedMaskKeys.Remove(vkCode);
            }
        }

        /// <summary>
        /// Add a regular (non-modifier) key to the tracked set.
        /// Called from ShortcutMonitor hook callback on keyDown events.
        /// </summary>
        public void AddRegularKey(int keyCode)
        {
            lock (_lock)
            {
                _pressedRegularKeys.Add(keyCode);
            }
        }

        /// <summary>
        /// Remove a regular (non-modifier) key from the tracked set.
        /// Called from ShortcutMonitor hook callback on keyUp events.
        /// </summary>
        public void RemoveRegularKey(int keyCode)
        {
            lock (_lock)
            {
                _pressedRegularKeys.Remove(keyCode);
            }
        }

        /// <summary>
        /// Update the tracked modifier key state (left/right).
        /// Called from ShortcutMonitor hook callback when modifier keyDown/keyUp is received.
        /// </summary>
        public void SetModifierKey(int keyCode, bool isDown)
        {
            lock (_lock)
            {
                if (isDown)
                {
                    _pressedModifierKeys.Add(keyCode);
                }
                else
                {
                    _pressedModifierKeys.Remove(keyCode);
                }
            }
        }

        /// <summary>
        /// Check if a modifier is currently pressed.
        /// </summary>
        public bool IsModifierPressed(int keyCode)
        {
            lock (_lock)
            {
                return _pressedModifierKeys.Contains(keyCode);
            }
        }

        /// <summary>
        /// Snapshot combined modifier state for payloads.
        /// </summary>
        public (bool Shift, bool Ctrl, bool Alt, bool Win) GetModifierState()
        {
            lock (_lock)
            {
                var shift = _pressedModifierKeys.Contains(KeycodeConstants.VkLShift)
                    || _pressedModifierKeys.Contains(KeycodeConstants.VkRShift);
                var ctrl = _pressedModifierKeys.Contains(KeycodeConstants.VkLControl)
                    || _pressedModifierKeys.Contains(KeycodeConstants.VkRControl);
                var alt = _pressedModifierKeys.Contains(KeycodeConstants.VkLMenu)
                    || _pressedModifierKeys.Contains(KeycodeConstants.VkRMenu);
                var win = _pressedModifierKeys.Contains(KeycodeConstants.VkLWin)
                    || _pressedModifierKeys.Contains(KeycodeConstants.VkRWin);
                return (shift, ctrl, alt, win);
            }
        }

        /// <summary>
        /// Check if a key is actually pressed using GetAsyncKeyState.
        /// </summary>
        private bool IsKeyActuallyPressed(int vkCode)
        {
            // High-order bit is set if key is currently down
            return (GetAsyncKeyState(vkCode) & 0x8000) != 0;
        }

        /// <summary>
        /// Check provided key codes against OS truth and return any stale entries.
        /// </summary>
        public List<int> GetStalePressedKeyCodes(IEnumerable<int> keyCodes)
        {
            var stale = new List<int>();
            foreach (var keyCode in keyCodes)
            {
                if (!IsKeyActuallyPressed(keyCode))
                {
                    stale.Add(keyCode);
                }
            }

            if (stale.Count > 0)
            {
                LogToStderr($"Recheck: stale keys detected: [{string.Join(", ", stale)}]");
            }

            return stale;
        }

        /// <summary>
        /// Validate all tracked key states against actual OS state.
        /// Removes any keys that are not actually pressed (stuck keys).
        ///
        /// The trigger key and its chord-mates — keys of every configured
        /// shortcut containing the trigger — are exempt from pruning. An event
        /// from a chord member is evidence that chord may be in progress, and
        /// GetAsyncKeyState cannot be trusted for its mates: injected events
        /// (PowerToys-class remappers, our own masking/paste SendInput) update
        /// the OS key table without reaching the hook, so a physically-held
        /// chord key can read as released. Pruning it mid-chord breaks
        /// ShouldConsumeKey (the chord's keys start leaking to the focused
        /// app) and disarms the Alt/Win release mask.
        /// </summary>
        /// <remarks>
        /// Known residual, evaluated and ACCEPTED: a chord-mate whose key-up
        /// was genuinely missed (UAC/secure desktop, sleep, hook drop) is
        /// shielded from exactly the resyncs its own chord-mates trigger —
        /// e.g. with paste = Alt+Shift+Z and a stale Alt, typing Shift+Z
        /// reads as the full chord and the Z is consumed. From this hook's
        /// event stream, "released but key-up missed" and "held but table
        /// poisoned" are observationally identical at any instant, so any
        /// policy picks one error; we pick the self-healing one. The stale
        /// key clears on its own next physical press-release (chord-mates
        /// are everyday modifiers, reused within seconds-to-minutes), so the
        /// real exposure is a couple of eaten keystrokes, not persistence.
        /// Rejected guards (see zeus doc 2026-06-12-windows-resync-gating):
        /// typematic-freshness heartbeat (Windows auto-repeat is last-key-
        /// only — chord modifiers go silent mid-hold, so freshness would
        /// prune held-poisoned keys and re-break the original bug), and
        /// desktop→helper prune mirroring (cross-process races to bound a
        /// residual that already self-heals).
        /// </remarks>
        public void ValidateAndResyncKeyState(int? triggerKeyCode = null)
        {
            lock (_lock)
            {
                var exemptKeys = GetTriggerChordKeys(triggerKeyCode);

                var modifierKeysToCheck = _pressedModifierKeys.ToList();
                foreach (var keyCode in modifierKeysToCheck)
                {
                    if (exemptKeys.Contains(keyCode))
                    {
                        continue;
                    }

                    if (!IsKeyActuallyPressed(keyCode))
                    {
                        _pressedModifierKeys.Remove(keyCode);
                        LogToStderr($"Resync: Modifier was stuck, cleared: {keyCode}");
                    }
                }

                var regularKeysToCheck = _pressedRegularKeys.ToList();
                foreach (var keyCode in regularKeysToCheck)
                {
                    if (exemptKeys.Contains(keyCode))
                    {
                        continue;
                    }

                    if (!IsKeyActuallyPressed(keyCode))
                    {
                        _pressedRegularKeys.Remove(keyCode);
                        LogToStderr($"Resync: Regular key was stuck, cleared: {keyCode}");
                    }
                }

                _activatedMaskKeys.RemoveWhere(vk =>
                    !exemptKeys.Contains(vk) && !IsKeyActuallyPressed(vk));
            }
        }

        private static readonly HashSet<int> EmptyChordKeys = new();

        // The trigger key plus its chord-mates (precomputed per shortcut key
        // in SetShortcuts — this runs in the hook callback on every shortcut
        // key event, so it must not allocate or scan). A trigger that is not
        // part of any shortcut exempts only itself. Caller holds _lock.
        private HashSet<int> GetTriggerChordKeys(int? triggerKeyCode)
        {
            if (!triggerKeyCode.HasValue)
            {
                return EmptyChordKeys;
            }

            if (_chordKeysByTrigger.TryGetValue(triggerKeyCode.Value, out var chordKeys))
            {
                return chordKeys;
            }

            return new HashSet<int> { triggerKeyCode.Value };
        }

        // Build the trigger → chord-mates map from the configured shortcut
        // arrays. Caller holds _lock.
        private Dictionary<int, HashSet<int>> BuildChordKeysByTrigger()
        {
            var map = new Dictionary<int, HashSet<int>>();
            foreach (var shortcut in new[]
            {
                _pushToTalkKeys,
                _toggleRecordingKeys,
                _pasteLastTranscriptKeys,
                _newNoteKeys,
            })
            {
                foreach (var key in shortcut)
                {
                    if (!map.TryGetValue(key, out var chordKeys))
                    {
                        chordKeys = new HashSet<int>();
                        map[key] = chordKeys;
                    }
                    chordKeys.UnionWith(shortcut);
                }
            }
            return map;
        }

        /// <summary>
        /// Check if this key event should be consumed (prevent default behavior).
        /// Called from ShortcutMonitor hook callback for keyDown/keyUp events only.
        /// </summary>
        public bool ShouldConsumeKey(int vkCode)
        {
            lock (_lock)
            {
                // Early exit if no shortcuts configured
                if (_pushToTalkKeys.Length == 0
                    && _toggleRecordingKeys.Length == 0
                    && _pasteLastTranscriptKeys.Length == 0
                    && _newNoteKeys.Length == 0)
                {
                    return false;
                }

                // Build full set of active keys (modifiers + tracked regular keys + current key)
                var activeModifiers = new HashSet<int>(_pressedModifierKeys);
                var activeKeys = new HashSet<int>(activeModifiers);
                activeKeys.UnionWith(_pressedRegularKeys);
                activeKeys.Add(vkCode);

                // PTT: consume if building toward the shortcut
                // - At least one modifier from the shortcut must be held (signals intent)
                // - All currently pressed keys must be part of the shortcut (activeKeys ⊆ pttKeys)
                var pttKeys = new HashSet<int>(_pushToTalkKeys);
                var pttModifiers = new HashSet<int>(pttKeys);
                pttModifiers.IntersectWith(KeycodeConstants.ModifierKeyCodeSet);
                var hasRequiredModifier = pttModifiers.Count > 0 && pttModifiers.Overlaps(activeModifiers);
                var pttMatch = pttKeys.Count > 0 && hasRequiredModifier && activeKeys.IsSubsetOf(pttKeys);

                // Toggle: exact match (only these keys pressed)
                var toggleKeys = new HashSet<int>(_toggleRecordingKeys);
                var toggleMatch = toggleKeys.Count > 0 && toggleKeys.SetEquals(activeKeys);

                // Paste last transcript: exact match (only these keys pressed)
                var pasteKeys = new HashSet<int>(_pasteLastTranscriptKeys);
                var pasteMatch = pasteKeys.Count > 0 && pasteKeys.SetEquals(activeKeys);

                // New note: exact match (only these keys pressed)
                var newNoteKeys = new HashSet<int>(_newNoteKeys);
                var newNoteMatch = newNoteKeys.Count > 0 && newNoteKeys.SetEquals(activeKeys);

                return pttMatch || toggleMatch || pasteMatch || newNoteMatch;
            }
        }
    }
}
