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
    }
}
