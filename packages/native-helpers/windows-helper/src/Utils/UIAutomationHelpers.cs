using System;
using System.Collections.Generic;
using System.Windows.Automation;
using System.Windows.Automation.Text;

namespace WindowsHelper.Utils
{
    /// <summary>
    /// Document candidate for selection (maps to Swift's WebAreaCandidate).
    /// </summary>
    public struct DocumentCandidate
    {
        public AutomationElement Element;
        public int Depth;        // Positive = descendant, negative = ancestor
        public bool IsAncestor;
    }

    /// <summary>
    /// Shared UI Automation utility methods.
    /// Provides common functionality for element inspection, tree traversal, and detection.
    /// </summary>
    public static class UIAutomationHelpers
    {
        // =============================================================================
        // Element Property Checks
        // =============================================================================

        /// <summary>
        /// Check if element is editable (not read-only).
        /// Matches Swift's isElementEditable logic.
        /// </summary>
        public static bool IsElementEditable(AutomationElement element)
        {
            try
            {
                // Check IsReadOnlyProperty at element level first (works even without ValuePattern)
                // This catches read-only Edit/Document controls that don't expose ValuePattern
                var isReadOnlyValue = element.GetCurrentPropertyValue(ValuePattern.IsReadOnlyProperty);
                if (isReadOnlyValue != AutomationElement.NotSupported)
                {
                    // Property is supported - check its value
                    if (isReadOnlyValue is bool isReadOnly)
                    {
                        // If explicitly read-only, return false immediately
                        if (isReadOnly) return false;
                        // If explicitly not read-only, return true
                        return true;
                    }
                }

                // Fallback: try accessing via ValuePattern directly
                if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var vp))
                {
                    var valuePattern = (ValuePattern)vp;
                    try
                    {
                        if (!valuePattern.Current.IsReadOnly) return true;
                        return false;  // Explicitly read-only
                    }
                    catch (InvalidOperationException)
                    {
                        // IsReadOnly not supported on this ValuePattern - continue to heuristics
                    }
                }

                // Check for editable ControlTypes (fallback heuristic)
                // Only apply if element is enabled AND we couldn't determine read-only status above
                var controlType = element.Current.ControlType;
                if (controlType == ControlType.Edit ||
                    controlType == ControlType.Document)
                {
                    // Be conservative: only return true if enabled
                    // Note: This is a heuristic when IsReadOnly check fails
                    return element.Current.IsEnabled;
                }

