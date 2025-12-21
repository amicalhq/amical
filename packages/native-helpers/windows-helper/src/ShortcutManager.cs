using System;
using System.Collections.Generic;
using System.Linq;

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
        private static readonly Lazy<ShortcutManager> _instance = new(() => new ShortcutManager());
        public static ShortcutManager Instance => _instance.Value;

        private readonly object _lock = new();
        private string[] _pushToTalkKeys = Array.Empty<string>();
        private string[] _toggleRecordingKeys = Array.Empty<string>();

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

                // Build set of currently active keys (modifiers + this regular key)
                var activeKeys = new HashSet<string>();
                if (modifiers.Win) activeKeys.Add("Win");
                if (modifiers.Ctrl) activeKeys.Add("Ctrl");
                if (modifiers.Alt) activeKeys.Add("Alt");
                if (modifiers.Shift) activeKeys.Add("Shift");

                // Add the regular key being pressed
                var keyName = VirtualKeyMap.GetKeyName(vkCode);
                if (keyName != null)
                {
                    activeKeys.Add(keyName);
                }

                // PTT: subset match (all PTT keys pressed, possibly with extras)
                var pttKeys = new HashSet<string>(_pushToTalkKeys);
                var pttMatch = pttKeys.Count > 0 && pttKeys.IsSubsetOf(activeKeys);

                // Toggle: exact match (only these keys pressed)
                var toggleKeys = new HashSet<string>(_toggleRecordingKeys);
                var toggleMatch = toggleKeys.Count > 0 && toggleKeys.SetEquals(activeKeys);

                return pttMatch || toggleMatch;
            }
        }
    }
}
