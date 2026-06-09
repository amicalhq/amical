using System;
using System.Runtime.InteropServices;

namespace WindowsHelper.Utils
{
    /// <summary>
    /// Shared SendInput interop for synthesizing keyboard events. Used by
    /// KeyboardInjector (the masked Alt/Win release) and AccessibilityService (the
    /// Ctrl+V paste chord). The helper's own low-level keyboard hook skips every
    /// injected event (via LLKHF_INJECTED), so synthetic input never feeds back into
    /// shortcut matching or pressed-key tracking. Every event built here also carries
    /// KeycodeConstants.SelfInjectedEventTag in dwExtraInfo to mark it as ours.
    /// </summary>
    internal static class KeyboardInput
    {
        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        private const uint INPUT_KEYBOARD = 1;
        internal const uint KEYEVENTF_KEYUP = 0x0002;

        private static readonly int InputSize = Marshal.SizeOf<INPUT>();

        [StructLayout(LayoutKind.Sequential)]
        internal struct INPUT
        {
            public uint type;
            public INPUTUNION union;
        }

        // All three members at FieldOffset(0) so the runtime computes the union
        // size from the largest member (MOUSEINPUT), matching native sizeof(INPUT).
        [StructLayout(LayoutKind.Explicit)]
        internal struct INPUTUNION
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
            [FieldOffset(0)] public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        /// <summary>
        /// Build a keyboard INPUT for the given virtual key, tagged as self-injected
        /// so the helper's hook ignores it. Pass KEYEVENTF_KEYUP in flags for a key-up.
        /// </summary>
        internal static INPUT KeyboardEvent(ushort virtualKey, uint flags = 0) => new INPUT
        {
            type = INPUT_KEYBOARD,
            union = new INPUTUNION
            {
                ki = new KEYBDINPUT
                {
                    wVk = virtualKey,
                    wScan = 0,
                    dwFlags = flags,
                    time = 0,
                    dwExtraInfo = KeycodeConstants.SelfInjectedEventTag,
                }
            }
        };

        /// <summary>
        /// Dispatch the inputs in a single SendInput batch. Returns the number of
        /// events inserted (compare with inputs.Length to detect partial failure) and
        /// the Win32 error captured immediately after the call.
        /// </summary>
        internal static (uint Sent, int LastError) Send(INPUT[] inputs)
        {
            uint sent = SendInput((uint)inputs.Length, inputs, InputSize);
            return (sent, Marshal.GetLastWin32Error());
        }
    }
}
