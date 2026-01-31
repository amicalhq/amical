using System;
using System.Collections.Concurrent;
using System.Threading;

namespace WindowsHelper
{
    internal static class HelperLogger
    {
        private static readonly ConcurrentQueue<string> LogQueue = new();
        private static readonly AutoResetEvent LogSignal = new(false);
        private static Thread? logThread;
        private static volatile bool stopping;

        internal static void Start()
        {
            if (logThread != null) return;
            stopping = false;
            logThread = new Thread(ProcessLogQueue)
            {
                IsBackground = true,
                Name = "HelperLogger",
                Priority = ThreadPriority.BelowNormal
            };
            logThread.Start();
        }

        internal static void Stop()
        {
            stopping = true;
            LogSignal.Set();
            if (logThread != null && !logThread.Join(TimeSpan.FromSeconds(5)))
            {
                Console.Error.WriteLine(
                    "[HelperLogger] Warning: Timeout waiting for logger thread to stop.");
            }
        }

        internal static void LogToStderr(string message)
        {
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            LogQueue.Enqueue($"[{timestamp}] {message}");
            LogSignal.Set();
        }

        private static void ProcessLogQueue()
        {
            try
            {
                while (!stopping)
                {
                    LogSignal.WaitOne();
                    DrainLogQueue();
                }

                DrainLogQueue();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[HelperLogger] Error in logger: {ex.Message}");
            }
        }

        private static void DrainLogQueue()
        {
            while (LogQueue.TryDequeue(out var line))
            {
                Console.Error.WriteLine(line);
                Console.Error.Flush();
            }
        }
    }
}
