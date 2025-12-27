using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
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

        // For MsgWaitForMultipleObjects
        private const uint QS_ALLINPUT = 0x04FF;
        private const uint WAIT_OBJECT_0 = 0;
        private const uint WAIT_TIMEOUT = 258;
        private const uint INFINITE = 0xFFFFFFFF;
        private const int PM_REMOVE = 0x0001;

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

        [DllImport("user32.dll")]
        private static extern uint MsgWaitForMultipleObjects(uint nCount, IntPtr[] pHandles, bool bWaitAll, uint dwMilliseconds, uint dwWakeMask);

        [DllImport("user32.dll")]
        private static extern bool PeekMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, int wRemoveMsg);

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
        
        // Left/right specific virtual key codes (Windows low-level hooks send these)
        private const int VK_LSHIFT = 0xA0;
        private const int VK_RSHIFT = 0xA1;
        private const int VK_LCONTROL = 0xA2;
        private const int VK_RCONTROL = 0xA3;
        private const int VK_LMENU = 0xA4;
        private const int VK_RMENU = 0xA5;
        #endregion

        private IntPtr hookId = IntPtr.Zero;
        private LowLevelKeyboardProc? hookProc;
        private Thread? messageLoopThread;
        private bool isRunning = false;

        // STA thread work queue for dispatching work from other threads
        private readonly ConcurrentQueue<Action> staWorkQueue = new();
        private readonly AutoResetEvent staWorkEvent = new(false);

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

        /// <summary>
        /// Invokes an async action on the STA thread and waits for completion.
        /// Use this for audio/COM operations that require STA thread.
        /// </summary>
        public Task<T> InvokeOnStaAsync<T>(Func<Task<T>> asyncAction)
        {
            var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);

            staWorkQueue.Enqueue(async () =>
            {
                try
                {
                    var result = await asyncAction();
                    tcs.SetResult(result);
                }
                catch (Exception ex)
                {
                    tcs.SetException(ex);
                }
            });
            staWorkEvent.Set();

            return tcs.Task;
        }

        /// <summary>
        /// Invokes a synchronous action on the STA thread and waits for completion.
        /// Use this for audio/COM operations that require STA thread.
        /// </summary>
        public Task<T> InvokeOnSta<T>(Func<T> action)
        {
            var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);

            staWorkQueue.Enqueue(() =>
            {
                try
                {
                    var result = action();
                    tcs.SetResult(result);
                }
                catch (Exception ex)
                {
                    tcs.SetException(ex);
                }
            });
            staWorkEvent.Set();

            return tcs.Task;
        }

        /// <summary>
        /// Posts an action to the STA thread without waiting for completion.
        /// </summary>
        public void PostToSta(Action action)
        {
            staWorkQueue.Enqueue(action);
            staWorkEvent.Set();
        }

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
                LogToStderr("STA thread ready for work dispatch");

                // Run Windows message loop with support for STA work queue
                var waitHandles = new IntPtr[] { staWorkEvent.SafeWaitHandle.DangerousGetHandle() };

                while (isRunning)
                {
                    // Wait for either a Windows message or a work item
                    var waitResult = MsgWaitForMultipleObjects(1, waitHandles, false, INFINITE, QS_ALLINPUT);

                    if (waitResult == WAIT_OBJECT_0)
                    {
                        // Work item signaled - process all queued work
                        ProcessStaWorkQueue();
                    }
                    else if (waitResult == WAIT_OBJECT_0 + 1)
                    {
                        // Windows message available - process all pending messages
                        MSG msg;
                        while (PeekMessage(out msg, IntPtr.Zero, 0, 0, PM_REMOVE))
                        {
                            if (msg.message == 0x0012) // WM_QUIT
                            {
                                isRunning = false;
                                break;
                            }
                            TranslateMessage(ref msg);
                            DispatchMessage(ref msg);
                        }
                    }
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

        private void ProcessStaWorkQueue()
        {
            while (staWorkQueue.TryDequeue(out var action))
            {
                try
                {
                    action();
                }
                catch (Exception ex)
                {
                    LogToStderr($"Error processing STA work item: {ex.Message}");
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
                            // Send flagsChanged event for modifier keys with current tracked state
                            // State is already updated by UpdateModifierState above
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
                            // We need to track which non-modifier keys are held down so that
                            // shortcuts like Shift+A+B can work properly
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
                            // Only for regular key events, not modifiers
                            var modifierState = new ModifierState
                            {
                                Win = winPressed,
                                Ctrl = ctrlPressed,
                                Alt = altPressed,
                                Shift = shiftPressed
                            };

                            if (ShortcutManager.Instance.ShouldConsumeKey((int)kbStruct.vkCode, modifierState))
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

        private void UpdateModifierState(uint vkCode, bool isPressed)
        {
            switch (vkCode)
            {
                // Handle generic codes (fallback - Windows low-level hooks typically send left/right specific codes)
                // For generic codes, we update both sides to be safe, but this should rarely happen
                case VK_SHIFT:
                    // If we get a generic code, assume left (most common case)
                    // But also check if right is actually pressed to handle edge cases
                    if (isPressed)
                    {
                        // If right shift is already pressed, don't override it
                        if (!rightShiftPressed)
                        {
                            leftShiftPressed = true;
                        }
                    }
                    else
                    {
                        // On release, clear left unless right is still pressed
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

        private bool IsKeyPressed(int vKey)
        {
            return (GetAsyncKeyState(vKey) & 0x8000) != 0;
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