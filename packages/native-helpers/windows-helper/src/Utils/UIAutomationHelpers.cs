using System;
using Interop.UIAutomationClient;
using WindowsHelper.Services;

namespace WindowsHelper.Utils
{
    /// <summary>
    /// Shared UI Automation utility methods using COM interop.
    /// </summary>
    public static class UIAutomationHelpers
    {
        /// <summary>
        /// Get the window element containing the given element.
        /// </summary>
        public static IUIAutomationElement? GetWindowElement(IUIAutomationElement? element)
        {
            if (element == null)
            {
                LogToStderr("element is null");
                return null;
            }

            try
            {
                if (element.CurrentControlType == Constants.UIA_WindowControlTypeId)
                {
                    LogToStderr($"element is already a Window: '{element.CurrentName}'");
                    return element;
                }

                var walker = UIAutomationService.ControlViewWalker;
                if (walker == null)
                {
                    LogToStderr("ControlViewWalker is null!");
                    return null;
                }
                
                var current = element;

                for (int i = 0; i < Constants.WINDOW_SEARCH_MAX_DEPTH; i++)
                {
                    var parent = walker.GetParentElement(current);
                    if (parent == null)
                    {
                        LogToStderr($"parent is null at depth {i}");
                        break;
                    }

                    if (parent.CurrentControlType == Constants.UIA_WindowControlTypeId)
                    {
                        LogToStderr($"Found Window at depth {i}: '{parent.CurrentName}'");
                        return parent;
                    }

                    current = parent;
                }
                
                LogToStderr($"No Window found within {Constants.WINDOW_SEARCH_MAX_DEPTH} levels");
            }
            catch (Exception ex)
            {
                LogToStderr($"Exception: {ex.Message}");
            }

            return null;
        }

        private static void LogToStderr(string message)
        {
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            Console.Error.WriteLine($"[{timestamp}] [UIAutomationHelpers] {message}");
        }
    }
}
