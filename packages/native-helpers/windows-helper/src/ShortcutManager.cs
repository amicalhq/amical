using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;

namespace WindowsHelper
{
    /// <summary>
    /// Represents the state of modifier keys at a given moment.
    /// </summary>
    public struct ModifierState
    {
        public bool Win;
        public bool Ctrl;
        public bool Alt;
        public bool Shift;
    }

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
        private string[] _pushToTalkKeys = Array.Empty<string>();
        private string[] _toggleRecordingKeys = Array.Empty<string>();

        // Track currently pressed non-modifier keys across keyDown/keyUp events.
        // This is necessary for multi-key shortcuts like Shift+A+B where we need to
        // know that 'A' is still held when 'B' is pressed.
        //
        // WARNING: _pressedRegularKeys can get stuck if keyUp events are missed
        // (e.g., hook restarts, sleep/wake cycles). This will cause shortcuts to
        // stop matching because activeKeys retains extra keys. Consider clearing
        // this state on app re-initialization or power management events.
        private readonly HashSet<string> _pressedRegularKeys = new();

        private ShortcutManager() { }

        private void LogToStderr(string message)
        {
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            Console.Error.WriteLine($"[{timestamp}] [ShortcutManager] {message}");
            Console.Error.Flush();
        }

        /// <summary>
        /// Update the configured shortcuts.
        /// Called from RpcHandler when setShortcuts RPC is received.
        /// </summary>
        public void SetShortcuts(string[] pushToTalk, string[] toggleRecording)
        {
            lock (_lock)
            {
                _pushToTalkKeys = pushToTalk ?? Array.Empty<string>();
                _toggleRecordingKeys = toggleRecording ?? Array.Empty<string>();
                LogToStderr($"Shortcuts updated - PTT: [{string.Join(", ", _pushToTalkKeys)}], Toggle: [{string.Join(", ", _toggleRecordingKeys)}]");
            }
        }

        /// <summary>
        /// Add a regular (non-modifier) key to the tracked set.
        /// Called from ShortcutMonitor hook callback on keyDown events.
        /// </summary>
        public void AddRegularKey(string key)
        {
            lock (_lock)
            {
                _pressedRegularKeys.Add(key);
            }
        }

        /// <summary>
        /// Remove a regular (non-modifier) key from the tracked set.
        /// Called from ShortcutMonitor hook callback on keyUp events.
        /// </summary>
        public void RemoveRegularKey(string key)
        {
            lock (_lock)
            {
                _pressedRegularKeys.Remove(key);
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
        public List<string> ValidateAndClearStaleKeys()
        {
            var staleKeys = new List<string>();

            lock (_lock)
            {
                var keysToCheck = _pressedRegularKeys.ToList();
                foreach (var keyName in keysToCheck)
                {
                    var vkCode = VirtualKeyMap.GetVkCode(keyName);
                    if (vkCode.HasValue && !IsKeyActuallyPressed(vkCode.Value))
                    {
                        _pressedRegularKeys.Remove(keyName);
                        staleKeys.Add(keyName);
                    }
                }
            }

            return staleKeys;
        }

        /// <summary>
        /// Check if this key event should be consumed (prevent default behavior).
        /// Called from ShortcutMonitor hook callback for keyDown/keyUp events only.
        /// </summary>
        public bool ShouldConsumeKey(int vkCode, ModifierState modifiers)
        {
            lock (_lock)
            {
                // Early exit if no shortcuts configured
                if (_pushToTalkKeys.Length == 0 && _toggleRecordingKeys.Length == 0)
                {
                    return false;
                }

                // If we can't map this key, don't consume it - prevents unmapped keys
                // (like PageUp, Home) from being incorrectly consumed when a modifier is held
                var currentKeyName = VirtualKeyMap.GetKeyName(vkCode);
                if (currentKeyName == null)
                {
                    return false;
                }

                // Build set of currently active modifier keys
                var activeModifiers = new HashSet<string>();
                if (modifiers.Win) activeModifiers.Add("Win");
                if (modifiers.Ctrl) activeModifiers.Add("Ctrl");
                if (modifiers.Alt) activeModifiers.Add("Alt");
                if (modifiers.Shift) activeModifiers.Add("Shift");

                // Build full set of active keys (modifiers + tracked regular keys + current key)
                var activeKeys = new HashSet<string>(activeModifiers);
                activeKeys.UnionWith(_pressedRegularKeys);
                activeKeys.Add(currentKeyName);

                // PTT: consume if building toward the shortcut
                // - At least one modifier from the shortcut must be held (signals intent)
                // - All currently pressed keys must be part of the shortcut (activeKeys ⊆ pttKeys)
                var pttKeys = new HashSet<string>(_pushToTalkKeys);
                var modifierKeys = new HashSet<string> { "Win", "Ctrl", "Alt", "Shift" };
                var pttModifiers = new HashSet<string>(pttKeys);
                pttModifiers.IntersectWith(modifierKeys);
                var hasRequiredModifier = pttModifiers.Count > 0 && pttModifiers.Overlaps(activeModifiers);
                var pttMatch = pttKeys.Count > 0 && hasRequiredModifier && activeKeys.IsSubsetOf(pttKeys);

                // Toggle: exact match (only these keys pressed)
                var toggleKeys = new HashSet<string>(_toggleRecordingKeys);
                var toggleMatch = toggleKeys.Count > 0 && toggleKeys.SetEquals(activeKeys);

                return pttMatch || toggleMatch;
            }
        }
    }
}
