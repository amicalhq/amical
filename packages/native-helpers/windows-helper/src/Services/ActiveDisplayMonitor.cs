using System;
using System.Runtime.InteropServices;
using WindowsHelper.Models;

namespace WindowsHelper.Services
{
    /// <summary>
    /// Notifies the desktop app whenever the foreground window changes, so it can
    /// relocate the recording widget to the display the user is working on. This
    /// is the Windows equivalent of macOS's NSWorkspaceActiveDisplayDidChange
    /// notification.
    ///
    /// Like that notification, the emitted event is a bare trigger with no
    /// payload — the desktop app reads the cursor position to pick the display.
    /// We emit on every foreground change and deliberately do NOT dedupe here:
    /// the desktop decides the target display from the cursor, so deduping on any
    /// other key (e.g. the foreground window's monitor) could suppress an event
    /// the desktop needs and strand the widget on the wrong display.
    ///
    /// The WinEvent hook is installed with WINEVENT_OUTOFCONTEXT, so its callback
    /// is delivered to the message queue of the thread that installs it. It must
    /// therefore be started on a thread that pumps Windows messages — the main
    /// WinForms thread (Application.Run in Program.cs).
    /// </summary>
    public class ActiveDisplayMonitor
    {
        /// <summary>Raised when the foreground window changes.</summary>
        public event EventHandler<HelperEvent>? DisplayChanged;

        private IntPtr hookId = IntPtr.Zero;

        // Held for the lifetime of the hook: SetWinEventHook does not root the
        // marshalled callback, so without this reference it would be collected
        // and the callback would crash.
        private WinEventDelegate? callback;

        public void Start()
        {
            if (hookId != IntPtr.Zero) return;

            callback = OnForegroundChanged;
            hookId = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                IntPtr.Zero,
                callback,
                0,
                0,
                WINEVENT_OUTOFCONTEXT);

            if (hookId == IntPtr.Zero)
            {
                LogToStderr("Failed to install foreground WinEvent hook");
                callback = null;
            }
            else
            {
                LogToStderr("Foreground WinEvent hook installed");
            }
        }

        public void Stop()
        {
            if (hookId != IntPtr.Zero)
            {
                UnhookWinEvent(hookId);
                hookId = IntPtr.Zero;
            }
            callback = null;
        }

        private void OnForegroundChanged(
            IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
            int idObject, int idChild, uint dwEventThread, uint dwmsEventTime)
        {
            try
            {
                if (hwnd == IntPtr.Zero) return;

                DisplayChanged?.Invoke(this, new HelperEvent
                {
                    Type = HelperEventType.ActiveDisplayChanged,
                    Timestamp = DateTime.UtcNow,
                });
            }
            catch (Exception ex)
            {
                LogToStderr($"Error handling foreground change: {ex.Message}");
            }
        }

        private void LogToStderr(string message)
        {
            HelperLogger.LogToStderr($"[ActiveDisplayMonitor] {message}");
        }

        #region Win32 interop

        private delegate void WinEventDelegate(
            IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
            int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);

        private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
        private const uint WINEVENT_OUTOFCONTEXT = 0x0000;

        [DllImport("user32.dll")]
        private static extern IntPtr SetWinEventHook(
            uint eventMin, uint eventMax, IntPtr hmodWinEventProc,
            WinEventDelegate lpfnWinEventProc, uint idProcess, uint idThread,
            uint dwFlags);

        [DllImport("user32.dll")]
        private static extern bool UnhookWinEvent(IntPtr hWinEventHook);

        #endregion
    }
}
