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

                        var vkCode = (int)kbStruct.vkCode;
                        var isModifier = IsModifierKey(kbStruct.vkCode);

                        if (isModifier)
                        {
                            var wasDown = ShortcutManager.Instance.IsModifierPressed(vkCode);
                            var isDown = isKeyDown;

                            if (wasDown == isDown)
                            {
                                return CallNextHookEx(hookId, nCode, wParam, lParam);
                            }

                            if (ShortcutManager.Instance.IsShortcutKey(vkCode))
                            {
                                var resyncResult = ShortcutManager.Instance.ValidateAndResyncKeyState(vkCode);
                                EmitResyncKeyEvents(resyncResult, vkCode);
                            }

                            ShortcutManager.Instance.SetModifierKey(vkCode, isDown);
                            EmitKeyEvent(isDown ? HelperEventType.KeyDown : HelperEventType.KeyUp, vkCode);
                        }
                        else
                        {
                            if (isKeyUp)
                            {
                                ShortcutManager.Instance.RemoveRegularKey(vkCode);
                            }

                            if (ShortcutManager.Instance.IsShortcutKey(vkCode))
                            {
                                var resyncResult = ShortcutManager.Instance.ValidateAndResyncKeyState(vkCode);
                                EmitResyncKeyEvents(resyncResult, vkCode);
                            }

                            EmitKeyEvent(
                                isKeyDown ? HelperEventType.KeyDown : HelperEventType.KeyUp,
                                vkCode
                            );

                            // Track regular key state for multi-key shortcuts
                            if (isKeyDown)
                            {
                                ShortcutManager.Instance.AddRegularKey(vkCode);
                            }

                            // Check if this key event should be consumed (prevent default behavior)
                            if (ShortcutManager.Instance.ShouldConsumeKey(vkCode))
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

        private bool IsModifierKey(uint vkCode)
        {
            return KeycodeConstants.ModifierKeyCodeSet.Contains((int)vkCode);
        }

        private void EmitKeyEvent(HelperEventType type, int keyCode)
        {
            var modifiers = ShortcutManager.Instance.GetModifierState();
            var keyEvent = new HelperEvent
            {
                Type = type,
                Timestamp = DateTime.UtcNow,
                Payload = new HelperEventPayload
                {
                    Key = null,
                    KeyCode = keyCode,
                    AltKey = modifiers.Alt,
                    CtrlKey = modifiers.Ctrl,
                    ShiftKey = modifiers.Shift,
                    MetaKey = modifiers.Win,
                    FnKeyPressed = false // Windows doesn't have standard Fn key detection
                }
            };

            KeyEventOccurred?.Invoke(this, keyEvent);
        }

        private void EmitResyncKeyEvents(ShortcutManager.KeyResyncResult resyncResult, int? excludeKeyCode)
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

        }

        private void LogToStderr(string message)
        {
            HelperLogger.LogToStderr($"[ShortcutMonitor] {message}");
        }

    }
}
