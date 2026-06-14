using System;
using Interop.UIAutomationClient;
using WindowsHelper.Models;

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
                    // No text-capable element found via ancestor search.
                    // Still try SelectionExtractor - it has logic to find Edit descendants with caret
                    // (handles Chromium contenteditable where Document isn't "editable" but Edit children are)
                    focusedElementInfo = FocusService.GetElementInfo(focusedElement);
                    
                    textSelectionInfo = SelectionExtractor.Extract(
                        focusedElement: focusedElement,
                        extractionElement: focusedElement,  // Use focused element as starting point
                        metricsBuilder: metricsBuilder);
                    
                    // Apply editableOnly filter
                    if (editableOnly && textSelectionInfo != null && !textSelectionInfo.IsEditable)
                    {
                        textSelectionInfo = null;
                    }
                }

                // Resolve the top-level window once: title from its caption, and
                // (for browsers) the omnibox lookup rooted at the same window via
                // ElementFromHandle — both agree on which window, and neither
                // relies on the fragile UIA "find a Window ancestor" walk.
                var windowHandle = FocusService.GetTopLevelWindowHandle(focusedElement);
                var windowInfo = FocusService.GetWindowInfo(windowHandle);

                // Extract URL for browsers
                if (windowInfo != null && UrlResolver.IsBrowser(processName))
                {
                    var windowElement = UIAutomationService.ElementFromHandle(windowHandle);
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
