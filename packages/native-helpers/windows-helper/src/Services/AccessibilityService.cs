using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
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
                
                // Set clipboard content
                Thread thread = new Thread(() =>
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
                thread.SetApartmentState(ApartmentState.STA);
                thread.Start();
                thread.Join();
                
                // Small delay to ensure clipboard is set
                Thread.Sleep(100);
                
                // Simulate Ctrl+V
                // Press Ctrl
                keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
                Thread.Sleep(50);
                
                // Press V
                keybd_event(VK_V, 0, 0, UIntPtr.Zero);
                Thread.Sleep(50);
                
                // Release V
                keybd_event(VK_V, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                Thread.Sleep(50);
                
                // Release Ctrl
                keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                
                LogToStderr("Paste command sent successfully");
                return true;
            }
            catch (Exception ex)
            {
                LogToStderr($"Error in PasteText: {ex.Message}");
                return false;
            }
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