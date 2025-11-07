using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using WindowsHelper.Models;

namespace WindowsHelper
{
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
        private const int VK_FUNCTION = 0xFF; // Fn key (not standard, varies by keyboard)
        #endregion

        private IntPtr hookId = IntPtr.Zero;
        private LowLevelKeyboardProc? hookProc;
        private Thread? messageLoopThread;
        private bool isRunning = false;

        // Track modifier key states internally to avoid GetAsyncKeyState issues
        private bool shiftPressed = false;
        private bool ctrlPressed = false;
        private bool altPressed = false;
        private bool winPressed = false;

        public event EventHandler<HelperEvent>? KeyEventOccurred;

        public void Start()
        {
            if (isRunning) return;

            isRunning = true;
            messageLoopThread = new Thread(MessageLoop)
            {
                Name = "ShortcutHook",
                IsBackground = false
            };
            messageLoopThread.SetApartmentState(ApartmentState.STA);
            messageLoopThread.Start();
        }

        public void Stop()
        {
            isRunning = false;
            if (hookId != IntPtr.Zero)
            {
                UnhookWindowsHookEx(hookId);
                hookId = IntPtr.Zero;
            }
        }

        private void MessageLoop()
        {
            try
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
                    return;
                }

                LogToStderr("Shortcut hook installed successfully");

                // Run Windows message loop
                MSG msg;
                while (isRunning && GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
                {
                    TranslateMessage(ref msg);
                    DispatchMessage(ref msg);
                }
            }
            catch (Exception ex)
            {
                LogToStderr($"Error in shortcut message loop: {ex.Message}");
            }
            finally
            {
                if (hookId != IntPtr.Zero)
                {
                    UnhookWindowsHookEx(hookId);
                    hookId = IntPtr.Zero;
                }
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
                            // Send flagsChanged event for modifier keys
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
                case VK_SHIFT:
                    shiftPressed = isPressed;
                    break;
                case VK_CONTROL:
                    ctrlPressed = isPressed;
                    break;
                case VK_MENU: // Alt key
                    altPressed = isPressed;
                    break;
                case VK_LWIN:
                case VK_RWIN:
                    winPressed = isPressed;
                    break;
            }
        }

        private bool IsKeyPressed(int vKey)
        {
            return (GetAsyncKeyState(vKey) & 0x8000) != 0;
        }

        private bool IsModifierKey(uint vkCode)
        {
            return vkCode == VK_SHIFT || vkCode == VK_CONTROL || 
                   vkCode == VK_MENU || vkCode == VK_LWIN || vkCode == VK_RWIN;
        }

        private void LogToStderr(string message)
        {
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            Console.Error.WriteLine($"[{timestamp}] [ShortcutMonitor] {message}");
            Console.Error.Flush();
        }

        #region Windows Message Loop
        [StructLayout(LayoutKind.Sequential)]
        private struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public POINT pt;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int x;
            public int y;
        }

        [DllImport("user32.dll")]
        private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        private static extern bool TranslateMessage(ref MSG lpMsg);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage(ref MSG lpMsg);
        #endregion
    }
}