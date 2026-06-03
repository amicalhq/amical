using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using WindowsHelper.Models;
using WindowsHelper.Utils;

namespace WindowsHelper.Services
{
    public class AccessibilityService
    {
        #region Windows API

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        private const ushort VK_SHIFT = 0x10;
        private const ushort VK_CONTROL = 0x11;
        private const ushort VK_ALT = 0x12;     // VK_MENU
        private const ushort VK_LWIN = 0x5B;
        private const ushort VK_RWIN = 0x5C;
        private const ushort VK_V = 0x56;

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

        /// <summary>
        /// Simulates Ctrl+V paste using a single SendInput batch. Any interfering
        /// non-Ctrl modifiers are released inside the same batch immediately before
        /// V is pressed.
        /// </summary>
        private bool SimulatePaste()
        {
            var heldModifiers = GetHeldModifiersToMask();
            var inputs = new List<KeyboardInput.INPUT>(heldModifiers.Length + 4);

            // Always synthesize the full Ctrl+V chord for this dictation-driven
            // paste path. If a user rebinds a shortcut to include Ctrl, we treat any
            // still-held Ctrl here as part of the shortcut gesture that is expected
            // to end immediately after activation, same ballpark as the non-Ctrl
            // modifiers cleared above.
            inputs.Add(KeyboardInput.KeyboardEvent(VK_CONTROL));

            // Release any interfering modifiers before V is pressed. Keeping Ctrl
            // down around these key-ups prevents the OS from reacting to them as
            // naked Alt/Win releases while still keeping the whole operation in one
            // SendInput batch.
            foreach (var vk in heldModifiers)
            {
                inputs.Add(KeyboardInput.KeyboardEvent(vk, KeyboardInput.KEYEVENTF_KEYUP));
            }

            // V down
            inputs.Add(KeyboardInput.KeyboardEvent(VK_V));

            // V up
            inputs.Add(KeyboardInput.KeyboardEvent(VK_V, KeyboardInput.KEYEVENTF_KEYUP));

            // Pair the synthetic Ctrl press with a synthetic Ctrl release for the
            // same reason: in this helper we are ending the shortcut-driven paste
            // gesture rather than trying to preserve arbitrary held modifier state.
            inputs.Add(KeyboardInput.KeyboardEvent(VK_CONTROL, KeyboardInput.KEYEVENTF_KEYUP));

            var (sent, error) = KeyboardInput.Send(inputs.ToArray());
            if (sent != inputs.Count)
            {
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
