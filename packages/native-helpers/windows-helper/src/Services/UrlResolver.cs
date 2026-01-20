using System;
using System.Collections.Generic;
using System.Windows.Automation;
using WindowsHelper.Utils;

namespace WindowsHelper.Services
{
    /// <summary>
    /// Service for extracting URLs from browser windows.
    /// Uses browser-specific strategies to find address bar elements.
    /// </summary>
    public static class UrlResolver
    {
        /// <summary>
        /// Browser-specific AutomationIds for address bars.
        /// </summary>
        private static readonly Dictionary<string, string[]> AddressBarIds = new Dictionary<string, string[]>(
            StringComparer.OrdinalIgnoreCase)
        {
            ["chrome"] = new[] { "addressEditBox", "omnibox" },
            ["msedge"] = new[] { "addressEditBox", "view_id_omnibox_text" },
            ["firefox"] = new[] { "urlbar", "urlbar-input" },
            ["brave"] = new[] { "addressEditBox", "omnibox" },
            ["opera"] = new[] { "addressEditBox" },
            ["vivaldi"] = new[] { "addressEditBox", "omnibox" },
            ["chromium"] = new[] { "addressEditBox", "omnibox" }
        };

        /// <summary>
        /// Extract URL from a browser window.
        /// </summary>
        /// <param name="windowElement">The browser window element</param>
        /// <param name="processName">The browser process name</param>
        /// <returns>URL string or null if not found</returns>
        public static string? ExtractBrowserUrl(AutomationElement windowElement, string? processName)
        {
            if (windowElement == null || string.IsNullOrEmpty(processName))
                return null;

            // Check if this is a known browser
            var browser = processName.ToLowerInvariant();
            if (!AddressBarIds.TryGetValue(browser, out var ids))
                return null;

            // Use BOUNDED search for address bar by AutomationId
            foreach (var id in ids)
            {
                var addressBar = FindElementByAutomationIdBounded(
                    windowElement,
                    id,
                    Constants.CHROMIUM_URL_SEARCH_DEPTH,
                    Constants.DOCUMENT_SEARCH_MAX_ELEMENTS);

                if (addressBar != null)
                {
                    if (addressBar.TryGetCurrentPattern(ValuePattern.Pattern, out var vp))
                    {
                        try
                        {
                            var url = ((ValuePattern)vp).Current.Value;
                            if (!string.IsNullOrEmpty(url) &&
                                (url.Contains(".") || url.StartsWith("http", StringComparison.OrdinalIgnoreCase)))
                            {
                                return url;
                            }
                        }
                        catch
                        {
                            // Ignore errors reading value
                        }
                    }
                }
            }

            // Fallback: BOUNDED search for Document elements with URL
            // Use TreeWalker with depth/element limits to avoid O(n) FindAll on Chromium trees
            var documents = FindDocumentsBounded(
                windowElement,
                Constants.DOCUMENT_SEARCH_MAX_DEPTH,
                Constants.DOCUMENT_SEARCH_MAX_ELEMENTS);

            foreach (var doc in documents)
            {
                // Try LegacyIAccessible pattern (for older apps that expose URL via MSAA)
                try
                {
                    if (doc.TryGetCurrentPattern(LegacyIAccessiblePattern.Pattern, out var pattern))
                    {
                        var legacyPattern = (LegacyIAccessiblePattern)pattern;
                        var value = legacyPattern.Current.Value;
                        if (!string.IsNullOrEmpty(value) &&
                            value.StartsWith("http", StringComparison.OrdinalIgnoreCase))
                        {
                            return value;
                        }
                    }
                }
                catch
                {
                    // Ignore legacy pattern errors
                }
            }

            return null;
        }

        /// <summary>
        /// Bounded BFS search for element by AutomationId to avoid O(n) FindFirst on large trees.
        /// </summary>
        private static AutomationElement? FindElementByAutomationIdBounded(
            AutomationElement root,
            string automationId,
            int maxDepth,
            int maxElements)
        {
            var queue = new Queue<(AutomationElement element, int depth)>();
            queue.Enqueue((root, 0));
            int visited = 0;

            var walker = TreeWalker.ControlViewWalker;

            while (queue.Count > 0 && visited < maxElements)
            {
                var (current, depth) = queue.Dequeue();
                visited++;

                try
                {
                    if (string.Equals(current.Current.AutomationId, automationId, StringComparison.Ordinal))
                    {
                        return current;
                    }

                    // Don't go deeper than maxDepth
                    if (depth >= maxDepth) continue;

                    // Enqueue children
                    var child = walker.GetFirstChild(current);
                    while (child != null && visited < maxElements)
                    {
                        queue.Enqueue((child, depth + 1));
                        child = walker.GetNextSibling(child);
                    }
                }
                catch (ElementNotAvailableException)
                {
                    // Element became unavailable
                }
            }

            return null;
        }

        /// <summary>
        /// Bounded BFS search for Document elements to avoid O(n) FindAll on large trees.
        /// </summary>
        private static List<AutomationElement> FindDocumentsBounded(
            AutomationElement root,
            int maxDepth,
            int maxElements)
        {
            var results = new List<AutomationElement>();
            var queue = new Queue<(AutomationElement element, int depth)>();
            queue.Enqueue((root, 0));
            int visited = 0;

            var walker = TreeWalker.ControlViewWalker;

            while (queue.Count > 0 && results.Count < maxElements && visited < maxElements * 2)
            {
                var (current, depth) = queue.Dequeue();
                visited++;

                try
                {
                    if (current.Current.ControlType == ControlType.Document)
                    {
                        results.Add(current);
                    }

                    // Don't go deeper than maxDepth
                    if (depth >= maxDepth) continue;

                    // Enqueue children
                    var child = walker.GetFirstChild(current);
                    while (child != null && visited < maxElements * 2)
                    {
                        queue.Enqueue((child, depth + 1));
                        child = walker.GetNextSibling(child);
                        visited++;
                    }
                }
                catch (ElementNotAvailableException)
                {
                    // Element became unavailable
                }
            }

            return results;
        }

        /// <summary>
        /// Check if a process name is a known browser.
        /// </summary>
        public static bool IsBrowser(string? processName)
        {
            if (string.IsNullOrEmpty(processName)) return false;
            return Constants.BrowserProcessNames.Contains(processName);
        }
    }
}
