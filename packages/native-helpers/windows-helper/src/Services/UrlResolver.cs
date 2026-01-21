using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Interop.UIAutomationClient;
using WindowsHelper.Utils;

namespace WindowsHelper.Services
{
    /// <summary>
    /// Service for extracting URLs from browser windows.
    /// Uses ClassName-based search for stability across browser versions.
    /// </summary>
    public static class UrlResolver
    {
        /// <summary>
        /// Browser-specific ClassNames for address bars.
        /// ClassNames are semantic and stable across browser versions (unlike AutomationId).
        /// </summary>
        private static readonly Dictionary<string, string[]> AddressBarClassNames = new Dictionary<string, string[]>(
            StringComparer.OrdinalIgnoreCase)
        {
            // Chromium-based browsers use OmniboxViewViews
            ["chrome"] = new[] { "OmniboxViewViews" },
            ["msedge"] = new[] { "OmniboxViewViews" },
            ["brave"] = new[] { "OmniboxViewViews" },
            ["opera"] = new[] { "OmniboxViewViews" },
            ["vivaldi"] = new[] { "OmniboxViewViews" },
            ["chromium"] = new[] { "OmniboxViewViews" },
            // Firefox uses different class names
            ["firefox"] = new[] { "MozillaWindowClass" }
        };

        /// <summary>
        /// Firefox-specific AutomationIds (Firefox doesn't use semantic ClassNames for address bar)
        /// </summary>
        private static readonly string[] FirefoxAutomationIds = new[] { "urlbar", "urlbar-input" };

        /// <summary>
        /// Extract URL from a browser window.
        /// </summary>
        public static string? ExtractBrowserUrl(IUIAutomationElement? windowElement, string? processName)
        {
            LogToStderr($"ExtractBrowserUrl: processName='{processName}', windowElement={(windowElement != null ? "present" : "null")}");
            
            if (windowElement == null || string.IsNullOrEmpty(processName))
            {
                LogToStderr("Early return: windowElement or processName is null");
                return null;
            }

            var browser = processName.ToLowerInvariant();
            
            // Check if this is a known browser
            if (!AddressBarClassNames.ContainsKey(browser))
            {
                LogToStderr($"Browser '{browser}' not in known list");
                return null;
            }

            // Firefox needs special handling with AutomationId
            if (browser == "firefox")
            {
                return ExtractFirefoxUrl(windowElement);
            }

            // Chromium-based browsers: search by ClassName
            var classNames = AddressBarClassNames[browser];
            LogToStderr($"Browser '{browser}' matched, trying ClassNames: {string.Join(", ", classNames)}");

            foreach (var className in classNames)
            {
                LogToStderr($"Searching for ClassName='{className}'");
                var addressBar = FindElementByClassNameBounded(
                    windowElement,
                    className,
                    maxDepth: Constants.URL_SEARCH_MAX_DEPTH,
                    maxElements: Constants.URL_SEARCH_MAX_ELEMENTS);

                if (addressBar != null)
                {
                    var url = ExtractUrlFromElement(addressBar, className);
                    if (url != null) return url;
                }
                else
                {
                    LogToStderr($"No element found with ClassName='{className}'");
                }
            }

            LogToStderr("No URL found, returning null");
            return null;
        }

        /// <summary>
        /// Extract URL from Firefox using AutomationId (Firefox doesn't expose semantic ClassNames).
        /// </summary>
        private static string? ExtractFirefoxUrl(IUIAutomationElement windowElement)
        {
            LogToStderr($"Firefox: trying AutomationIds: {string.Join(", ", FirefoxAutomationIds)}");

            foreach (var automationId in FirefoxAutomationIds)
            {
                LogToStderr($"Searching for AutomationId='{automationId}'");
                var addressBar = FindElementByAutomationIdBounded(
                    windowElement,
                    automationId,
                    maxDepth: Constants.URL_SEARCH_MAX_DEPTH,
                    maxElements: Constants.URL_SEARCH_MAX_ELEMENTS);

                if (addressBar != null)
                {
                    var url = ExtractUrlFromElement(addressBar, automationId);
                    if (url != null) return url;
                }
                else
                {
                    LogToStderr($"No element found with AutomationId='{automationId}'");
                }
            }

            return null;
        }

