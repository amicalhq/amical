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
            // Firefox-based browsers (use AutomationId, not ClassName)
            ["firefox"] = new[] { "MozillaWindowClass" },
            ["zen"] = new[] { "MozillaWindowClass" }
        };

        /// <summary>
        /// Firefox-based browser AutomationIds (Firefox/Zen don't use semantic ClassNames for address bar)
        /// </summary>
        private static readonly string[] GeckoAutomationIds = new[] { "urlbar", "urlbar-input" };

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

            // Firefox-based browsers need special handling with AutomationId
            if (browser == "firefox" || browser == "zen")
            {
                return ExtractGeckoUrl(windowElement);
            }

            // Chromium-based browsers: search by ClassName
            var classNames = AddressBarClassNames[browser];
            LogToStderr($"Browser '{browser}' matched, trying ClassNames: {string.Join(", ", classNames)}");

            foreach (var className in classNames)
            {
                LogToStderr($"Searching for ClassName='{className}'");
                var addressBar = FindElementByClassName(windowElement, className);

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
        /// Extract URL from Firefox-based browsers using AutomationId (Gecko doesn't expose semantic ClassNames).
        /// </summary>
        private static string? ExtractGeckoUrl(IUIAutomationElement windowElement)
        {
            LogToStderr($"Gecko browser: trying AutomationIds: {string.Join(", ", GeckoAutomationIds)}");

            foreach (var automationId in GeckoAutomationIds)
            {
                LogToStderr($"Searching for AutomationId='{automationId}'");
                var addressBar = FindElementByAutomationId(windowElement, automationId);

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
        /// Find element by ClassName using UIA's built-in FindFirst.
        /// </summary>
        private static IUIAutomationElement? FindElementByClassName(
            IUIAutomationElement root,
            string className)
        {
            try
            {
                var automation = UIAutomationService.Automation;
                if (automation == null)
                {
                    LogToStderr("FindElementByClassName: Automation is null!");
                    return null;
                }

                // UIA_ClassNamePropertyId = 30012
                var condition = automation.CreatePropertyCondition(30012, className);
                
                // TreeScope_Descendants = 4
                var element = root.FindFirst((TreeScope)4, condition);
                
                if (element != null)
                {
                    LogToStderr($"FindFirst: Found ClassName='{className}'");
                }
                else
                {
                    LogToStderr($"FindFirst: ClassName='{className}' not found");
                }
                
                return element;
            }
            catch (COMException ex)
            {
                LogToStderr($"FindElementByClassName error: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Find element by AutomationId using UIA's built-in FindFirst (much faster than BFS).
        /// </summary>
        private static IUIAutomationElement? FindElementByAutomationId(
            IUIAutomationElement root,
            string automationId)
        {
            try
            {
                var automation = UIAutomationService.Automation;
                if (automation == null)
                {
                    LogToStderr("FindElementByAutomationId: Automation is null!");
                    return null;
                }

                // UIA_AutomationIdPropertyId = 30011
                var condition = automation.CreatePropertyCondition(30011, automationId);
                
                // TreeScope_Descendants = 4
                var element = root.FindFirst((TreeScope)4, condition);
                
                if (element != null)
                {
                    LogToStderr($"FindFirst: Found AutomationId='{automationId}'");
                }
                else
                {
                    LogToStderr($"FindFirst: AutomationId='{automationId}' not found");
                }
                
                return element;
            }
            catch (COMException ex)
            {
                LogToStderr($"FindElementByAutomationId error: {ex.Message}");
                return null;
            }
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
