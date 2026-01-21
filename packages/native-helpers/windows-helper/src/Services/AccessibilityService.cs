using System;
using System.Runtime.InteropServices;
using System.Threading;
using WindowsHelper.Models;

namespace WindowsHelper.Services
{
    public class AccessibilityService
    {
        #region Windows API
        [DllImport("user32.dll")]
        private static extern bool keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        private const byte VK_CONTROL = 0x11;
        private const byte VK_V = 0x56;
        private const uint KEYEVENTF_KEYUP = 0x0002;
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

        public bool PasteText(string text, out string? errorMessage)
        {
            errorMessage = null;

            try
            {
                LogToStderr($"PasteText called with text length: {text.Length}");

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

                // Simulate Ctrl+V
                keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
                keybd_event(VK_V, 0, 0, UIntPtr.Zero);
                keybd_event(VK_V, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);

                LogToStderr("Paste command sent successfully");

                // Wait for paste to complete before restoring
                Thread.Sleep(200);

                // Restore original clipboard synchronously and report errors
                var restoreError = clipboardService.RestoreSync(savedContent, newSeq);
                if (restoreError != null)
                {
                    // Paste succeeded but restore failed - report as partial success
                    errorMessage = $"Paste succeeded but clipboard restore failed: {restoreError}";
                    LogToStderr(errorMessage);
                    // Still return true since the paste itself worked
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
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            Console.Error.WriteLine($"[{timestamp}] [AccessibilityService] {message}");
            Console.Error.Flush();
        }
    }
}
