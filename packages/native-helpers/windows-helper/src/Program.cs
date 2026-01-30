using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using WindowsHelper.Models;
using WindowsHelper.Services;
using WinFormsApp = System.Windows.Forms.Application;

namespace WindowsHelper
{
    class Program
    {
        static StaThreadRunner? keyboardStaRunner;  // Dedicated for keyboard hooks (must stay responsive)
        static ShortcutMonitor? shortcutMonitor;
        static ClipboardService? clipboardService;
        static RpcHandler? rpcHandler;
        static readonly CancellationTokenSource cancellationTokenSource = new();

        // P/Invoke for tool window style
        private const int GWL_EXSTYLE = -20;
        private const int WS_EX_TOOLWINDOW = 0x00000080;

        [DllImport("user32.dll", SetLastError = true)]
        private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll")]
        private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        [STAThread]
        static void Main(string[] args)
        {
            // Set up console encoding for proper JSON communication
            Console.InputEncoding = System.Text.Encoding.UTF8;
            Console.OutputEncoding = System.Text.Encoding.UTF8;

            // Log startup
            LogToStderr("WindowsHelper starting...");

            // Create hidden form for WinForms message pump (required for COM interop)
            var hiddenForm = new Form
            {
                WindowState = FormWindowState.Minimized,
                ShowInTaskbar = false,
                Visible = false,
                FormBorderStyle = FormBorderStyle.None,
                Opacity = 0,
                Text = "WindowsHelper"
            };

            hiddenForm.Load += (s, e) =>
            {
                // Make it a tool window (no alt-tab, no taskbar)
                SetWindowLong(hiddenForm.Handle, GWL_EXSTYLE,
                    GetWindowLong(hiddenForm.Handle, GWL_EXSTYLE) | WS_EX_TOOLWINDOW);
                hiddenForm.Hide();

                // Initialize services after form is ready
                InitializeServices(hiddenForm);
            };

            // Handle Ctrl+C gracefully
            Console.CancelKeyPress += (sender, e) =>
            {
                e.Cancel = true;
                LogToStderr("WindowsHelper shutting down...");
                Cleanup();
                WinFormsApp.Exit();
            };

            WinFormsApp.ApplicationExit += (s, e) =>
            {
                Cleanup();
            };

            // Run message pump (blocks until Application.Exit called)
            WinFormsApp.Run(hiddenForm);
        }

        static void InitializeServices(Form mainForm)
        {
            try
            {
                // 1. Keyboard STA thread - dedicated for hooks, must pump messages quickly
                keyboardStaRunner = new StaThreadRunner();

                // 2. ClipboardService - uses main STA thread via Form.Invoke
                clipboardService = new ClipboardService(mainForm);

                // 3. ShortcutMonitor - uses dedicated keyboard STA thread
                shortcutMonitor = new ShortcutMonitor(keyboardStaRunner);

                // 4. RpcHandler - processes requests on background thread, dispatches to STA as needed
                rpcHandler = new RpcHandler(keyboardStaRunner, clipboardService);

                // Set up event handlers
                shortcutMonitor.KeyEventOccurred += OnKeyEvent;

                // Start keyboard STA thread
                LogToStderr("Starting keyboard STA thread...");
                keyboardStaRunner.Start();

                // Install keyboard hooks on dedicated STA thread
                LogToStderr("Installing keyboard hooks...");
                shortcutMonitor.Start();

                // Start RPC processing in background thread
                Task.Run(() =>
                {
                    LogToStderr("Starting RPC processing in background thread...");
                    rpcHandler.ProcessRpcRequests(cancellationTokenSource.Token);
                }, cancellationTokenSource.Token);

                LogToStderr("WindowsHelper ready.");
            }
            catch (Exception ex)
            {
                LogToStderr($"Fatal error during initialization: {ex.Message}");
                Environment.Exit(1);
            }
        }

        static void Cleanup()
        {
            try
            {
                shortcutMonitor?.Stop();
                keyboardStaRunner?.Stop();
                cancellationTokenSource.Cancel();
                LogToStderr("WindowsHelper stopped.");
            }
            catch (Exception ex)
            {
                LogToStderr($"Error during cleanup: {ex.Message}");
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
    }
}
