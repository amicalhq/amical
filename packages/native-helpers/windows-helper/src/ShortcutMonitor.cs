using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using WindowsHelper.Models;

namespace WindowsHelper
{
    /// <summary>
    /// Monitors global keyboard shortcuts using low-level hooks.
    /// Uses StaThreadRunner for STA thread execution.
    /// </summary>
    public class ShortcutMonitor
    {
        #region Windows API
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_KEYUP = 0x0101;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const int WM_SYSKEYUP = 0x0105;

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        // Virtual key codes for modifier keys
        private const int VK_SHIFT = 0x10;
        private const int VK_CONTROL = 0x11;
        private const int VK_MENU = 0x12; // Alt key
        private const int VK_LWIN = 0x5B; // Left Windows key
        private const int VK_RWIN = 0x5C; // Right Windows key

        // Left/right specific virtual key codes (Windows low-level hooks send these)
        private const int VK_LSHIFT = 0xA0;
        private const int VK_RSHIFT = 0xA1;
        private const int VK_LCONTROL = 0xA2;
        private const int VK_RCONTROL = 0xA3;
        private const int VK_LMENU = 0xA4;
        private const int VK_RMENU = 0xA5;
        #endregion

        private readonly StaThreadRunner staRunner;
        private IntPtr hookId = IntPtr.Zero;
        private LowLevelKeyboardProc? hookProc;

        // Track modifier key states internally to avoid GetAsyncKeyState issues
        // Track left and right separately to handle cases where both are pressed
        private bool leftShiftPressed = false;
        private bool rightShiftPressed = false;
        private bool leftCtrlPressed = false;
        private bool rightCtrlPressed = false;
        private bool leftAltPressed = false;
        private bool rightAltPressed = false;
        private bool leftWinPressed = false;
        private bool rightWinPressed = false;

        // Computed properties that combine left/right states
        private bool shiftPressed => leftShiftPressed || rightShiftPressed;
        private bool ctrlPressed => leftCtrlPressed || rightCtrlPressed;
        private bool altPressed => leftAltPressed || rightAltPressed;
        private bool winPressed => leftWinPressed || rightWinPressed;

        public event EventHandler<HelperEvent>? KeyEventOccurred;

        public ShortcutMonitor(StaThreadRunner staRunner)
        {
            this.staRunner = staRunner;
        }

        /// <summary>
        /// Installs the keyboard hook on the STA thread.
        /// </summary>
        public void Start()
        {
            // Guard against multiple hook installations
            if (hookId != IntPtr.Zero) return;

            staRunner.InvokeOnSta(() =>
            {
                InstallHook();
                return true;
            }).Wait();
        }

        /// <summary>
        /// Removes the keyboard hook. Must be called before StaThreadRunner.Stop().
        /// </summary>
        public void Stop()
        {
            if (hookId == IntPtr.Zero) return;

            // Unhook must be called from the same thread that installed the hook
            var task = staRunner.InvokeOnSta(() =>
            {
                if (hookId != IntPtr.Zero)
                {
                    UnhookWindowsHookEx(hookId);
                    hookId = IntPtr.Zero;
                    LogToStderr("Shortcut hook removed");
                }
                return true;
            });

            // Wait with timeout to prevent hang if STA thread is already stopped
            if (!task.Wait(TimeSpan.FromSeconds(5)))
            {
                LogToStderr("Warning: Timeout waiting to unhook - STA thread may be unresponsive");
            }
        }

        private void InstallHook()
        {
            // Keep a reference to the delegate to prevent GC
            hookProc = HookCallback;

            using (Process curProcess = Process.GetCurrentProcess())
            using (ProcessModule? curModule = curProcess.MainModule)
            {
                if (curModule != null)
                {
                    hookId = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc,
                        GetModuleHandle(curModule.ModuleName), 0);
                }
            }

            if (hookId == IntPtr.Zero)
            {
                LogToStderr("Failed to install shortcut hook");
            }
            else
            {
                LogToStderr("Shortcut hook installed successfully");
            }
        }

