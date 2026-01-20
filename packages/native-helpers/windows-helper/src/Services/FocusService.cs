using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Windows.Automation;
using WindowsHelper.Models;
using WindowsHelper.Utils;

namespace WindowsHelper.Services
{
    /// <summary>
    /// Result from finding a text-capable element.
    /// </summary>
    public struct FocusResult
    {
        /// <summary>The text-capable element found</summary>
        public AutomationElement Element;
        /// <summary>True if found via descendant/ancestor search, false if original element was text-capable</summary>
        public bool WasSearched;
    }

    /// <summary>
    /// Service for focus resolution and element information extraction.
    /// Matches Swift's FocusService.
    /// </summary>
    public static class FocusService
    {
        // =============================================================================
        // Focus Element Retrieval
        // =============================================================================

        /// <summary>
        /// Get the currently focused element from UI Automation.
        /// </summary>
        public static AutomationElement? GetFocusedElement()
        {
            try
            {
                return AutomationElement.FocusedElement;
            }
            catch (Exception)
            {
                return null;
            }
        }

        // =============================================================================
        // Text-Capable Element Search
        // =============================================================================

        /// <summary>
        /// Find a text-capable element starting from the given element.
        /// Searches descendants first, then ancestors (matching Swift).
        /// </summary>
        /// <param name="element">Starting element</param>
        /// <param name="editableOnly">If true, only return editable elements</param>
        /// <returns>FocusResult or null if no suitable element found</returns>
        public static FocusResult? FindTextCapableElement(AutomationElement element, bool editableOnly)
        {
            try
            {
                // Check if current element is text-capable
                if (UIAutomationHelpers.IsTextCapable(element))
                {
                    if (!editableOnly || UIAutomationHelpers.IsElementEditable(element))
                    {
                        return new FocusResult { Element = element, WasSearched = false };
                    }
                }

                // Search descendants for text-capable element (BFS)
                var descendant = SearchDescendantsForTextCapable(element, editableOnly);
                if (descendant != null)
                {
                    return new FocusResult { Element = descendant, WasSearched = true };
                }

                // Search ancestors for text-capable element
                var ancestor = SearchAncestorsForTextCapable(element, editableOnly);
                if (ancestor != null)
                {
                    return new FocusResult { Element = ancestor, WasSearched = true };
                }

                // If editableOnly is false, return original if it has ValuePattern
                if (!editableOnly && element.TryGetCurrentPattern(ValuePattern.Pattern, out _))
                {
                    return new FocusResult { Element = element, WasSearched = false };
                }

                return null;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// BFS search for text-capable descendant.
        /// </summary>
        private static AutomationElement? SearchDescendantsForTextCapable(
            AutomationElement element,
            bool editableOnly,
            int maxDepth = 0,
            int maxElements = 0)
        {
            if (maxDepth <= 0) maxDepth = Constants.TREE_WALK_MAX_DEPTH;
            if (maxElements <= 0) maxElements = Constants.TREE_WALK_MAX_ELEMENTS;

            var queue = new Queue<(AutomationElement el, int depth)>();
            queue.Enqueue((element, 0));
            int searched = 0;
            var walker = TreeWalker.ControlViewWalker;

            while (queue.Count > 0 && searched < maxElements)
            {
                var (current, depth) = queue.Dequeue();
                if (depth >= maxDepth) continue;

                try
                {
                    var child = walker.GetFirstChild(current);
                    while (child != null && searched < maxElements)
                    {
                        searched++;

                        if (UIAutomationHelpers.IsTextCapable(child))
                        {
                            if (!editableOnly || UIAutomationHelpers.IsElementEditable(child))
                                return child;
                        }

                        queue.Enqueue((child, depth + 1));
                        child = walker.GetNextSibling(child);
                    }
                }
                catch (ElementNotAvailableException)
                {
                    // Element became unavailable, continue search
                }
            }

            return null;
        }

        /// <summary>
        /// Walk parent chain looking for text-capable ancestor.
        /// </summary>
        private static AutomationElement? SearchAncestorsForTextCapable(
            AutomationElement element,
            bool editableOnly,
            int maxDepth = 0)
        {
            if (maxDepth <= 0) maxDepth = Constants.PARENT_CHAIN_MAX_DEPTH;

            var current = element;
            var walker = TreeWalker.ControlViewWalker;

            for (int i = 0; i < maxDepth; i++)
            {
                try
                {
                    var parent = walker.GetParent(current);
                    if (parent == null || Automation.Compare(parent, AutomationElement.RootElement))
                        break;

                    if (UIAutomationHelpers.IsTextCapable(parent))
                    {
                        if (!editableOnly || UIAutomationHelpers.IsElementEditable(parent))
                            return parent;
                    }

                    current = parent;
                }
                catch (ElementNotAvailableException)
                {
                    break;
                }
            }

            return null;
        }

        // =============================================================================
        // Element Information Extraction
        // =============================================================================

        /// <summary>
        /// Extract FocusedElement information from an AutomationElement.
        /// </summary>
        public static FocusedElement? GetElementInfo(AutomationElement element, string? processName = null)
        {
            try
            {
                var (role, subrole) = RoleMapper.MapControlType(element, processName);

                string? value = null;
                if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var vp))
                {
                    try
                    {
                        value = ((ValuePattern)vp).Current.Value;
                    }
                    catch { }
                }

                // Suppress value for secure fields
                if (UIAutomationHelpers.IsSecureField(element))
                {
                    value = null;
                }

                // Check actual focus state (like Swift's kAXFocusedAttribute)
                bool isFocused = true;  // Default to true for safety
                try
                {
                    var hasFocus = (bool)element.GetCurrentPropertyValue(AutomationElement.HasKeyboardFocusProperty);
                    isFocused = hasFocus;
                }
                catch
                {
                    // If we can't determine focus, default to true (conservative)
                }

                return new FocusedElement
                {
                    Role = role,
                    Subrole = subrole,
                    Title = element.Current.Name,
                    Value = value,
                    Description = element.Current.HelpText,
                    IsEditable = UIAutomationHelpers.IsElementEditable(element),
                    IsFocused = isFocused,
                    IsPlaceholder = UIAutomationHelpers.IsPlaceholderShowing(element, null),
                    IsSecure = UIAutomationHelpers.IsSecureField(element)
                };
            }
            catch
            {
                return null;
            }
        }

