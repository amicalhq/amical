using System;
using System.Windows.Automation;
using WindowsHelper.Models;
using WindowsHelper.Utils;

namespace WindowsHelper.Services
{
    /// <summary>
    /// Main orchestrator for accessibility context extraction.
    /// Coordinates FocusService, SelectionExtractor, and UrlResolver.
    /// Matches Swift's AccessibilityContextService.
    /// </summary>
    public static class AccessibilityContextService
    {
        /// <summary>
        /// Schema version for the response format.
        /// </summary>
        public const string SCHEMA_VERSION = "2.0";

        /// <summary>
        /// Get accessibility context for the currently focused element.
        /// Main entry point for text selection extraction.
        /// </summary>
        /// <param name="editableOnly">If true, only return context for editable elements</param>
        /// <returns>Context or null if no suitable element found</returns>
        public static Context? GetAccessibilityContext(bool editableOnly = false)
        {
            var metricsBuilder = new MetricsBuilder();

            try
            {
                // Step 1: Get focused element
                var focusedElement = FocusService.GetFocusedElement();
                if (focusedElement == null)
                    return null;

                // Get application info early for process name
                var (appInfo, processName) = FocusService.GetApplicationInfo(focusedElement);

                // Step 2: Touch descendants to trigger lazy loading
                UIAutomationHelpers.TouchDescendants(focusedElement);

                // Step 3: Find text-capable element
                FocusedElement? focusedElementInfo = null;
                TextSelection? textSelectionInfo = null;

                var focusResult = FocusService.FindTextCapableElement(focusedElement, editableOnly);
                if (focusResult != null)
                {
                    focusedElementInfo = FocusService.GetElementInfo(focusResult.Value.Element, processName);

                    // Step 4: Extract text selection
                    textSelectionInfo = SelectionExtractor.Extract(
                        focusedElement: focusedElement,
                        extractionElement: focusResult.Value.Element,
                        metricsBuilder: metricsBuilder);

                    // Step 5: Apply editableOnly filter
                    if (editableOnly && textSelectionInfo != null && !textSelectionInfo.IsEditable)
                    {
                        textSelectionInfo = null;
                    }
                }
                else
                {
                    // No text-capable element, but still get basic element info
                    focusedElementInfo = FocusService.GetElementInfo(focusedElement, processName);
                }

                // Get window info
                var windowInfo = FocusService.GetWindowInfo(focusedElement, processName);

                // Extract URL for browsers
                if (windowInfo != null && UrlResolver.IsBrowser(processName))
                {
                    var windowElement = UIAutomationHelpers.GetWindowElement(focusedElement);
                    if (windowElement != null)
                    {
                        windowInfo.Url = UrlResolver.ExtractBrowserUrl(windowElement, processName);
                    }
                }

                // Step 6: Build and return context
                // NOTE: Timestamp is Unix SECONDS (not milliseconds) to match Swift
                return new Context
                {
                    SchemaVersion = SchemaVersion.The20,
                    Application = appInfo,
                    WindowInfo = windowInfo,
                    FocusedElement = focusedElementInfo,
                    TextSelection = textSelectionInfo,
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),  // SECONDS, not milliseconds!
                    Metrics = metricsBuilder.Build()
                };
            }
            catch (Exception ex)
            {
                metricsBuilder.RecordError($"GetAccessibilityContext failed: {ex.Message}");

                // Return partial context with error
                return new Context
                {
                    SchemaVersion = SchemaVersion.The20,
                    Application = null,
                    WindowInfo = null,
                    FocusedElement = null,
                    TextSelection = null,
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                    Metrics = metricsBuilder.Build()
                };
            }
        }
    }
}
