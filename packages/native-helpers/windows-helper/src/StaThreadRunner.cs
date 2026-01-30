using System;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace WindowsHelper
{
    /// <summary>
    /// Owns and manages a single STA thread for Windows operations that require
    /// single-threaded apartment (clipboard, COM, UI automation, etc).
    /// Provides thread-safe dispatch methods for executing work on the STA thread.
    /// </summary>
    public class StaThreadRunner
    {
        #region Windows API
        private const uint QS_ALLINPUT = 0x04FF;
        private const uint WAIT_OBJECT_0 = 0;
        private const uint INFINITE = 0xFFFFFFFF;
        private const int PM_REMOVE = 0x0001;

        [DllImport("user32.dll")]
        private static extern uint MsgWaitForMultipleObjects(uint nCount, IntPtr[] pHandles, bool bWaitAll, uint dwMilliseconds, uint dwWakeMask);

        [DllImport("user32.dll")]
        private static extern bool PeekMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, int wRemoveMsg);

        [DllImport("user32.dll")]
        private static extern bool TranslateMessage(ref MSG lpMsg);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage(ref MSG lpMsg);

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
        #endregion

        private Thread? thread;
        private readonly ConcurrentQueue<Action> workQueue = new();
        private readonly AutoResetEvent workEvent = new(false);
        private volatile bool isRunning;
        private int staThreadId;

        /// <summary>
        /// Returns true if the STA thread is running and accepting work.
        /// </summary>
        public bool IsRunning => isRunning;

        /// <summary>
        /// Returns true if the current thread is the STA thread.
        /// </summary>
        public bool IsOnStaThread => Thread.CurrentThread.ManagedThreadId == staThreadId;

        /// <summary>
        /// Starts the STA thread and message loop.
        /// </summary>
        public void Start()
        {
            if (isRunning) return;

            isRunning = true;
            thread = new Thread(MessageLoop)
            {
                Name = "StaThreadRunner",
                IsBackground = false
            };
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
        }

        /// <summary>
        /// Stops the STA thread and cleans up resources.
        /// </summary>
        public void Stop()
        {
            isRunning = false;
            workEvent.Set(); // Wake up the message loop to exit
        }

        /// <summary>
        /// Invokes a synchronous action on the STA thread and waits for completion.
        /// If already on the STA thread, executes directly to avoid deadlock.
        /// For async work, pass a lambda that blocks: () => asyncMethod().GetAwaiter().GetResult()
        /// This ensures the entire operation stays on the STA thread.
        /// </summary>
        public Task<T> InvokeOnSta<T>(Func<T> action)
        {
            // If already on STA thread, execute directly to avoid deadlock
            if (IsOnStaThread)
            {
                try
                {
                    return Task.FromResult(action());
                }
                catch (Exception ex)
                {
                    return Task.FromException<T>(ex);
                }
            }

            var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);

            workQueue.Enqueue(() =>
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
            workEvent.Set();

            return tcs.Task;
        }

        /// <summary>
        /// Posts an action to the STA thread without waiting for completion (fire and forget).
        /// </summary>
        public void PostToSta(Action action)
        {
            workQueue.Enqueue(action);
            workEvent.Set();
        }

        private void MessageLoop()
        {
            try
            {
                staThreadId = Thread.CurrentThread.ManagedThreadId;
                LogToStderr($"STA thread started (thread ID: {staThreadId})");

                // Keep SafeWaitHandle alive during the entire loop to prevent GC issues with DangerousGetHandle
                var safeHandle = workEvent.SafeWaitHandle;
                var waitHandles = new IntPtr[] { safeHandle.DangerousGetHandle() };

                while (isRunning)
                {
                    // Wait for either a Windows message or a work item
                    var waitResult = MsgWaitForMultipleObjects(1, waitHandles, false, INFINITE, QS_ALLINPUT);

                    if (waitResult == WAIT_OBJECT_0)
                    {
                        // Work item signaled - process all queued work
                        ProcessWorkQueue();
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

                // Prevent safeHandle from being GC'd during loop
                GC.KeepAlive(safeHandle);
            }
            catch (Exception ex)
            {
                LogToStderr($"Fatal error in STA message loop: {ex.Message}");
                LogToStderr("Exiting process to trigger restart...");
                Environment.Exit(1);
            }
            finally
            {
                LogToStderr("STA thread stopped");
                // If we exit the loop unexpectedly (not via Stop()), crash the process
                // so Electron can restart us. This ensures keyboard hooks get reinstalled.
                if (isRunning)
                {
                    LogToStderr("STA thread exited unexpectedly, forcing process exit...");
                    Environment.Exit(1);
                }
            }
        }

        private void ProcessWorkQueue()
        {
            while (workQueue.TryDequeue(out var action))
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

        private void LogToStderr(string message)
        {
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            Console.Error.WriteLine($"[{timestamp}] [StaThreadRunner] {message}");
            Console.Error.Flush();
        }
    }
}