        /// <summary>
        /// Extract URL value from an element using ValuePattern.
        /// </summary>
        private static string? ExtractUrlFromElement(IUIAutomationElement element, string identifier)
        {
            LogToStderr($"Found element with identifier='{identifier}'");
            try
            {
                var pattern = element.GetCurrentPattern(Constants.UIA_ValuePatternId);
                var valuePattern = pattern as IUIAutomationValuePattern;
                if (valuePattern != null)
                {
                    var url = valuePattern.CurrentValue;
                    LogToStderr($"ValuePattern value='{url}'");
                    if (!string.IsNullOrEmpty(url) &&
                        (url.Contains(".") || url.StartsWith("http", StringComparison.OrdinalIgnoreCase)))
                    {
                        LogToStderr($"Returning URL: '{url}'");
                        return url;
                    }
                }
                else
                {
                    LogToStderr("ValuePattern is null");
                }
            }
            catch (Exception ex)
            {
                LogToStderr($"Error reading value: {ex.Message}");
            }
            return null;
        }

        /// <summary>
        /// Bounded BFS search for element by ClassName.
        /// </summary>
        private static IUIAutomationElement? FindElementByClassNameBounded(
            IUIAutomationElement root,
            string className,
            int maxDepth,
            int maxElements)
        {
            var queue = new Queue<(IUIAutomationElement element, int depth)>();
            queue.Enqueue((root, 0));
            int visited = 0;

            var walker = UIAutomationService.ControlViewWalker;
            if (walker == null)
            {
                LogToStderr("BFS: ControlViewWalker is null!");
                return null;
            }

            while (queue.Count > 0 && visited < maxElements)
            {
                var (current, depth) = queue.Dequeue();
                visited++;

                try
                {
                    var currentClass = current.CurrentClassName;
                    if (string.Equals(currentClass, className, StringComparison.Ordinal))
                    {
                        LogToStderr($"BFS: Found ClassName='{className}' at depth={depth}, visited={visited}");
                        return current;
                    }

                    if (depth >= maxDepth) continue;

                    var child = walker.GetFirstChildElement(current);
                    while (child != null && visited < maxElements)
                    {
                        queue.Enqueue((child, depth + 1));
                        child = walker.GetNextSiblingElement(child);
                    }
                }
                catch (COMException ex)
                {
                    LogToStderr($"BFS: COMException at depth={depth}: {ex.Message}");
                }
            }

            LogToStderr($"BFS: ClassName='{className}' not found: visited={visited}, maxDepth={maxDepth}");
            return null;
        }

        /// <summary>
        /// Bounded BFS search for element by AutomationId (Firefox fallback).
        /// </summary>
        private static IUIAutomationElement? FindElementByAutomationIdBounded(
            IUIAutomationElement root,
            string automationId,
            int maxDepth,
            int maxElements)
        {
            var queue = new Queue<(IUIAutomationElement element, int depth)>();
            queue.Enqueue((root, 0));
            int visited = 0;

            var walker = UIAutomationService.ControlViewWalker;
            if (walker == null)
            {
                LogToStderr("BFS: ControlViewWalker is null!");
                return null;
            }

            while (queue.Count > 0 && visited < maxElements)
            {
                var (current, depth) = queue.Dequeue();
                visited++;

                try
                {
                    var currentId = current.CurrentAutomationId;
                    if (string.Equals(currentId, automationId, StringComparison.Ordinal))
                    {
                        LogToStderr($"BFS: Found AutomationId='{automationId}' at depth={depth}, visited={visited}");
                        return current;
                    }

                    if (depth >= maxDepth) continue;

                    var child = walker.GetFirstChildElement(current);
                    while (child != null && visited < maxElements)
                    {
                        queue.Enqueue((child, depth + 1));
                        child = walker.GetNextSiblingElement(child);
                    }
                }
                catch (COMException ex)
                {
                    LogToStderr($"BFS: COMException at depth={depth}: {ex.Message}");
                }
            }

            LogToStderr($"BFS: AutomationId='{automationId}' not found: visited={visited}, maxDepth={maxDepth}");
            return null;
        }

        /// <summary>
        /// Check if a process name is a known browser.
        /// </summary>
        public static bool IsBrowser(string? processName)
        {
            if (string.IsNullOrEmpty(processName)) return false;
            return AddressBarClassNames.ContainsKey(processName);
        }

        private static void LogToStderr(string message)
        {
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            Console.Error.WriteLine($"[{timestamp}] [UrlResolver] {message}");
        }
    }
}