                return false;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Check if element is a secure (password) field.
        /// </summary>
        public static bool IsSecureField(AutomationElement element)
        {
            try
            {
                // Primary: IsPassword property
                var isPassword = (bool)element.GetCurrentPropertyValue(
                    AutomationElement.IsPasswordProperty);
                if (isPassword) return true;

                // Secondary: Check ControlType + common password field patterns
                var controlType = element.Current.ControlType;
                var automationId = element.Current.AutomationId?.ToLowerInvariant() ?? "";
                var name = element.Current.Name?.ToLowerInvariant() ?? "";

                if (controlType == ControlType.Edit)
                {
                    // Common password field indicators
                    if (automationId.Contains("password") ||
                        automationId.Contains("pwd") ||
                        name.Contains("password"))
                    {
                        return true;
                    }
                }

                return false;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Check if element appears to be showing placeholder text.
        /// Windows doesn't have AXPlaceholderValue, so use heuristics.
        /// </summary>
        public static bool IsPlaceholderShowing(AutomationElement element, int? selectionLength)
        {
            try
            {
                // Get current value
                string? currentValue = null;
                if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var vp))
                {
                    currentValue = ((ValuePattern)vp).Current.Value;
                }

                // Heuristic 1: Empty value with Name attribute (often placeholder)
                var name = element.Current.Name;
                if (string.IsNullOrEmpty(currentValue) && !string.IsNullOrEmpty(name))
                {
                    // Check if name looks like a placeholder (not a label)
                    // Placeholders often have instructional text
                    if (name.Contains("...") ||
                        name.StartsWith("Enter ", StringComparison.OrdinalIgnoreCase) ||
                        name.StartsWith("Search", StringComparison.OrdinalIgnoreCase) ||
                        name.StartsWith("Type ", StringComparison.OrdinalIgnoreCase))
                    {
                        return (selectionLength ?? 0) == 0;
                    }
                }

                // Heuristic 2: Check for HelpText (sometimes used as placeholder)
                var helpText = element.Current.HelpText;
                if (!string.IsNullOrEmpty(helpText) && string.IsNullOrEmpty(currentValue))
                {
                    return (selectionLength ?? 0) == 0;
                }

                // Heuristic 3: Check if value matches the Name (placeholder echo)
                if (!string.IsNullOrEmpty(currentValue) && currentValue == name)
                {
                    return (selectionLength ?? 0) == 0;
                }

                return false;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Check if element supports text selection/editing (has TextPattern).
        /// </summary>
        public static bool IsTextCapable(AutomationElement element)
        {
            try
            {
                // Has TextPattern = text-capable
                if (element.TryGetCurrentPattern(TextPattern.Pattern, out _))
                    return true;

                // Check ControlType
                var controlType = element.Current.ControlType;
                if (controlType == ControlType.Edit ||
                    controlType == ControlType.Document)
                    return true;

                return false;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Check if element has a valid selection or caret position.
        /// Maps to Swift's hasTextMarkerRange - includes caret-only via TextPattern2.
        /// </summary>
        public static bool HasTextPatternSelection(AutomationElement element)
        {
            // Check TextPattern.GetSelection() first
            if (element.TryGetCurrentPattern(TextPattern.Pattern, out var tp))
            {
                try
                {
                    var selections = ((TextPattern)tp).GetSelection();
                    if (selections != null && selections.Length > 0)
                        return true;
                }
                catch { }
            }

            // Also check TextPattern2.GetCaretRange() for caret-only focus (Win10+)
            // This mirrors Swift's marker-range detection which includes cursor position
            // (Round 8 fix: HasTextPatternSelection doesn't account for TextPattern2 caret)
            if (element.TryGetCurrentPattern(TextPattern2.Pattern, out var tp2))
            {
                try
                {
                    var caretRange = ((TextPattern2)tp2).GetCaretRange(out bool isActive);
                    if (isActive && caretRange != null)
                        return true;
                }
                catch { }
            }

            return false;
        }

        // =============================================================================
        // Tree Navigation
        // =============================================================================

        /// <summary>
        /// Get children of an element using TreeWalker.
        /// </summary>
        public static List<AutomationElement> GetChildren(AutomationElement element, int maxChildren = int.MaxValue)
        {
            var children = new List<AutomationElement>();
            var walker = TreeWalker.ControlViewWalker;

            try
            {
                var child = walker.GetFirstChild(element);
                while (child != null && children.Count < maxChildren)
                {
                    children.Add(child);
                    child = walker.GetNextSibling(child);
                }
            }
            catch (ElementNotAvailableException)
            {
                // Element became unavailable
            }

            return children;
        }

        /// <summary>
        /// Get parent of an element using TreeWalker.
        /// </summary>
        public static AutomationElement? GetParent(AutomationElement element)
        {
            try
            {
                var walker = TreeWalker.ControlViewWalker;
                var parent = walker.GetParent(element);
                if (parent == null || Automation.Compare(parent, AutomationElement.RootElement))
                    return null;
                return parent;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Touch descendants to trigger lazy accessibility population.
        /// Uses per-level prefix limiting matching Swift's implementation.
        /// </summary>
        public static void TouchDescendants(
            AutomationElement element,
            int maxDepth = 0)
        {
            if (maxDepth <= 0) maxDepth = Constants.TOUCH_DESCENDANTS_MAX_DEPTH;

            TouchDescendantsRecursive(element, maxDepth);
        }

        private static void TouchDescendantsRecursive(AutomationElement element, int remainingDepth)
        {
            // Base case: stop if we've reached max depth
            if (remainingDepth <= 0) return;

            var walker = TreeWalker.ControlViewWalker;

            try
            {
                // Get children and limit to prefix
                var children = new List<AutomationElement>();
                var child = walker.GetFirstChild(element);
                int count = 0;

                while (child != null && count < Constants.TOUCH_DESCENDANTS_PREFIX_LIMIT)
                {
                    children.Add(child);
                    count++;
                    child = walker.GetNextSibling(child);
                }

                // Touch each child by reading a property, then recurse
                foreach (var c in children)
                {
                    try
                    {
                        // Touch by reading a property (triggers lazy loading)
                        var _ = c.Current.ControlType;

                        // Recurse with reduced depth
                        TouchDescendantsRecursive(c, remainingDepth - 1);
                    }
                    catch (ElementNotAvailableException) { }
                }
            }
            catch (ElementNotAvailableException) { }
        }

        /// <summary>
        /// Check if element A is a descendant of or equal to element B.
        /// Maps to Swift's isDescendantOrEqual.
        /// </summary>
        public static bool IsDescendantOrEqual(AutomationElement elementA, AutomationElement elementB)
        {
            try
            {
                if (Automation.Compare(elementA, elementB)) return true;

                var current = elementA;
                var walker = TreeWalker.ControlViewWalker;

                for (int i = 0; i < Constants.DESCENDANT_CHECK_MAX_DEPTH; i++)
                {
                    var parent = walker.GetParent(current);
                    if (parent == null || Automation.Compare(parent, AutomationElement.RootElement)) break;
                    if (Automation.Compare(parent, elementB)) return true;
                    current = parent;
                }
            }
            catch
            {
                // Ignore errors during traversal
            }

            return false;
        }

        // =============================================================================
        // Document Search (maps to Swift's WebArea search)
        // =============================================================================

        /// <summary>
        /// Find Document elements in descendants using BFS with depth/element limits.
        /// </summary>
        public static List<DocumentCandidate> FindDocumentsInDescendants(
            AutomationElement element,
            int maxDepth = 0,
            int maxElements = 0)
        {
            if (maxDepth <= 0) maxDepth = Constants.DOCUMENT_SEARCH_MAX_DEPTH;
            if (maxElements <= 0) maxElements = Constants.DOCUMENT_SEARCH_MAX_ELEMENTS;

            var results = new List<DocumentCandidate>();
            var queue = new Queue<(AutomationElement el, int depth)>();
            queue.Enqueue((element, 0));
            int visited = 0;
            var walker = TreeWalker.ControlViewWalker;

            while (queue.Count > 0 && visited < maxElements)
            {
                var (current, depth) = queue.Dequeue();
                visited++;

                if (depth > maxDepth) continue;

                try
                {
                    // Check children
                    var child = walker.GetFirstChild(current);
                    while (child != null && visited < maxElements)
                    {
                        if (child.Current.ControlType == ControlType.Document)
                        {
                            results.Add(new DocumentCandidate
                            {
                                Element = child,
                                Depth = depth + 1,
                                IsAncestor = false
                            });
                        }
                        queue.Enqueue((child, depth + 1));
                        child = walker.GetNextSibling(child);
                    }
                }
                catch (ElementNotAvailableException) { }
            }

            return results;
        }

        /// <summary>
        /// Find Document elements in ancestors.
        /// </summary>
        public static List<DocumentCandidate> FindDocumentsInAncestors(
            AutomationElement element,
            int maxDepth = 0)
        {
            if (maxDepth <= 0) maxDepth = Constants.DOCUMENT_ANCESTOR_SEARCH_DEPTH;

            var results = new List<DocumentCandidate>();
            var current = element;
            var walker = TreeWalker.ControlViewWalker;

            for (int i = 0; i < maxDepth; i++)
            {
                try
                {
                    var parent = walker.GetParent(current);
                    if (parent == null || Automation.Compare(parent, AutomationElement.RootElement)) break;

                    if (parent.Current.ControlType == ControlType.Document)
                    {
                        results.Add(new DocumentCandidate
                        {
                            Element = parent,
                            Depth = -(i + 1),  // Negative for ancestors (-1 = parent, -2 = grandparent)
                            IsAncestor = true
                        });
                    }
                    current = parent;
                }
                catch (ElementNotAvailableException)
                {
                    break;
                }
            }

            return results;
        }

        /// <summary>
        /// Find the deepest text element in descendants using Swift's 3-tier priority.
        /// Priority: focused > selection-based > most content
        /// </summary>
        public static AutomationElement? FindDeepestTextElement(
            AutomationElement element,
            int maxDepth = 0,
            int maxElements = 0)
        {
            if (maxDepth <= 0) maxDepth = Constants.FIND_TEXT_ELEMENT_MAX_DEPTH;
            if (maxElements <= 0) maxElements = Constants.FIND_TEXT_ELEMENT_MAX_ELEMENTS;

            AutomationElement? focusedCandidate = null;      // AXFocused=true + value + range
            AutomationElement? selectionCandidate = null;    // Non-zero selection + value
            AutomationElement? fallbackCandidate = null;     // Most content + range
            int fallbackContentLength = 0;

            var queue = new Queue<(AutomationElement el, int depth)>();
            queue.Enqueue((element, 0));
            int visited = 0;
            var walker = TreeWalker.ControlViewWalker;

            while (queue.Count > 0 && visited < maxElements)
            {
                var (current, depth) = queue.Dequeue();
                visited++;

                if (depth > maxDepth) continue;

                try
                {
                    var child = walker.GetFirstChild(current);
                    while (child != null)
                    {
                        // Check if this is a text element
                        string? value = null;
                        bool hasValue = false;
                        bool hasRange = false;
                        int location = 0;
                        int length = 0;

                        // Try to get value
                        if (child.TryGetCurrentPattern(ValuePattern.Pattern, out var vp))
                        {
                            try
                            {
                                value = ((ValuePattern)vp).Current.Value;
                                hasValue = !string.IsNullOrEmpty(value);
                            }
                            catch { }
                        }

                        // Try to get selection range
                        if (child.TryGetCurrentPattern(TextPattern.Pattern, out var tp))
                        {
                            try
                            {
                                var selections = ((TextPattern)tp).GetSelection();
                                if (selections != null && selections.Length > 0)
                                {
                                    hasRange = true;
                                    var textPattern = (TextPattern)tp;
                                    var docRange = textPattern.DocumentRange;
                                    var selRange = selections[0];

                                    // Compare start position to determine location
                                    // Use endpoint comparison - if starts at doc start, location = 0
                                    try
                                    {
                                        if (selRange.CompareEndpoints(
                                            TextPatternRangeEndpoint.Start,
                                            docRange,
                                            TextPatternRangeEndpoint.Start) > 0)
                                        {
                                            location = 1;  // Non-zero, indicates cursor not at start
                                        }

                                        // Check if selection has length
                                        var selText = selRange.GetText(1);
                                        if (!string.IsNullOrEmpty(selText))
                                        {
                                            length = 1;  // Non-zero, indicates has selection
                                        }
                                    }
                                    catch { }
                                }
                            }
                            catch { }
                        }

                        // Priority 1: Check if this element has keyboard focus AND has content
                        try
                        {
                            var hasFocus = (bool)child.GetCurrentPropertyValue(
                                AutomationElement.HasKeyboardFocusProperty);
                            if (hasFocus && hasValue && hasRange)
                            {
                                focusedCandidate = child;
                            }
                        }
                        catch { }

                        // Priority 2: Non-zero selection position/length + value
                        if (hasRange && hasValue && (location > 0 || length > 0))
                        {
                            if (selectionCandidate == null)
                            {
                                selectionCandidate = child;
                            }
                        }

                        // Priority 3: Most content + has range (fallback)
                        if (hasRange && hasValue && value != null)
                        {
                            var contentLength = value.Length;
                            if (contentLength > fallbackContentLength)
                            {
                                fallbackContentLength = contentLength;
                                fallbackCandidate = child;
                            }
                        }

                        queue.Enqueue((child, depth + 1));
                        child = walker.GetNextSibling(child);
                    }
                }
                catch (ElementNotAvailableException) { }
            }

            // Return in priority order: focused > selection-based > most content
            return focusedCandidate ?? selectionCandidate ?? fallbackCandidate;
        }

        // =============================================================================
        // Window Element Traversal
        // =============================================================================

        /// <summary>
        /// Get the window element containing the given element.
        /// </summary>
        public static AutomationElement? GetWindowElement(AutomationElement? element)
        {
            if (element == null) return null;

            var current = element;
            var walker = TreeWalker.ControlViewWalker;

            while (current != null)
            {
                if (current.Current.ControlType == ControlType.Window)
                    return current;

                try
                {
                    var parent = walker.GetParent(current);
                    if (parent == null || Automation.Compare(parent, AutomationElement.RootElement))
                        break;
                    current = parent;
                }
                catch
                {
                    break;
                }
            }

            return null;
        }
    }
}
