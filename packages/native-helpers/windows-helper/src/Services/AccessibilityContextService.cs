using System;
using Interop.UIAutomationClient;
using WindowsHelper.Models;
using WindowsHelper.Utils;

namespace WindowsHelper.Services
{
    /// <summary>
    /// Main orchestrator for accessibility context extraction.
    /// Uses COM interop with minimal approach.
    /// </summary>
    public static class AccessibilityContextService
    {
        /// <summary>
        /// Get accessibility context for the currently focused element.
        /// </summary>
        public static Context? GetAccessibilityContext(bool editableOnly = false)
        {
            var metricsBuilder = new MetricsBuilder();

            try
            {
                // Get focused element
                var focusedElement = FocusService.GetFocusedElement();
                if (focusedElement == null)
                    return null;

                // Get application info
                var (appInfo, processName) = FocusService.GetApplicationInfo(focusedElement);

                // Find text-capable element (ancestors only, no descendant search)
                FocusedElement? focusedElementInfo = null;
                TextSelection? textSelectionInfo = null;

                var focusResult = FocusService.FindTextCapableElement(focusedElement, editableOnly);
                if (focusResult != null)
                {
                    focusedElementInfo = FocusService.GetElementInfo(focusResult.Value.Element);

                    // Extract text selection
                    textSelectionInfo = SelectionExtractor.Extract(
                        focusedElement: focusedElement,
                        extractionElement: focusResult.Value.Element,
                        metricsBuilder: metricsBuilder);

                    // Apply editableOnly filter
                    if (editableOnly && textSelectionInfo != null && !textSelectionInfo.IsEditable)
                    {
                        textSelectionInfo = null;
                    }
                }
                else
                {
                    // No text-capable element, but still get basic element info
                    focusedElementInfo = FocusService.GetElementInfo(focusedElement);
                }

                // Get window info
                var windowInfo = FocusService.GetWindowInfo(focusedElement);

                // Extract URL for browsers
                if (windowInfo != null && UrlResolver.IsBrowser(processName))
                {
                    var windowElement = UIAutomationHelpers.GetWindowElement(focusedElement);
                    windowInfo.Url = UrlResolver.ExtractBrowserUrl(windowElement, processName);
                }

                // Build and return context
                return new Context
                {
                    SchemaVersion = SchemaVersion.The20,
                    Application = appInfo,
                    WindowInfo = windowInfo,
                    FocusedElement = focusedElementInfo,
                    TextSelection = textSelectionInfo,
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                    Metrics = metricsBuilder.Build()
                };
            }
            catch (Exception ex)
            {
                metricsBuilder.RecordError($"GetAccessibilityContext failed: {ex.Message}");

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