        // =============================================================================
        // Window Information Extraction
        // =============================================================================

        /// <summary>
        /// Get window information for the element's containing window.
        /// </summary>
        public static WindowInfo? GetWindowInfo(AutomationElement? element, string? processName = null)
        {
            var windowElement = UIAutomationHelpers.GetWindowElement(element);
            if (windowElement == null) return null;

            try
            {
                var title = windowElement.Current.Name;

                // URL will be extracted separately by UrlResolver
                return new WindowInfo
                {
                    Title = title,
                    Url = null  // Will be set by AccessibilityContextService
                };
            }
            catch
            {
                return null;
            }
        }

        // =============================================================================
        // Application Information Extraction
        // =============================================================================

        /// <summary>
        /// Get application information for the element's process.
        /// </summary>
        public static (Application? app, string? processName) GetApplicationInfo(AutomationElement? element)
        {
            if (element == null) return (null, null);

            try
            {
                var windowElement = UIAutomationHelpers.GetWindowElement(element);
                if (windowElement == null) return (null, null);

                var processId = windowElement.Current.ProcessId;
                var process = Process.GetProcessById(processId);

                var processName = process.ProcessName;
                string? bundleId = null;
                string? version = null;

                try
                {
                    bundleId = process.MainModule?.FileName ?? "";
                    version = process.MainModule?.FileVersionInfo.ProductVersion ?? "";
                }
                catch
                {
                    // Access denied to MainModule in some cases
                }

                var app = new Application
                {
                    Name = processName,
                    BundleIdentifier = bundleId ?? "",
                    Pid = processId,
                    Version = version ?? ""
                };

                return (app, processName);
            }
            catch
            {
                return (null, null);
            }
        }
    }
}
