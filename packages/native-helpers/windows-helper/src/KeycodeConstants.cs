using System;
using System.Collections.Generic;

namespace WindowsHelper
{
    internal static class KeycodeConstants
    {
        // Left/right modifier virtual key codes
        internal const int VkLShift = 0xA0;
        internal const int VkRShift = 0xA1;
        internal const int VkLControl = 0xA2;
        internal const int VkRControl = 0xA3;
        internal const int VkLMenu = 0xA4; // Left Alt
        internal const int VkRMenu = 0xA5; // Right Alt
        internal const int VkLWin = 0x5B;
        internal const int VkRWin = 0x5C;

        internal static readonly int[] ModifierKeyCodes =
        {
            VkLShift,
            VkRShift,
            VkLControl,
            VkRControl,
            VkLMenu,
            VkRMenu,
            VkLWin,
            VkRWin,
        };

        internal static readonly HashSet<int> ModifierKeyCodeSet = new(ModifierKeyCodes);

        /// <summary>
        /// Sentinel stamped into dwExtraInfo on keyboard events the helper injects itself
        /// (the Ctrl+V paste chord and modifier-masking releases in AccessibilityService).
        /// The low-level keyboard hook uses this tag to tell our OWN injected events apart
        /// from third-party injected input: our own events are ALWAYS dropped (so no
        /// feedback loop forms), while third-party injected keys are honored only when the
        /// AllowInjectedKeys setting is on (see ShortcutMonitor.HookCallback). Mirrors the
        /// macOS helper's SELF_GENERATED_EVENT_TAG (0x414D4943414C5048 = "AMICALPH").
        /// </summary>
        internal static readonly IntPtr SelfInjectedEventTag = unchecked((IntPtr)0x414D4943414C5048L);
    }
}
