using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using WindowsHelper.Models;

namespace WindowsHelper.Services
{
    public class AccessibilityService
    {
        #region Windows API

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        private const ushort VK_SHIFT = 0x10;
        private const ushort VK_CONTROL = 0x11;
        private const ushort VK_ALT = 0x12;     // VK_MENU
        private const ushort VK_LWIN = 0x5B;
        private const ushort VK_RWIN = 0x5C;
        private const ushort VK_V = 0x56;

        private const uint INPUT_KEYBOARD = 1;
        private const uint KEYEVENTF_KEYUP = 0x0002;

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT
        {
            public uint type;
            public INPUTUNION union;
        }

        // All three members at FieldOffset(0) so the runtime computes the union
        // size from the largest member (MOUSEINPUT), matching native sizeof(INPUT).
        [StructLayout(LayoutKind.Explicit)]
        private struct INPUTUNION
        {
            [FieldOffset(0)]
            public MOUSEINPUT mi;

            [FieldOffset(0)]
            public KEYBDINPUT ki;

            [FieldOffset(0)]
            public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        #endregion

        private readonly ClipboardService clipboardService;

        public AccessibilityService(ClipboardService clipboardService)
        {
            this.clipboardService = clipboardService;
        }

        public object? FetchAccessibilityTree(string? rootId)
        {
            // Tree fetching is no longer supported in the minimal approach
            LogToStderr("FetchAccessibilityTree is deprecated - tree traversal removed for performance");
            return null;
        }

        public Context? GetAccessibilityContext(bool editableOnly)
        {
            return AccessibilityContextService.GetAccessibilityContext(editableOnly);
        }

        /// <summary>
        /// Checks if a key is currently physically held down.
        /// </summary>
        private static bool IsKeyDown(int vk) => (GetAsyncKeyState(vk) & 0x8000) != 0;

        private static string VkName(ushort vk) => vk switch
        {
            VK_SHIFT => "Shift",
            VK_CONTROL => "Ctrl",
            VK_ALT => "Alt",
            VK_LWIN => "LWin",
            VK_RWIN => "RWin",
            _ => $"0x{vk:X2}",
        };

        /// <summary>
        /// Collects any currently held non-Ctrl modifiers that could interfere with
        /// Ctrl+V. This is intentionally tuned for Amical's dictation/post-dictation
        /// paste flow rather than as a general-purpose "preserve arbitrary held
        /// modifiers" primitive.
        /// </summary>
        private ushort[] GetHeldModifiersToMask()
        {
            ushort[] modifiersToMask = { VK_SHIFT, VK_ALT, VK_LWIN, VK_RWIN };
            var heldModifiers = new List<ushort>();

            foreach (var vk in modifiersToMask)
            {
                if (!IsKeyDown(vk))
                    continue;

                LogToStderr($"Modifier key {VkName(vk)} is held down, masking before paste");
                heldModifiers.Add(vk);
            }

            return heldModifiers.ToArray();
        }

