using System;
using System.Collections.Concurrent;
using System.Threading;
using WindowsHelper.Models;

namespace WindowsHelper
{
    internal static class StdoutWriter
    {
        private static readonly ConcurrentQueue<object> Queue = new();
        private static readonly AutoResetEvent Signal = new(false);
        private static Thread? thread;
        private static volatile bool stopping;

        internal static void Start()
        {
            if (thread != null) return;
            stopping = false;
            thread = new Thread(ProcessQueue)
            {
                IsBackground = true,
                Name = "StdoutWriter",
                Priority = ThreadPriority.AboveNormal
            };
            thread.Start();
        }

        internal static void Stop()
        {
            stopping = true;
            Signal.Set();
            if (thread != null && !thread.Join(TimeSpan.FromSeconds(5)))
            {
                HelperLogger.LogToStderr("[StdoutWriter] Warning: Timeout waiting for writer thread to stop.");
            }
        }

        internal static void WriteEvent(HelperEvent helperEvent)
        {
            Queue.Enqueue(helperEvent);
            Signal.Set();
        }

        internal static void WriteLine(string line)
        {
            Queue.Enqueue(line);
            Signal.Set();
        }

        private static void ProcessQueue()
        {
            try
            {
                while (!stopping)
                {
                    Signal.WaitOne();
                    DrainQueue();
                }

                DrainQueue();
            }
            catch (Exception ex)
            {
                HelperLogger.LogToStderr($"[StdoutWriter] Error in writer: {ex.Message}");
            }
        }

        private static void DrainQueue()
        {
            while (Queue.TryDequeue(out var item))
            {
                try
                {
                    switch (item)
                    {
                        case HelperEvent helperEvent:
                            Console.WriteLine(helperEvent.ToJson());
                            break;
                        case string line:
                            Console.WriteLine(line);
                            break;
                    }
                    Console.Out.Flush();
                }
                catch (Exception ex)
                {
                    HelperLogger.LogToStderr($"[StdoutWriter] Error writing stdout: {ex.Message}");
                }
            }
        }
    }
}