        private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                try
                {
                    int msg = wParam.ToInt32();
                    bool isKeyDown = (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN);
                    bool isKeyUp = (msg == WM_KEYUP || msg == WM_SYSKEYUP);

                    if (isKeyDown || isKeyUp)
                    {
                        var kbStruct = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);

                        // Update our internal modifier state tracking based on the actual key being pressed/released
                        UpdateModifierState(kbStruct.vkCode, isKeyDown);

                        // Create event using our tracked modifier states
                        var keyEvent = new HelperEvent
                        {
                            Type = isKeyDown ? HelperEventType.KeyDown : HelperEventType.KeyUp,
                            Timestamp = DateTime.UtcNow,
                            Payload = new HelperEventPayload
                            {
                                KeyCode = (int)kbStruct.vkCode,
                                AltKey = altPressed,
                                CtrlKey = ctrlPressed,
                                ShiftKey = shiftPressed,
                                MetaKey = winPressed,
                                FnKeyPressed = false // Windows doesn't have standard Fn key detection
                            }
                        };

                        // Check for modifier key changes
                        if (IsModifierKey(kbStruct.vkCode))
                        {
                            // Send flagsChanged event for modifier keys with current tracked state
                            var flagsEvent = new HelperEvent
                            {
                                Type = HelperEventType.FlagsChanged,
                                Timestamp = DateTime.UtcNow,
                                Payload = new HelperEventPayload
                                {
                                    KeyCode = (int)kbStruct.vkCode,
                                    AltKey = altPressed,
                                    CtrlKey = ctrlPressed,
                                    ShiftKey = shiftPressed,
                                    MetaKey = winPressed,
                                    FnKeyPressed = false
                                }
                            };
                            KeyEventOccurred?.Invoke(this, flagsEvent);
                        }
                        else
                        {
                            // Send regular key event
                            KeyEventOccurred?.Invoke(this, keyEvent);

                            // Track regular key state for multi-key shortcuts
                            var keyName = VirtualKeyMap.GetKeyName((int)kbStruct.vkCode);
                            if (keyName != null)
                            {
                                if (isKeyDown)
                                {
                                    ShortcutManager.Instance.AddRegularKey(keyName);
                                }
                                else
                                {
                                    ShortcutManager.Instance.RemoveRegularKey(keyName);
                                }
                            }

                            // Check if this key event should be consumed (prevent default behavior)
                            var modifierState = new ModifierState
                            {
                                Win = winPressed,
                                Ctrl = ctrlPressed,
                                Alt = altPressed,
                                Shift = shiftPressed
                            };

                            if (ShortcutManager.Instance.ShouldConsumeKey((int)kbStruct.vkCode, modifierState))
                            {
                                // Before consuming, validate that all tracked keys are actually pressed.
                                // This prevents stuck keys (missed keyUp events) from blocking input system-wide.
                                if (!ValidateKeyStateBeforeConsume())
                                {
                                    // State was invalid (some keys were stuck), re-check with corrected state
                                    var correctedModifierState = new ModifierState
                                    {
                                        Win = winPressed,
                                        Ctrl = ctrlPressed,
                                        Alt = altPressed,
                                        Shift = shiftPressed
                                    };

                                    if (!ShortcutManager.Instance.ShouldConsumeKey((int)kbStruct.vkCode, correctedModifierState))
                                    {
                                        // After correction, we should NOT consume - let the key through
                                        return CallNextHookEx(hookId, nCode, wParam, lParam);
                                    }
                                }

                                // Consume - prevent default behavior (e.g., cursor movement for arrow keys)
                                return (IntPtr)1;
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    LogToStderr($"Error in hook callback: {ex.Message}");
                }
            }

            return CallNextHookEx(hookId, nCode, wParam, lParam);
        }