        private static INPUT CreateKeyboardInput(ushort virtualKey, uint flags = 0)
        {
            return new INPUT
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
                        dwExtraInfo = IntPtr.Zero,
                    }
                }
            };
        }

        /// <summary>
        /// Simulates Ctrl+V paste using a single SendInput batch. Any interfering
        /// non-Ctrl modifiers are released inside the same batch immediately before
        /// V is pressed.
        /// </summary>
        private bool SimulatePaste()
        {
            var heldModifiers = GetHeldModifiersToMask();
            var inputs = new List<INPUT>(heldModifiers.Length + 4);
            int size = Marshal.SizeOf(typeof(INPUT));

            // Always synthesize the full Ctrl+V chord for this dictation-driven
            // paste path. If a user rebinds a shortcut to include Ctrl, we treat any
            // still-held Ctrl here as part of the shortcut gesture that is expected
            // to end immediately after activation, same ballpark as the non-Ctrl
            // modifiers cleared above.
            inputs.Add(CreateKeyboardInput(VK_CONTROL));

            // Release any interfering modifiers before V is pressed. Keeping Ctrl
            // down around these key-ups prevents the OS from reacting to them as
            // naked Alt/Win releases while still keeping the whole operation in one
            // SendInput batch.
            foreach (var vk in heldModifiers)
            {
                inputs.Add(CreateKeyboardInput(vk, KEYEVENTF_KEYUP));
            }

            // V down
            inputs.Add(CreateKeyboardInput(VK_V));

            // V up
            inputs.Add(CreateKeyboardInput(VK_V, KEYEVENTF_KEYUP));

            // Pair the synthetic Ctrl press with a synthetic Ctrl release for the
            // same reason: in this helper we are ending the shortcut-driven paste
            // gesture rather than trying to preserve arbitrary held modifier state.
            inputs.Add(CreateKeyboardInput(VK_CONTROL, KEYEVENTF_KEYUP));

            uint sent = SendInput((uint)inputs.Count, inputs.ToArray(), size);
            if (sent != inputs.Count)
            {
                int error = Marshal.GetLastWin32Error();
                LogToStderr($"SendInput returned {sent}/{inputs.Count}, error code: {error}");
                return false;
            }

            return true;
        }

        public bool PasteText(string text, bool preserveClipboard, out string? errorMessage)
        {
            errorMessage = null;

            try
            {
                LogToStderr($"PasteText called with text length: {text.Length}, preserveClipboard: {preserveClipboard}");

                // Save original clipboard content
                var savedContent = clipboardService.Save();
                var originalSeq = clipboardService.GetSequenceNumber();
                LogToStderr($"Original clipboard saved. Sequence number: {originalSeq}");

                // Set new clipboard content
                clipboardService.SetText(text);
                var newSeq = clipboardService.GetSequenceNumber();
                LogToStderr($"Clipboard set. New sequence number: {newSeq}");

                // Small delay to ensure clipboard is set
                Thread.Sleep(50);

                // This helper is used for dictation-driven paste paths. For the
                // post-dictation flow we clear lingering non-Ctrl shortcut modifiers
                // inside the same SendInput batch as Ctrl+V so the paste is not
                // interpreted as another shortcut such as Ctrl+Shift+V, Ctrl+Alt+V,
                // or Win+V.
                if (!SimulatePaste())
                {
                    LogToStderr("SendInput failed for Ctrl+V paste");
                }

                LogToStderr("Paste command sent successfully");

                // Wait for paste to complete before restoring
                Thread.Sleep(700);

                if (preserveClipboard)
                {
                    // Restore original clipboard synchronously and report errors
                    var restoreError = clipboardService.RestoreSync(savedContent, newSeq);
                    if (restoreError != null)
                    {
                        // Paste succeeded but restore failed - report as partial success
                        errorMessage = $"Paste succeeded but clipboard restore failed: {restoreError}";
                        LogToStderr(errorMessage);
                        // Still return true since the paste itself worked
                    }
                }
                else
                {
                    LogToStderr("preserveClipboard=false, skipping clipboard restoration.");
                }

                return true;
            }
            catch (Exception ex)
            {
                var detail = BuildExceptionDetail("Error in PasteText", ex);
                LogException("Error in PasteText", ex);
                errorMessage = detail;
                return false;
            }
        }

        private string BuildExceptionDetail(string context, Exception ex)
        {
            return $"{context}: {ex.GetType().Name} (0x{ex.HResult:X8}): {ex.Message}";
        }

        private void LogException(string context, Exception ex)
        {
            var detail = BuildExceptionDetail(context, ex);
            var stack = ex.StackTrace;
            if (!string.IsNullOrWhiteSpace(stack))
            {
                detail = $"{detail} | StackTrace: {stack.Replace(Environment.NewLine, " | ")}";
            }
            LogToStderr(detail);
        }

        private void LogToStderr(string message)
        {
            HelperLogger.LogToStderr($"[AccessibilityService] {message}");
        }
    }
}
