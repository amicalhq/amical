using System;
using System.Collections.Generic;
using System.Diagnostics;
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

        private const ushort VK_CONTROL = 0x11;
        // Left/right-distinct modifier VKs. We must mask the SPECIFIC held key,
        // never the aggregate VK_SHIFT (0x10) / VK_MENU (0x12): SendInput
        // resolves an aggregate-VK release to the LEFT key, so a held RIGHT
        // modifier would survive — turning the injected Ctrl+Insert into
        // Ctrl+Shift+Insert (= paste, i.e. clipboard dumped into the document)
        // or Ctrl+Alt+Insert.
        private const ushort VK_LSHIFT = 0xA0;
        private const ushort VK_RSHIFT = 0xA1;
        private const ushort VK_LMENU = 0xA4;   // left Alt
        private const ushort VK_RMENU = 0xA5;   // right Alt (extended)
        private const ushort VK_LWIN = 0x5B;    // extended
        private const ushort VK_RWIN = 0x5C;    // extended
        private const ushort VK_V = 0x56;
        private const ushort VK_INSERT = 0x2D;

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
            VK_LSHIFT => "LShift",
            VK_RSHIFT => "RShift",
            VK_CONTROL => "Ctrl",
            VK_LMENU => "LAlt",
            VK_RMENU => "RAlt",
            VK_LWIN => "LWin",
            VK_RWIN => "RWin",
            _ => $"0x{vk:X2}",
        };

        /// <summary>
        /// Collects any currently held non-Ctrl modifiers that could interfere
        /// with the Ctrl chord, as (vk, extended-key flag) pairs. Checks the
        /// specific left/right keys (never the aggregate VK_SHIFT/VK_MENU — see
        /// the const comments) and tags the keys whose release requires
        /// KEYEVENTF_EXTENDEDKEY (right Alt and both Win keys) so the injected
        /// key-up maps to the correct scancode. Intentionally tuned for
        /// Amical's dictation paste/copy flow, not a general-purpose "preserve
        /// arbitrary held modifiers" primitive.
        /// </summary>
        private (ushort Vk, uint Flags)[] GetHeldModifiersToMask()
        {
            (ushort Vk, uint Flags)[] candidates =
            {
                (VK_LSHIFT, 0u),
                (VK_RSHIFT, 0u),
                (VK_LMENU, 0u),
                (VK_RMENU, KeyboardInput.KEYEVENTF_EXTENDEDKEY),
                (VK_LWIN, KeyboardInput.KEYEVENTF_EXTENDEDKEY),
                (VK_RWIN, KeyboardInput.KEYEVENTF_EXTENDEDKEY),
            };
            var heldModifiers = new List<(ushort, uint)>();

            foreach (var (vk, flags) in candidates)
            {
                if (!IsKeyDown(vk))
                    continue;

                LogToStderr($"Modifier key {VkName(vk)} is held down, masking before chord");
                heldModifiers.Add((vk, flags));
            }

            return heldModifiers.ToArray();
        }

        /// <summary>
        /// Simulates a Ctrl+key chord using a single SendInput batch. Any
        /// interfering non-Ctrl modifiers are released inside the same batch
        /// immediately before the key is pressed: keeping Ctrl down around those
        /// key-ups prevents the OS from reacting to them as naked Alt/Win
        /// releases. The synthetic Ctrl press is paired with a synthetic Ctrl
        /// release — we are ending the shortcut-driven gesture rather than
        /// trying to preserve arbitrary held modifier state (if a user rebinds a
        /// shortcut to include Ctrl, any still-held Ctrl is treated as part of
        /// that gesture, same ballpark as the non-Ctrl modifiers cleared here).
        /// </summary>
        private bool SimulateCtrlChord(ushort vk, uint keyFlags = 0)
        {
            var heldModifiers = GetHeldModifiersToMask();
            var inputs = new List<KeyboardInput.INPUT>(heldModifiers.Length + 4);

            inputs.Add(KeyboardInput.KeyboardEvent(VK_CONTROL));

            foreach (var (heldVk, heldFlags) in heldModifiers)
            {
                inputs.Add(KeyboardInput.KeyboardEvent(heldVk, heldFlags | KeyboardInput.KEYEVENTF_KEYUP));
            }

            inputs.Add(KeyboardInput.KeyboardEvent(vk, keyFlags));
            inputs.Add(KeyboardInput.KeyboardEvent(vk, keyFlags | KeyboardInput.KEYEVENTF_KEYUP));

            inputs.Add(KeyboardInput.KeyboardEvent(VK_CONTROL, KeyboardInput.KEYEVENTF_KEYUP));

            var (sent, error) = KeyboardInput.Send(inputs.ToArray());
            if (sent != inputs.Count)
            {
                LogToStderr($"SendInput returned {sent}/{inputs.Count} for Ctrl chord (vk={vk}), error code: {error}");
                return false;
            }

            return true;
        }

        /// <summary>
        /// Simulates Ctrl+V paste for the dictation-driven paste path.
        /// </summary>
        private bool SimulatePaste() => SimulateCtrlChord(VK_V);

        /// <summary>
        /// Simulates the copy chord. Ctrl+Insert rather than Ctrl+C: it is the
        /// same "copy" binding in Win32 edit controls, Chromium/Electron, Office
        /// and terminals, but never doubles as SIGINT in a console the way
        /// Ctrl+C does when nothing is selected. Insert is an extended key;
        /// without the flag it can be read as numpad-Ins.
        /// </summary>
        private bool SimulateCopy() =>
            SimulateCtrlChord(VK_INSERT, KeyboardInput.KEYEVENTF_EXTENDEDKEY);

        /// <summary>
        /// Clipboard-copy selection capture; see the GetSelectedTextViaCopy schema
        /// in @amical/types for the contract and caveats. The clipboard is never
        /// cleared up front — the sequence number tells us whether a copy landed,
        /// so when nothing lands the clipboard is untouched.
        /// </summary>
        public GetSelectedTextViaCopyResult GetSelectedTextViaCopy()
        {
            var result = new GetSelectedTextViaCopyResult();

            try
            {
                var savedContent = clipboardService.SaveForClipboardTransaction();
                if (savedContent.SaveFailed)
                {
                    // Injecting a copy could overwrite content we cannot restore.
                    result.Message = "Clipboard save failed (busy/locked); skipping copy capture";
                    LogToStderr(result.Message);
                    return result;
                }

                var baselineSeq = clipboardService.GetSequenceNumber();

                if (!SimulateCopy())
                {
                    result.Message = "SendInput failed for copy chord";
                    return result;
                }

                // Wait for the app's copy to land (sequence bump), best-effort.
                // No bump within the timeout means no selection, an app that
                // ignores the chord, or a slow app — indistinguishable.
                var sw = Stopwatch.StartNew();
                while (sw.ElapsedMilliseconds < Constants.COPY_CAPTURE_TIMEOUT_MS)
                {
                    if (clipboardService.GetSequenceNumber() != baselineSeq)
                    {
                        result.ClipboardChanged = true;
                        break;
                    }
                    Thread.Sleep(Constants.COPY_CAPTURE_POLL_INTERVAL_MS);
                }

                if (!result.ClipboardChanged)
                {
                    // Clipboard untouched — nothing to read, nothing to restore.
                    // Accepted tradeoff: if the app responds to the chord AFTER
                    // this timeout, that late copy lands on the clipboard and is
                    // not restored over. A delayed restore can't distinguish a
                    // late injected copy from a manual user copy in the interim,
                    // and clobbering the latter would be data loss.
                    return result;
                }

                var observedSeq = clipboardService.GetSequenceNumber();

                // null when the copy produced no text (e.g. an image selection);
                // ClipboardChanged disambiguates that from "nothing happened".
                result.SelectedText = clipboardService.GetTextOrNull();

                // Restore behind the sequence-number guard: an external write
                // after observedSeq is preserved rather than clobbered.
                var restoreWarning = clipboardService.RestoreSync(savedContent, observedSeq);
                if (restoreWarning != null)
                {
                    result.Message = $"Copy captured with clipboard restoration warning: {restoreWarning}";
                    LogToStderr(result.Message);
                }

                return result;
            }
            catch (Exception ex)
            {
                LogException("Error in GetSelectedTextViaCopy", ex);
                result.Message = BuildExceptionDetail("Error in GetSelectedTextViaCopy", ex);
                return result;
            }
        }

        public bool PasteText(string text, bool preserveClipboard, out string? errorMessage)
        {
            errorMessage = null;

            try
            {
                LogToStderr($"PasteText called with text length: {text.Length}, preserveClipboard: {preserveClipboard}");

                // Snapshot only when it will be restored. Both paste and Draft
                // selection capture use the same detachable-format policy.
                var savedContent = preserveClipboard
                    ? clipboardService.SaveForClipboardTransaction()
                    : null;
                if (savedContent != null)
                {
                    var originalSeq = clipboardService.GetSequenceNumber();
                    LogToStderr($"Original clipboard saved. Sequence number: {originalSeq}");
                }
                else
                {
                    LogToStderr("preserveClipboard=false, skipping clipboard snapshot.");
                }

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

                if (savedContent != null)
                {
                    // Restore original clipboard synchronously and report errors
                    var restoreWarning = clipboardService.RestoreSync(savedContent, newSeq);
                    if (restoreWarning != null)
                    {
                        // Paste succeeded; report clipboard preservation problems as partial success.
                        errorMessage = $"Paste succeeded with clipboard restoration warning: {restoreWarning}";
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