        private void UpdateModifierState(uint vkCode, bool isPressed)
        {
            switch (vkCode)
            {
                // Handle generic codes (fallback - Windows low-level hooks typically send left/right specific codes)
                case VK_SHIFT:
                    if (isPressed)
                    {
                        if (!rightShiftPressed)
                        {
                            leftShiftPressed = true;
                        }
                    }
                    else
                    {
                        if (!rightShiftPressed)
                        {
                            leftShiftPressed = false;
                        }
                    }
                    break;
                case VK_CONTROL:
                    if (isPressed)
                    {
                        if (!rightCtrlPressed)
                        {
                            leftCtrlPressed = true;
                        }
                    }
                    else
                    {
                        if (!rightCtrlPressed)
                        {
                            leftCtrlPressed = false;
                        }
                    }
                    break;
                case VK_MENU: // Alt key
                    if (isPressed)
                    {
                        if (!rightAltPressed)
                        {
                            leftAltPressed = true;
                        }
                    }
                    else
                    {
                        if (!rightAltPressed)
                        {
                            leftAltPressed = false;
                        }
                    }
                    break;

                // Handle left/right specific codes (what Windows low-level hooks actually send)
                case VK_LSHIFT:
                    leftShiftPressed = isPressed;
                    break;
                case VK_RSHIFT:
                    rightShiftPressed = isPressed;
                    break;
                case VK_LCONTROL:
                    leftCtrlPressed = isPressed;
                    break;
                case VK_RCONTROL:
                    rightCtrlPressed = isPressed;
                    break;
                case VK_LMENU:
                    leftAltPressed = isPressed;
                    break;
                case VK_RMENU:
                    rightAltPressed = isPressed;
                    break;
                case VK_LWIN:
                    leftWinPressed = isPressed;
                    break;
                case VK_RWIN:
                    rightWinPressed = isPressed;
                    break;
            }
        }

        private bool IsModifierKey(uint vkCode)
        {
            return vkCode == VK_SHIFT || vkCode == VK_LSHIFT || vkCode == VK_RSHIFT ||
                   vkCode == VK_CONTROL || vkCode == VK_LCONTROL || vkCode == VK_RCONTROL ||
                   vkCode == VK_MENU || vkCode == VK_LMENU || vkCode == VK_RMENU ||
                   vkCode == VK_LWIN || vkCode == VK_RWIN;
        }

        private void LogToStderr(string message)
        {
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            Console.Error.WriteLine($"[{timestamp}] [ShortcutMonitor] {message}");
            Console.Error.Flush();
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
        /// Validate that all tracked key states match actual OS state.
        /// If any key is not actually pressed, resync state and return false.
        /// This prevents stuck keys from causing keys to be consumed incorrectly.
        /// </summary>
        private bool ValidateKeyStateBeforeConsume()
        {
            bool stateValid = true;

            // Validate modifier keys
            if (leftShiftPressed && !IsKeyActuallyPressed(VK_LSHIFT))
            {
                LogToStderr("Resync: leftShift was stuck, clearing");
                leftShiftPressed = false;
                stateValid = false;
            }
            if (rightShiftPressed && !IsKeyActuallyPressed(VK_RSHIFT))
            {
                LogToStderr("Resync: rightShift was stuck, clearing");
                rightShiftPressed = false;
                stateValid = false;
            }
            if (leftCtrlPressed && !IsKeyActuallyPressed(VK_LCONTROL))
            {
                LogToStderr("Resync: leftCtrl was stuck, clearing");
                leftCtrlPressed = false;
                stateValid = false;
            }
            if (rightCtrlPressed && !IsKeyActuallyPressed(VK_RCONTROL))
            {
                LogToStderr("Resync: rightCtrl was stuck, clearing");
                rightCtrlPressed = false;
                stateValid = false;
            }
            if (leftAltPressed && !IsKeyActuallyPressed(VK_LMENU))
            {
                LogToStderr("Resync: leftAlt was stuck, clearing");
                leftAltPressed = false;
                stateValid = false;
            }
            if (rightAltPressed && !IsKeyActuallyPressed(VK_RMENU))
            {
                LogToStderr("Resync: rightAlt was stuck, clearing");
                rightAltPressed = false;
                stateValid = false;
            }
            if (leftWinPressed && !IsKeyActuallyPressed(VK_LWIN))
            {
                LogToStderr("Resync: leftWin was stuck, clearing");
                leftWinPressed = false;
                stateValid = false;
            }
            if (rightWinPressed && !IsKeyActuallyPressed(VK_RWIN))
            {
                LogToStderr("Resync: rightWin was stuck, clearing");
                rightWinPressed = false;
                stateValid = false;
            }

            // Validate regular keys tracked in ShortcutManager
            var staleKeys = ShortcutManager.Instance.ValidateAndClearStaleKeys();
            if (staleKeys.Count > 0)
            {
                LogToStderr($"Resync: Regular keys were stuck, cleared: [{string.Join(", ", staleKeys)}]");
                stateValid = false;
            }

            return stateValid;
        }
    }
}
