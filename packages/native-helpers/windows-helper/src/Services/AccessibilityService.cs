using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using WindowsHelper.Models;

namespace WindowsHelper.Services
{
    public class AccessibilityService
    {
        #region Windows API
        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        private static extern int GetWindowTextLength(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        [DllImport("user32.dll")]
        private static extern IntPtr GetFocus();

        [DllImport("user32.dll")]
        private static extern bool keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        private static extern void Sleep(int dwMilliseconds);

        [DllImport("user32.dll")]
        private static extern int GetClipboardSequenceNumber();

        private const byte VK_CONTROL = 0x11;
        private const byte VK_V = 0x56;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        #endregion

        private readonly UIAutomationService uiAutomationService;

        public AccessibilityService()
        {
            uiAutomationService = new UIAutomationService();
        }

        public AccessibilityElementNode? FetchAccessibilityTree(string? rootId)
        {
            // Delegate to UI Automation service for real implementation
            return uiAutomationService.FetchAccessibilityTree(rootId);
        }

        public AccessibilityContext GetAccessibilityContext(bool editableOnly)
        {
            // Delegate to UI Automation service for real implementation
            return uiAutomationService.GetAccessibilityContext(editableOnly);
        }

        public bool PasteText(string text)
        {
            try
            {
                LogToStderr($"PasteText called with text length: {text.Length}");

                // Save original clipboard content and sequence number (like Swift's changeCount)
                IDataObject? originalClipboard = null;
                int originalSequenceNumber = GetClipboardSequenceNumber();

                Thread saveThread = new Thread(() =>
                {
                    try
                    {
                        if (Clipboard.ContainsText() || Clipboard.ContainsImage() || Clipboard.ContainsFileDropList())
                        {
                            originalClipboard = Clipboard.GetDataObject();
                        }
                    }
                    catch (Exception ex)
                    {
                        LogToStderr($"Error saving original clipboard: {ex.Message}");
                    }
                });
                saveThread.SetApartmentState(ApartmentState.STA);
                saveThread.Start();
                saveThread.Join();

                LogToStderr($"Original clipboard saved. Sequence number: {originalSequenceNumber}");

                // Set new clipboard content
                Thread setThread = new Thread(() =>
                {
                    try
                    {
                        Clipboard.SetText(text);
                    }
                    catch (Exception ex)
                    {
                        LogToStderr($"Error setting clipboard: {ex.Message}");
                    }
                });
                setThread.SetApartmentState(ApartmentState.STA);
                setThread.Start();
                setThread.Join();

                int newSequenceNumber = GetClipboardSequenceNumber();
                LogToStderr($"Clipboard set. New sequence number: {newSequenceNumber}");

                // Small delay to ensure clipboard is set
                Thread.Sleep(50);

                // Simulate Ctrl+V
                keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
                keybd_event(VK_V, 0, 0, UIntPtr.Zero);
                keybd_event(VK_V, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);

                LogToStderr("Paste command sent successfully");

                // Restore original clipboard after delay (like Swift's 200ms)
                if (originalClipboard != null)
                {
                    Task.Run(async () =>
                    {
                        await Task.Delay(200);
                        RestoreClipboard(originalClipboard, newSequenceNumber);
                    });
                }

                return true;
            }
            catch (Exception ex)
            {
                LogToStderr($"Error in PasteText: {ex.Message}");
                return false;
            }
        }

        private void RestoreClipboard(IDataObject originalClipboard, int expectedSequenceNumber)
        {
            Thread restoreThread = new Thread(() =>
            {
                try
                {
                    int currentSequenceNumber = GetClipboardSequenceNumber();

                    // Only restore if our temporary content is still on the clipboard
                    // (sequence number incremented by exactly 1 from when we set it)
                    if (currentSequenceNumber == expectedSequenceNumber)
                    {
                        Clipboard.SetDataObject(originalClipboard, true);
                        LogToStderr("Original clipboard content restored.");
                    }
                    else
                    {
                        // Another app modified the clipboard - don't interfere
                        LogToStderr($"Clipboard changed by another process (expected: {expectedSequenceNumber}, current: {currentSequenceNumber}); not restoring to avoid conflict.");
                    }
                }
                catch (Exception ex)
                {
                    LogToStderr($"Error restoring clipboard: {ex.Message}");
                }
            });
            restoreThread.SetApartmentState(ApartmentState.STA);
            restoreThread.Start();
            restoreThread.Join();
        }

        private string GetWindowTitle(IntPtr hwnd)
        {
            int length = GetWindowTextLength(hwnd);
            if (length == 0) return string.Empty;
            
            StringBuilder sb = new StringBuilder(length + 1);
            GetWindowText(hwnd, sb, sb.Capacity);
            return sb.ToString();
        }

        private void LogToStderr(string message)
        {
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            Console.Error.WriteLine($"[{timestamp}] [AccessibilityService] {message}");
            Console.Error.Flush();
        }
    }
}