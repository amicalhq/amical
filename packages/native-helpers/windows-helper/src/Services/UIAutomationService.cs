using System;
using System.Runtime.InteropServices;
using Interop.UIAutomationClient;

namespace WindowsHelper.Services
{
    /// <summary>
    /// UI Automation service using COM interop for better performance.
    /// Uses CUIAutomationClass singleton and minimal approach (focused element + parent walking only).
    /// </summary>
    public static class UIAutomationService
    {
        // Singleton CUIAutomation instance - created once at startup
        private static readonly CUIAutomation _automation;
        private static readonly IUIAutomationTreeWalker _rawViewWalker;
        private static readonly IUIAutomationTreeWalker _controlViewWalker;

        static UIAutomationService()
        {
            try
            {
                _automation = new CUIAutomationClass();
                _rawViewWalker = _automation.RawViewWalker;
                _controlViewWalker = _automation.ControlViewWalker;
                LogToStderr("UIAutomationService initialized with COM interop");
            }
            catch (Exception ex)
            {
                LogToStderr($"Failed to initialize UIAutomationService: {ex.Message}");
                throw;
            }
        }

        /// <summary>
        /// Gets the CUIAutomation instance.
        /// </summary>
        public static CUIAutomation Automation => _automation;

        /// <summary>
        /// Gets the raw view tree walker.
        /// </summary>
        public static IUIAutomationTreeWalker RawViewWalker => _rawViewWalker;

        /// <summary>
        /// Gets the control view tree walker.
        /// </summary>
        public static IUIAutomationTreeWalker ControlViewWalker => _controlViewWalker;

        /// <summary>
        /// Gets the currently focused element.
        /// </summary>
        public static IUIAutomationElement? GetFocusedElement()
        {
            try
            {
                return _automation.GetFocusedElement();
            }
            catch (COMException ex)
            {
                LogToStderr($"GetFocusedElement failed: {ex.Message}");
                return null;
            }
            catch (Exception ex)
            {
                LogToStderr($"GetFocusedElement unexpected error: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Gets the parent of an element.
        /// </summary>
        public static IUIAutomationElement? GetParent(IUIAutomationElement element)
        {
            if (element == null) return null;

            try
            {
                return _controlViewWalker.GetParentElement(element);
            }
            catch (COMException)
            {
                return null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Gets an element from a window handle.
        /// </summary>
        public static IUIAutomationElement? ElementFromHandle(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return null;

            try
            {
                return _automation.ElementFromHandle(hwnd);
            }
            catch (COMException)
            {
                return null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Creates a condition for finding elements.
        /// </summary>
        public static IUIAutomationCondition CreatePropertyCondition(int propertyId, object value)
        {
            return _automation.CreatePropertyCondition(propertyId, value);
        }

        /// <summary>
        /// Gets the true condition (matches all elements).
        /// </summary>
        public static IUIAutomationCondition TrueCondition => _automation.CreateTrueCondition();

        /// <summary>
        /// Safely releases a COM object.
        /// </summary>
        public static void SafeRelease(object? comObject)
        {
            if (comObject != null)
            {
                try
                {
                    Marshal.ReleaseComObject(comObject);
                }
                catch
                {
                    // Ignore release errors
                }
            }
        }

        private static void LogToStderr(string message)
        {
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            Console.Error.WriteLine($"[{timestamp}] [UIAutomationService] {message}");
            Console.Error.Flush();
        }
    }
}
