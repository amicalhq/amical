using System;
using System.Threading;
using System.Threading.Tasks;
using WindowsHelper.Models;
using WindowsHelper.Services;

namespace WindowsHelper
{
    class Program
    {
        static StaThreadRunner? keyboardStaRunner;  // Dedicated for keyboard hooks (must stay responsive)
        static StaThreadRunner? operationsStaRunner; // For clipboard, audio, and other STA operations
        static ShortcutMonitor? shortcutMonitor;
        static ClipboardService? clipboardService;
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
                // Initialize components in dependency order
                // Two STA threads: one dedicated for keyboard hooks (must stay responsive),
                // one shared for clipboard/audio operations (can tolerate some latency)

                // 1. Keyboard STA thread - dedicated for hooks, must pump messages quickly
                keyboardStaRunner = new StaThreadRunner();

                // 2. Operations STA thread - for clipboard and audio operations
                operationsStaRunner = new StaThreadRunner();

                // 3. ClipboardService - uses operations STA thread
                clipboardService = new ClipboardService(operationsStaRunner);

                // 4. ShortcutMonitor - uses dedicated keyboard STA thread
                shortcutMonitor = new ShortcutMonitor(keyboardStaRunner);

                // 5. RpcHandler - uses operations STA thread for audio dispatch
                rpcHandler = new RpcHandler(operationsStaRunner, clipboardService);

                // Set up event handlers
                shortcutMonitor.KeyEventOccurred += OnKeyEvent;

                // Start STA threads BEFORE RPC processing to avoid race condition
                LogToStderr("Starting keyboard STA thread...");
                keyboardStaRunner.Start();

                LogToStderr("Starting operations STA thread...");
                operationsStaRunner.Start();

                // Install keyboard hooks on dedicated STA thread
                LogToStderr("Installing keyboard hooks...");
                shortcutMonitor.Start();

                // Start RPC processing AFTER STA threads are running
                var rpcTask = Task.Run(() =>
                {
                    LogToStderr("Starting RPC processing in background thread...");
                    rpcHandler.ProcessRpcRequests(cancellationTokenSource.Token);
                }, cancellationTokenSource.Token);

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
                keyboardStaRunner?.Stop();
                operationsStaRunner?.Stop();
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
