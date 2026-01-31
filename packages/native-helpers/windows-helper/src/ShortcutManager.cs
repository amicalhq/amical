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

        private readonly object _lock = new();
        private int[] _pushToTalkKeys = Array.Empty<int>();
        private int[] _toggleRecordingKeys = Array.Empty<int>();
        private int[] _pasteLastTranscriptKeys = Array.Empty<int>();
        private HashSet<int> _shortcutKeysSet = new();

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
        public void SetShortcuts(int[] pushToTalk, int[] toggleRecording, int[] pasteLastTranscript)
        {
            lock (_lock)
            {
                _pushToTalkKeys = pushToTalk ?? Array.Empty<int>();
                _toggleRecordingKeys = toggleRecording ?? Array.Empty<int>();
                _pasteLastTranscriptKeys = pasteLastTranscript ?? Array.Empty<int>();
                _shortcutKeysSet = new HashSet<int>(_pushToTalkKeys
                    .Concat(_toggleRecordingKeys)
                    .Concat(_pasteLastTranscriptKeys));
                LogToStderr($"Shortcuts updated - PTT: [{string.Join(", ", _pushToTalkKeys)}], Toggle: [{string.Join(", ", _toggleRecordingKeys)}], Paste: [{string.Join(", ", _pasteLastTranscriptKeys)}]");
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
        /// Check if a key is actually pressed using GetAsyncKeyState.
        /// </summary>
        private bool IsKeyActuallyPressed(int vkCode)
        {
            // High-order bit is set if key is currently down
            return (GetAsyncKeyState(vkCode) & 0x8000) != 0;
        }

        /// <summary>
        /// Validate all tracked regular keys against actual OS state.
        /// Removes any keys that are not actually pressed (stuck keys).
        /// Returns the list of keys that were removed.
        /// </summary>
        public List<int> ValidateAndClearStaleKeys()
        {
            var staleKeys = new List<int>();

            lock (_lock)
            {
                var keysToCheck = _pressedRegularKeys.ToList();
                foreach (var keyCode in keysToCheck)
                {
                    if (!IsKeyActuallyPressed(keyCode))
                    {
                        _pressedRegularKeys.Remove(keyCode);
                        staleKeys.Add(keyCode);
                    }
                }
            }

            return staleKeys;
        }

        /// <summary>
        /// Check if this key event should be consumed (prevent default behavior).
        /// Called from ShortcutMonitor hook callback for keyDown/keyUp events only.
        /// </summary>
        public bool ShouldConsumeKey(int vkCode, IReadOnlyCollection<int> activeModifiers)
        {
            lock (_lock)
            {
                // Early exit if no shortcuts configured
                if (_pushToTalkKeys.Length == 0 && _toggleRecordingKeys.Length == 0 && _pasteLastTranscriptKeys.Length == 0)
                {
                    return false;
                }

                // Build full set of active keys (modifiers + tracked regular keys + current key)
                var activeKeys = new HashSet<int>(activeModifiers);
                activeKeys.UnionWith(_pressedRegularKeys);
                activeKeys.Add(vkCode);

                // PTT: consume if building toward the shortcut
                // - At least one modifier from the shortcut must be held (signals intent)
                // - All currently pressed keys must be part of the shortcut (activeKeys ⊆ pttKeys)
                var pttKeys = new HashSet<int>(_pushToTalkKeys);
                var modifierKeys = new HashSet<int>(KeycodeConstants.ModifierKeyCodes);
                var pttModifiers = new HashSet<int>(pttKeys);
                pttModifiers.IntersectWith(modifierKeys);
                var hasRequiredModifier = pttModifiers.Count > 0 && pttModifiers.Overlaps(activeModifiers);
                var pttMatch = pttKeys.Count > 0 && hasRequiredModifier && activeKeys.IsSubsetOf(pttKeys);

                // Toggle: exact match (only these keys pressed)
                var toggleKeys = new HashSet<int>(_toggleRecordingKeys);
                var toggleMatch = toggleKeys.Count > 0 && toggleKeys.SetEquals(activeKeys);

                // Paste last transcript: exact match (only these keys pressed)
                var pasteKeys = new HashSet<int>(_pasteLastTranscriptKeys);
                var pasteMatch = pasteKeys.Count > 0 && pasteKeys.SetEquals(activeKeys);

                return pttMatch || toggleMatch || pasteMatch;
            }
        }
    }
}
