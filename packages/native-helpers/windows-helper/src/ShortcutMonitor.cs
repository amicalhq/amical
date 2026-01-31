using System;
using System.Collections.Generic;
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

                        var vkCode = kbStruct.vkCode;

                        var isModifier = IsModifierKey(vkCode);
                        var wasModifierDown = isModifier && IsModifierDown(vkCode);

                        // Update our internal modifier state tracking based on the actual key being pressed/released
                        UpdateModifierState(vkCode, isKeyDown);

                        if (ShortcutManager.Instance.IsShortcutKey((int)vkCode))
                        {
                            var resyncResult = ResyncKeyState();
                            var excludeKey = isKeyUp ? (int?)vkCode : null;
                            EmitResyncKeyEvents(resyncResult, excludeKey);
                        }

                        if (isModifier)
                        {
                            var isDown = IsModifierDown(vkCode);
                            if (isDown != wasModifierDown)
                            {
                                EmitKeyEvent(
                                    isDown ? HelperEventType.KeyDown : HelperEventType.KeyUp,
                                    (int)vkCode
                                );
                            }
                        }
                        else
                        {
                            EmitKeyEvent(
                                isKeyDown ? HelperEventType.KeyDown : HelperEventType.KeyUp,
                                (int)vkCode
                            );

                            // Track regular key state for multi-key shortcuts
                            if (isKeyDown)
                            {
                                ShortcutManager.Instance.AddRegularKey((int)vkCode);
                            }
                            else
                            {
                                ShortcutManager.Instance.RemoveRegularKey((int)vkCode);
                            }

                            // Check if this key event should be consumed (prevent default behavior)
                            var activeModifiers = GetActiveModifierKeyCodes();
                            if (ShortcutManager.Instance.ShouldConsumeKey((int)vkCode, activeModifiers))
                            {
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

        private bool IsModifierDown(uint vkCode)
        {
            return vkCode switch
            {
                KeycodeConstants.VkLShift => leftShiftPressed,
                KeycodeConstants.VkRShift => rightShiftPressed,
                KeycodeConstants.VkLControl => leftCtrlPressed,
                KeycodeConstants.VkRControl => rightCtrlPressed,
                KeycodeConstants.VkLMenu => leftAltPressed,
                KeycodeConstants.VkRMenu => rightAltPressed,
                KeycodeConstants.VkLWin => leftWinPressed,
                KeycodeConstants.VkRWin => rightWinPressed,
                _ => false
            };
        }

        private HashSet<int> GetActiveModifierKeyCodes()
        {
            var active = new HashSet<int>();
            if (leftShiftPressed) active.Add(KeycodeConstants.VkLShift);
            if (rightShiftPressed) active.Add(KeycodeConstants.VkRShift);
            if (leftCtrlPressed) active.Add(KeycodeConstants.VkLControl);
            if (rightCtrlPressed) active.Add(KeycodeConstants.VkRControl);
            if (leftAltPressed) active.Add(KeycodeConstants.VkLMenu);
            if (rightAltPressed) active.Add(KeycodeConstants.VkRMenu);
            if (leftWinPressed) active.Add(KeycodeConstants.VkLWin);
            if (rightWinPressed) active.Add(KeycodeConstants.VkRWin);
            return active;
        }

        private void UpdateModifierState(uint vkCode, bool isPressed)
        {
            switch (vkCode)
            {
                // Handle left/right specific codes (what Windows low-level hooks actually send)
                case KeycodeConstants.VkLShift:
                    leftShiftPressed = isPressed;
                    break;
                case KeycodeConstants.VkRShift:
                    rightShiftPressed = isPressed;
                    break;
                case KeycodeConstants.VkLControl:
                    leftCtrlPressed = isPressed;
                    break;
                case KeycodeConstants.VkRControl:
                    rightCtrlPressed = isPressed;
                    break;
                case KeycodeConstants.VkLMenu:
                    leftAltPressed = isPressed;
                    break;
                case KeycodeConstants.VkRMenu:
                    rightAltPressed = isPressed;
                    break;
                case KeycodeConstants.VkLWin:
                    leftWinPressed = isPressed;
                    break;
                case KeycodeConstants.VkRWin:
                    rightWinPressed = isPressed;
                    break;
            }
        }

        private bool IsModifierKey(uint vkCode)
        {
            return KeycodeConstants.ModifierKeyCodeSet.Contains((int)vkCode);
        }

        private void EmitKeyEvent(HelperEventType type, int keyCode)
        {
            var keyEvent = new HelperEvent
            {
                Type = type,
                Timestamp = DateTime.UtcNow,
                Payload = new HelperEventPayload
                {
                    Key = null,
                    KeyCode = keyCode,
                    AltKey = altPressed,
                    CtrlKey = ctrlPressed,
                    ShiftKey = shiftPressed,
                    MetaKey = winPressed,
                    FnKeyPressed = false // Windows doesn't have standard Fn key detection
                }
            };

            KeyEventOccurred?.Invoke(this, keyEvent);
        }

        private void EmitResyncKeyEvents(ResyncResult resyncResult, int? excludeKeyCode)
        {
            foreach (var keyCode in resyncResult.ClearedModifiers)
            {
                if (keyCode == excludeKeyCode) continue;
                EmitKeyEvent(HelperEventType.KeyUp, keyCode);
            }

            foreach (var keyCode in resyncResult.ClearedRegularKeys)
            {
                if (keyCode == excludeKeyCode) continue;
                EmitKeyEvent(HelperEventType.KeyUp, keyCode);
            }

            foreach (var keyCode in resyncResult.AddedModifiers)
            {
                if (keyCode == excludeKeyCode) continue;
                EmitKeyEvent(HelperEventType.KeyDown, keyCode);
            }
        }

        private void LogToStderr(string message)
        {
            HelperLogger.LogToStderr($"[ShortcutMonitor] {message}");
        }

        /// <summary>
        /// Check if a key is actually pressed using GetAsyncKeyState.
        /// </summary>
        private bool IsKeyActuallyPressed(int vkCode)
        {
            // High-order bit is set if key is currently down
            return (GetAsyncKeyState(vkCode) & 0x8000) != 0;
        }

        private sealed class ResyncResult
        {
            public List<int> ClearedModifiers { get; } = new();
            public List<int> AddedModifiers { get; } = new();
            public List<int> ClearedRegularKeys { get; set; } = new();
        }

        /// <summary>
        /// Validate that all tracked key states match actual OS state.
        /// If any key is not actually pressed, resync state and return details.
        /// This prevents stuck keys from blocking shortcuts.
        /// </summary>
        private ResyncResult ResyncKeyState()
        {
            var result = new ResyncResult();

            void ResyncModifier(int vkCode, ref bool trackedState, string name)
            {
                var isPressed = IsKeyActuallyPressed(vkCode);
                if (isPressed && !trackedState)
                {
                    LogToStderr($"Resync: {name} was missing, setting");
                    trackedState = true;
                    result.AddedModifiers.Add(vkCode);
                }
                else if (!isPressed && trackedState)
                {
                    LogToStderr($"Resync: {name} was stuck, clearing");
                    trackedState = false;
                    result.ClearedModifiers.Add(vkCode);
                }
            }

            ResyncModifier(KeycodeConstants.VkLShift, ref leftShiftPressed, "leftShift");
            ResyncModifier(KeycodeConstants.VkRShift, ref rightShiftPressed, "rightShift");
            ResyncModifier(KeycodeConstants.VkLControl, ref leftCtrlPressed, "leftCtrl");
            ResyncModifier(KeycodeConstants.VkRControl, ref rightCtrlPressed, "rightCtrl");
            ResyncModifier(KeycodeConstants.VkLMenu, ref leftAltPressed, "leftAlt");
            ResyncModifier(KeycodeConstants.VkRMenu, ref rightAltPressed, "rightAlt");
            ResyncModifier(KeycodeConstants.VkLWin, ref leftWinPressed, "leftWin");
            ResyncModifier(KeycodeConstants.VkRWin, ref rightWinPressed, "rightWin");

            // Validate regular keys tracked in ShortcutManager
            var staleKeys = ShortcutManager.Instance.ValidateAndClearStaleKeys();
            if (staleKeys.Count > 0)
            {
                LogToStderr($"Resync: Regular keys were stuck, cleared: [{string.Join(", ", staleKeys)}]");
                result.ClearedRegularKeys = staleKeys;
            }

            return result;
        }
    }
}
