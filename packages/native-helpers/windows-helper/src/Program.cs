using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using WindowsHelper.Models;

namespace WindowsHelper
{
    class Program
    {
        static ShortcutMonitor? shortcutMonitor;
        static RpcHandler? rpcHandler;
        static readonly CancellationTokenSource cancellationTokenSource = new();

        static async Task Main(string[] args)
        {
            // Set up console encoding for proper JSON communication
            Console.InputEncoding = System.Text.Encoding.UTF8;
            Console.OutputEncoding = System.Text.Encoding.UTF8;

            // Log startup
            LogToStderr("WindowsHelper starting...");

            try
            {
                // Initialize components
                shortcutMonitor = new ShortcutMonitor();
                rpcHandler = new RpcHandler();

                // Set up event handlers
                shortcutMonitor.KeyEventOccurred += OnKeyEvent;

                // Start RPC processing in background task
                var rpcTask = Task.Run(() => 
                {
                    LogToStderr("Starting RPC processing in background thread...");
                    rpcHandler.ProcessRpcRequests(cancellationTokenSource.Token);
                }, cancellationTokenSource.Token);

                // Start shortcut monitoring (this will run the Windows message loop)
                LogToStderr("Starting shortcut monitoring in main thread...");
                shortcutMonitor.Start();

                // Wait for cancellation
                await Task.Delay(Timeout.Infinite, cancellationTokenSource.Token);
            }
            catch (OperationCanceledException)
            {
                LogToStderr("WindowsHelper shutting down...");
            }
            catch (Exception ex)
            {
                LogToStderr($"Fatal error: {ex.Message}");
                Environment.Exit(1);
            }
            finally
            {
                // Cleanup
                shortcutMonitor?.Stop();
                cancellationTokenSource.Cancel();
                LogToStderr("WindowsHelper stopped.");
            }
        }

        private static void OnKeyEvent(object? sender, HelperEvent e)
        {
            try
            {
                // Serialize and send the event to stdout using generated serializer
                var json = e.ToJson();
                Console.WriteLine(json);
                Console.Out.Flush();
            }
            catch (Exception ex)
            {
                LogToStderr($"Error sending key event: {ex.Message}");
            }
        }

        private static void LogToStderr(string message)
        {
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            Console.Error.WriteLine($"[{timestamp}] {message}");
            Console.Error.Flush();
        }

        // Handle Ctrl+C gracefully
        static Program()
        {
            Console.CancelKeyPress += (sender, e) =>
            {
                e.Cancel = true;
                cancellationTokenSource.Cancel();
            };
        }
    }
}