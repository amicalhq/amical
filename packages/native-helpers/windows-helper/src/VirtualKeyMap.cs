using System.Collections.Generic;

namespace WindowsHelper
{
    /// <summary>
    /// Windows Virtual Key code to key name mapping.
    /// Matches the Swift KeycodeMap.swift for cross-platform shortcut consistency.
    /// </summary>
    public static class VirtualKeyMap
    {
        // Virtual Key code constants
        private const int VK_BACK = 0x08;
        private const int VK_TAB = 0x09;
        private const int VK_RETURN = 0x0D;
        private const int VK_ESCAPE = 0x1B;
        private const int VK_SPACE = 0x20;
        private const int VK_LEFT = 0x25;
        private const int VK_UP = 0x26;
        private const int VK_RIGHT = 0x27;
        private const int VK_DOWN = 0x28;

        // Letters: 0x41-0x5A (A-Z)
        // Numbers: 0x30-0x39 (0-9)
        // Function keys: 0x70-0x7B (F1-F12)

        private static readonly Dictionary<int, string> VkCodeToKey = new()
        {
            // Note: Reverse lookup dictionary (KeyToVkCode) is auto-generated below
            // Letters (A-Z: 0x41-0x5A)
            { 0x41, "A" },
            { 0x42, "B" },
            { 0x43, "C" },
            { 0x44, "D" },
            { 0x45, "E" },
            { 0x46, "F" },
            { 0x47, "G" },
            { 0x48, "H" },
            { 0x49, "I" },
            { 0x4A, "J" },
            { 0x4B, "K" },
            { 0x4C, "L" },
            { 0x4D, "M" },
            { 0x4E, "N" },
            { 0x4F, "O" },
            { 0x50, "P" },
            { 0x51, "Q" },
            { 0x52, "R" },
            { 0x53, "S" },
            { 0x54, "T" },
            { 0x55, "U" },
            { 0x56, "V" },
            { 0x57, "W" },
            { 0x58, "X" },
            { 0x59, "Y" },
            { 0x5A, "Z" },

            // Numbers (0-9: 0x30-0x39)
            { 0x30, "0" },
            { 0x31, "1" },
            { 0x32, "2" },
            { 0x33, "3" },
            { 0x34, "4" },
            { 0x35, "5" },
            { 0x36, "6" },
            { 0x37, "7" },
            { 0x38, "8" },
            { 0x39, "9" },

            // Special keys
            { VK_TAB, "Tab" },
            { VK_SPACE, "Space" },
            { VK_BACK, "Delete" },  // Backspace = Delete (same as Swift)
            { VK_RETURN, "Enter" },
            { VK_ESCAPE, "Escape" },

            // Function keys (F1-F12: 0x70-0x7B)
            { 0x70, "F1" },
            { 0x71, "F2" },
            { 0x72, "F3" },
            { 0x73, "F4" },
            { 0x74, "F5" },
            { 0x75, "F6" },
            { 0x76, "F7" },
            { 0x77, "F8" },
            { 0x78, "F9" },
            { 0x79, "F10" },
            { 0x7A, "F11" },
            { 0x7B, "F12" },

            // Arrow keys
            { VK_LEFT, "Left" },
            { VK_RIGHT, "Right" },
            { VK_DOWN, "Down" },
            { VK_UP, "Up" },

            // Punctuation and symbols
            { 0xBD, "-" },      // VK_OEM_MINUS
            { 0xBB, "=" },      // VK_OEM_PLUS (equals sign without shift)
            { 0xDB, "[" },      // VK_OEM_4
            { 0xDD, "]" },      // VK_OEM_6
            { 0xDC, "\\" },     // VK_OEM_5
            { 0xBA, ";" },      // VK_OEM_1
            { 0xDE, "'" },      // VK_OEM_7
            { 0xBC, "," },      // VK_OEM_COMMA
            { 0xBE, "." },      // VK_OEM_PERIOD
            { 0xBF, "/" },      // VK_OEM_2
            { 0xC0, "`" },      // VK_OEM_3
        };

        // Reverse lookup: key name to VK code (auto-generated from VkCodeToKey)
        private static readonly Dictionary<string, int> KeyToVkCode;

        static VirtualKeyMap()
        {
            KeyToVkCode = new Dictionary<string, int>();
            foreach (var kvp in VkCodeToKey)
            {
                KeyToVkCode[kvp.Value] = kvp.Key;
            }
        }

        /// <summary>
        /// Convert a Windows Virtual Key code to a key name string.
        /// Returns null if the keycode is not mapped.
        /// </summary>
        public static string? GetKeyName(int vkCode)
        {
            return VkCodeToKey.TryGetValue(vkCode, out var name) ? name : null;
        }

        /// <summary>
        /// Convert a key name string to a Windows Virtual Key code.
        /// Returns null if the key name is not mapped.
        /// </summary>
        public static int? GetVkCode(string keyName)
        {
            return KeyToVkCode.TryGetValue(keyName, out var vkCode) ? vkCode : null;
        }
    }
}
