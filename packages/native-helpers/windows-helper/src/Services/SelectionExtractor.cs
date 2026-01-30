using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Interop.UIAutomationClient;
using WindowsHelper.Models;
using WindowsHelper.Utils;

namespace WindowsHelper.Services
{
    /// <summary>
    /// Service for extracting text selection using COM interop.
    /// For Chromium contenteditable (Notion, etc.), searches descendants to find the specific Edit with caret.
    /// For other apps, walks UP parents to find TextPattern.
    /// </summary>
    public static class SelectionExtractor
    {
        /// <summary>
        /// Extract text selection from an element.
        /// </summary>
        public static TextSelection? Extract(
            IUIAutomationElement focusedElement,
            IUIAutomationElement extractionElement,
            MetricsBuilder metricsBuilder)
        {
            var sw = Stopwatch.StartNew();
            var builder = new TextSelectionBuilder();

            // Check if focused element is editable
            var focusedIsEditable = IsElementEditable(focusedElement);

            // Secure field check
            if (IsSecureField(focusedElement))
            {
                return TextSelectionBuilder.SecureField(focusedIsEditable);
            }

            // Try to find the specific Edit element that contains the caret.
            // This handles cases where the focused element is a container (Group, Pane, etc.)
            // containing multiple editable regions (e.g., Notion title + content).
            var editWithCaret = FindEditWithCaret(focusedElement, metricsBuilder);
            if (editWithCaret != null)
            {
                var editResult = ExtractFromEditElement(editWithCaret, metricsBuilder);
                if (editResult != null)
                {
                    metricsBuilder.TextPatternSucceeded = true;
                    return editResult;
                }
            }
            else
            {
                // No Edit with caret found - this often happens for empty lines in Notion
                // where the caret is in a placeholder position not within any Edit.
                var focusedClass = "";
                try { focusedClass = focusedElement?.CurrentClassName ?? ""; } catch { }
                
                if (focusedClass.Contains("ContentEditable") || focusedClass.Contains("contentEditable") || 
                    focusedClass.Contains("whenContentEditable"))
                {
                    metricsBuilder.TextPatternSucceeded = true;
                    return new TextSelectionBuilder
                    {
                        FullContent = "",
                        SelectedText = "",
                        SelectionRange = new SelectionRange { Location = 0, Length = 0 },
                        PreSelectionText = "",
                        PostSelectionText = "",
                        IsEditable = true,
                        IsPlaceholder = true,
                        ExtractionMethod = The0.TextMarkerRange
                    }.Build();
                }
            }

            // Try to get TextPattern from extraction element
            IUIAutomationTextPattern? textPattern = GetTextPattern(extractionElement);

            // If no TextPattern, walk UP parents (with timeout)
            if (textPattern == null)
            {
                var walker = UIAutomationService.ControlViewWalker;
                var current = extractionElement;

                for (int depth = 0; depth < Constants.PARENT_CHAIN_MAX_DEPTH; depth++)
                {
                    if (sw.ElapsedMilliseconds > Constants.PARENT_WALK_TIMEOUT_MS)
                    {
                        metricsBuilder.RecordError("Parent walk timeout");
                        break;
                    }

                    try
                    {
                        current = walker.GetParentElement(current);
                        if (current == null) break;

                        textPattern = GetTextPattern(current);
                        if (textPattern != null) break;
                    }
                    catch (COMException)
                    {
                        break;
                    }
                }
            }

            // If we found TextPattern, extract selection
            if (textPattern != null)
            {
                metricsBuilder.TextPatternAttempted = true;
                var result = ExtractViaTextPattern(textPattern, focusedElement, metricsBuilder);

                if (result != null)
                {
                    metricsBuilder.TextPatternSucceeded = true;

                    builder.SelectedText = result.SelectedText;
                    builder.SelectionRange = result.SelectionRange;
                    builder.FullContent = result.FullContent;
                    builder.HasMultipleRanges = result.HasMultipleRanges;
                    builder.FullContentTruncated = result.FullContentTruncated;
                    builder.ExtractionMethod = The0.TextMarkerRange;
                    builder.IsEditable = focusedIsEditable || IsElementEditable(extractionElement);
                    builder.IsPlaceholder = IsPlaceholderShowing(focusedElement) ||
                                           IsPlaceholderShowing(extractionElement);

                    // Compute pre/post context
                    if (result.SelectionRange != null && result.FullContent != null)
                    {
                        builder.PreSelectionText = ComputePreContext(result.FullContent, result.SelectionRange);
                        builder.PostSelectionText = ComputePostContext(result.FullContent, result.SelectionRange);
                    }

                    return builder.Build();
                }
            }

            // Fallback: Try ValuePattern
            var valueResult = ExtractViaValuePattern(extractionElement);
            if (valueResult != null)
            {
                metricsBuilder.RecordFallback(The0.ValueAttribute);
                builder.FullContent = valueResult;
                builder.ExtractionMethod = The0.ValueAttribute;
                builder.IsEditable = focusedIsEditable || IsElementEditable(extractionElement);
                builder.IsPlaceholder = IsPlaceholderShowing(focusedElement) || IsPlaceholderShowing(extractionElement);
                // ValuePattern doesn't provide caret info, but provide empty strings for consistency
                builder.SelectedText = "";
                builder.PreSelectionText = "";
                builder.PostSelectionText = "";
                return builder.Build();
            }

            return null;
        }

        /// <summary>
        /// Get TextPattern from element if it's a text-capable control type.
        /// </summary>
        private static IUIAutomationTextPattern? GetTextPattern(IUIAutomationElement element)
        {
            if (element == null) return null;

            try
            {
                var controlType = element.CurrentControlType;

                // Only check Edit and Document control types
                if (controlType != Constants.UIA_EditControlTypeId &&
                    controlType != Constants.UIA_DocumentControlTypeId)
                {
                    return null;
                }

                var pattern = element.GetCurrentPattern(Constants.UIA_TextPatternId);
                return pattern as IUIAutomationTextPattern;
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
        /// Extract selection using TextPattern.
        /// Uses RangeFromChild to scope extraction to the focused element when possible.
        /// </summary>
        private static TextExtractionResult? ExtractViaTextPattern(
            IUIAutomationTextPattern textPattern,
            IUIAutomationElement focusedElement,
            MetricsBuilder metricsBuilder)
        {
            try
            {
                // Get document range
                var docRange = textPattern.DocumentRange;
                if (docRange == null) return null;

                // Get selection
                IUIAutomationTextRange? selectionRange = null;
                bool hasMultipleRanges = false;

                try
                {
                    var selections = textPattern.GetSelection();
                    if (selections != null && selections.Length > 0)
                    {
                        selectionRange = selections.GetElement(0);
                        hasMultipleRanges = selections.Length > 1;
                    }
                }
                catch (COMException ex)
                {
                    metricsBuilder.RecordError($"GetSelection failed: {ex.HResult}");
                }

                // If no selection, try caret range (TextPattern2)
                if (selectionRange == null)
                {
                    selectionRange = GetCaretRange(textPattern);
                }

                if (selectionRange == null)
                {
                    // No selection AND no active caret - this means the element
                    // doesn't actually have keyboard focus. Don't extract content
                    // from non-focused text elements (e.g., Notion's Document
                    // when clicking on non-editable title).
                    return null;
                }

                // Use document range for text extraction
                var contentRange = docRange;

                // Get selected text
                var rawSelectedText = selectionRange.GetText(-1);
                var selectedText = StringHelpers.NormalizeNewlines(rawSelectedText);
                var selectionLength = selectedText?.Length ?? 0;

                // Get text before selection to compute location (relative to scoped range)
                var beforeRange = selectionRange.Clone();
                beforeRange.MoveEndpointByRange(
                    TextPatternRangeEndpoint.TextPatternRangeEndpoint_Start,
                    contentRange,
                    TextPatternRangeEndpoint.TextPatternRangeEndpoint_Start);
                beforeRange.MoveEndpointByRange(
                    TextPatternRangeEndpoint.TextPatternRangeEndpoint_End,
                    selectionRange,
                    TextPatternRangeEndpoint.TextPatternRangeEndpoint_Start);

                var rawBeforeText = beforeRange.GetText(-1);
                var beforeText = StringHelpers.NormalizeNewlines(rawBeforeText);
                var location = beforeText?.Length ?? 0;

                // Get full content from scoped range
                var rawFullContent = contentRange.GetText(-1);
                var fullContent = StringHelpers.NormalizeNewlines(rawFullContent);
                var fullContentTruncated = false;

                // Truncate if needed
                if (fullContent != null && fullContent.Length > Constants.MAX_FULL_CONTENT_LENGTH)
                {
                    var windowResult = WindowContent(fullContent, location, selectionLength);
                    fullContent = windowResult.Content;
                    location = windowResult.AdjustedLocation;
                    selectionLength = Math.Min(selectionLength, fullContent.Length - location);
                    fullContentTruncated = true;

                    // Re-derive selected text from windowed content
                    if (selectionLength > 0 && location + selectionLength <= fullContent.Length)
                    {
                        selectedText = fullContent.Substring(location, selectionLength);
                    }
                }

                return new TextExtractionResult
                {
                    SelectedText = selectedText,
                    SelectionRange = new SelectionRange { Location = location, Length = selectionLength },
                    FullContent = fullContent,
                    HasMultipleRanges = hasMultipleRanges,
                    FullContentTruncated = fullContentTruncated
                };
            }
            catch (COMException ex)
            {
                metricsBuilder.RecordError($"TextPattern extraction failed: {ex.HResult}");
                return null;
            }
            catch (Exception ex)
            {
                metricsBuilder.RecordError($"TextPattern extraction error: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Get caret range using TextPattern2 if available.
        /// </summary>
        private static IUIAutomationTextRange? GetCaretRange(IUIAutomationTextPattern textPattern)
        {
            try
            {
                // Try to cast to TextPattern2
                var textPattern2 = textPattern as IUIAutomationTextPattern2;
                if (textPattern2 == null) return null;

                var caretRange = textPattern2.GetCaretRange(out int isActive);
                if (isActive == 0 || caretRange == null) return null;

                return caretRange;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Extract value using ValuePattern.
        /// </summary>
        private static string? ExtractViaValuePattern(IUIAutomationElement element)
        {
            if (element == null) return null;

            try
            {
                var pattern = element.GetCurrentPattern(Constants.UIA_ValuePatternId);
                var valuePattern = pattern as IUIAutomationValuePattern;
                if (valuePattern == null) return null;

                var value = valuePattern.CurrentValue;
                if (string.IsNullOrEmpty(value)) return null;

                var normalized = StringHelpers.NormalizeNewlines(value);
                var (truncated, _) = TruncateIfNeeded(normalized);
                return truncated;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Check if element is editable.
        /// </summary>
        private static bool IsElementEditable(IUIAutomationElement element)
        {
            if (element == null) return false;

            try
            {
                // Check ValuePattern IsReadOnly
                var pattern = element.GetCurrentPattern(Constants.UIA_ValuePatternId);
                var valuePattern = pattern as IUIAutomationValuePattern;
                if (valuePattern != null)
                {
                    return valuePattern.CurrentIsReadOnly == 0;
                }

                // Check control type
                var controlType = element.CurrentControlType;
                if (controlType == Constants.UIA_EditControlTypeId ||
                    controlType == Constants.UIA_DocumentControlTypeId)
                {
                    return element.CurrentIsEnabled != 0;
                }
            }
            catch
            {
            }

            return false;
        }

        /// <summary>
        /// Check if element is a secure/password field.
        /// </summary>
        private static bool IsSecureField(IUIAutomationElement element)
        {
            if (element == null) return false;

            try
            {
                return element.CurrentIsPassword != 0;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Check if placeholder is showing.
        /// </summary>
        private static bool IsPlaceholderShowing(IUIAutomationElement element)
        {
            if (element == null) return false;

            try
            {
                // Check if value is empty but name has content (common placeholder pattern)
                var pattern = element.GetCurrentPattern(Constants.UIA_ValuePatternId);
                var valuePattern = pattern as IUIAutomationValuePattern;
                if (valuePattern != null)
                {
                    var value = valuePattern.CurrentValue;
                    if (string.IsNullOrEmpty(value))
                    {
                        var name = element.CurrentName;
                        return !string.IsNullOrEmpty(name);
                    }
                }
            }
            catch
            {
            }

            return false;
        }

        /// <summary>
        /// Truncate content if it exceeds max length.
        /// Uses surrogate-safe boundaries to avoid splitting emoji/unicode characters.
        /// </summary>
        private static (string content, bool truncated) TruncateIfNeeded(string? content)
        {
            if (content == null) return ("", false);
            if (content.Length <= Constants.MAX_FULL_CONTENT_LENGTH) return (content, false);

            // Head + tail truncation with surrogate-safe boundaries
            const string delimiter = "\n...\n";
            var availableSpace = Constants.MAX_FULL_CONTENT_LENGTH - delimiter.Length;
            var headSize = availableSpace / 2;
            var tailSize = availableSpace - headSize;

            // Ensure we don't split surrogate pairs
            var head = StringHelpers.TruncateAtSurrogateBoundary(content, headSize);
            var tailStart = StringHelpers.AdjustForSurrogatePair(content, content.Length - tailSize);
            var tail = content.Substring(tailStart);

            return (head + delimiter + tail, true);
        }

        /// <summary>
        /// Window content around selection.
        /// </summary>
        private static (string Content, int AdjustedLocation) WindowContent(
            string content, int location, int selectionLength)
        {
            // Window around selection with padding
            var windowStart = Math.Max(0, location - Constants.WINDOW_PADDING);
            var windowEnd = Math.Min(content.Length, location + selectionLength + Constants.WINDOW_PADDING);

            // Ensure window doesn't exceed max
            if (windowEnd - windowStart > Constants.MAX_FULL_CONTENT_LENGTH)
            {
                var center = location + selectionLength / 2;
                windowStart = Math.Max(0, center - Constants.MAX_FULL_CONTENT_LENGTH / 2);
                windowEnd = Math.Min(content.Length, windowStart + Constants.MAX_FULL_CONTENT_LENGTH);
                windowStart = Math.Max(0, windowEnd - Constants.MAX_FULL_CONTENT_LENGTH);
            }

            var windowed = content.Substring(windowStart, windowEnd - windowStart);
            var adjustedLocation = location - windowStart;

            return (windowed, adjustedLocation);
        }

        /// <summary>
        /// Compute pre-selection context.
        /// </summary>
        private static string? ComputePreContext(string fullContent, SelectionRange range)
        {
            if (string.IsNullOrEmpty(fullContent)) return "";
            
            var location = (int)range.Location;
            if (location <= 0) return "";
            if (location > fullContent.Length) location = fullContent.Length;

            var start = Math.Max(0, location - Constants.MAX_CONTEXT_LENGTH);
            return fullContent.Substring(start, location - start);
        }

        /// <summary>
        /// Compute post-selection context.
        /// </summary>
        private static string? ComputePostContext(string fullContent, SelectionRange range)
        {
            if (string.IsNullOrEmpty(fullContent)) return "";
            
            var end = (int)(range.Location + range.Length);
            if (end < 0) end = 0;
            if (end >= fullContent.Length) return "";

            var length = Math.Min(Constants.MAX_CONTEXT_LENGTH, fullContent.Length - end);
            return fullContent.Substring(end, length);
        }

        /// <summary>
        /// Find the Edit element that contains the caret within a Group element.
        /// This handles Chromium contenteditable where the focused element is a Group
        /// containing multiple Edit children (e.g., title and content in Notion).
        /// </summary>
        private static IUIAutomationElement? FindEditWithCaret(
            IUIAutomationElement groupElement,
            MetricsBuilder metricsBuilder)
        {
            try
            {
                // First, find the parent Document with TextPattern to get selection
                var docTextPattern = FindParentTextPattern(groupElement);
                if (docTextPattern == null) return null;

                // Get the current selection/caret position
                IUIAutomationTextRange? caretRange = null;
                try
                {
                    var selections = docTextPattern.GetSelection();
                    if (selections != null && selections.Length > 0)
                    {
                        caretRange = selections.GetElement(0);
                    }
                }
                catch (COMException)
                {
                    return null;
                }

                if (caretRange == null) return null;

                // Search for Edit descendants
                var edits = FindEditDescendants(groupElement, maxDepth: Constants.EDIT_SEARCH_MAX_DEPTH, maxEdits: Constants.EDIT_SEARCH_MAX_EDITS);
                if (edits.Count == 0) return null;

                // Find which Edit contains the caret using range comparison
                foreach (var edit in edits)
                {
                    try
                    {
                        var editRange = docTextPattern.RangeFromChild(edit);
                        if (editRange == null) continue;

                        // Check if caret is within this Edit's range
                        // caret.start >= edit.start AND caret.start <= edit.end
                        int startCompare = caretRange.CompareEndpoints(
                            TextPatternRangeEndpoint.TextPatternRangeEndpoint_Start,
                            editRange,
                            TextPatternRangeEndpoint.TextPatternRangeEndpoint_Start);
                        int endCompare = caretRange.CompareEndpoints(
                            TextPatternRangeEndpoint.TextPatternRangeEndpoint_Start,
                            editRange,
                            TextPatternRangeEndpoint.TextPatternRangeEndpoint_End);

                        if (startCompare >= 0 && endCompare <= 0)
                        {
                            return edit;
                        }
                    }
                    catch (COMException)
                    {
                        continue;
                    }
                }
            }
            catch (Exception ex)
            {
                metricsBuilder.RecordError($"FindEditWithCaret: {ex.Message}");
            }

            return null;
        }

        /// <summary>
        /// Find parent element with TextPattern.
        /// </summary>
        private static IUIAutomationTextPattern? FindParentTextPattern(IUIAutomationElement element)
        {
            var walker = UIAutomationService.ControlViewWalker;
            var current = element;

            for (int i = 0; i < Constants.PARENT_CHAIN_MAX_DEPTH; i++)
            {
                try
                {
                    var parent = walker.GetParentElement(current);
                    if (parent == null) break;

                    var parentType = parent.CurrentControlType;
                    if (parentType == Constants.UIA_EditControlTypeId ||
                        parentType == Constants.UIA_DocumentControlTypeId)
                    {
                        var tp = parent.GetCurrentPattern(Constants.UIA_TextPatternId) as IUIAutomationTextPattern;
                        if (tp != null) return tp;
                    }

                    current = parent;
                }
                catch (COMException)
                {
                    break;
                }
            }

            return null;
        }

        /// <summary>
        /// Find Edit element descendants using BFS.
        /// </summary>
        private static List<IUIAutomationElement> FindEditDescendants(
            IUIAutomationElement root, int maxDepth, int maxEdits)
        {
            var edits = new List<IUIAutomationElement>();
            var walker = UIAutomationService.ControlViewWalker;
            var queue = new Queue<(IUIAutomationElement elem, int depth)>();
            queue.Enqueue((root, 0));

            while (queue.Count > 0 && edits.Count < maxEdits)
            {
                var (current, depth) = queue.Dequeue();
                if (depth > maxDepth) continue;

                try
                {
                    var child = walker.GetFirstChildElement(current);
                    while (child != null && edits.Count < maxEdits)
                    {
                        var childType = child.CurrentControlType;
                        if (childType == Constants.UIA_EditControlTypeId)
                        {
                            edits.Add(child);
                        }

                        if (depth + 1 <= maxDepth)
                        {
                            queue.Enqueue((child, depth + 1));
                        }

                        child = walker.GetNextSiblingElement(child);
                    }
                }
                catch (COMException)
                {
                    continue;
                }
            }

            return edits;
        }

        /// <summary>
        /// Extract text from an Edit element using its ValuePattern and TextPattern.
        /// </summary>
        private static TextSelection? ExtractFromEditElement(
            IUIAutomationElement editElement,
            MetricsBuilder metricsBuilder)
        {
            try
            {
                var builder = new TextSelectionBuilder();
                builder.IsEditable = true;
                builder.ExtractionMethod = The0.TextMarkerRange;

                // Get content from ValuePattern
                var valuePattern = editElement.GetCurrentPattern(Constants.UIA_ValuePatternId) as IUIAutomationValuePattern;
                var textPattern = editElement.GetCurrentPattern(Constants.UIA_TextPatternId) as IUIAutomationTextPattern;

                string? fullContent = null;

                // Prefer TextPattern for caret position, ValuePattern for content
                if (valuePattern != null)
                {
                    fullContent = StringHelpers.NormalizeNewlines(valuePattern.CurrentValue);
                    builder.IsEditable = valuePattern.CurrentIsReadOnly == 0;
                }
                else if (textPattern != null)
                {
                    var docRange = textPattern.DocumentRange;
                    fullContent = StringHelpers.NormalizeNewlines(docRange?.GetText(-1));
                }

                // Empty content is valid (empty editable field)
                fullContent = fullContent ?? "";

                // Truncate if content is too large
                var (truncatedContent, wasTruncated) = TruncateIfNeeded(fullContent);
                builder.FullContent = truncatedContent;
                builder.FullContentTruncated = wasTruncated;

                // Try to get caret position from TextPattern
                if (textPattern != null)
                {
                    try
                    {
                        var selections = textPattern.GetSelection();
                        if (selections != null && selections.Length > 0)
                        {
                            var selRange = selections.GetElement(0);
                            var selectedText = StringHelpers.NormalizeNewlines(selRange.GetText(-1));
                            builder.SelectedText = selectedText;

                            // Get location using before text
                            var docRange = textPattern.DocumentRange;
                            var beforeRange = selRange.Clone();
                            beforeRange.MoveEndpointByRange(
                                TextPatternRangeEndpoint.TextPatternRangeEndpoint_Start,
                                docRange,
                                TextPatternRangeEndpoint.TextPatternRangeEndpoint_Start);
                            beforeRange.MoveEndpointByRange(
                                TextPatternRangeEndpoint.TextPatternRangeEndpoint_End,
                                selRange,
                                TextPatternRangeEndpoint.TextPatternRangeEndpoint_Start);

                            var beforeText = StringHelpers.NormalizeNewlines(beforeRange.GetText(-1));
                            var location = beforeText?.Length ?? 0;
                            var selectionLength = selectedText?.Length ?? 0;

                            builder.SelectionRange = new SelectionRange
                            {
                                Location = location,
                                Length = selectionLength
                            };

                            // Compute pre/post context
                            if (fullContent != null)
                            {
                                builder.PreSelectionText = ComputePreContext(fullContent, builder.SelectionRange);
                                builder.PostSelectionText = ComputePostContext(fullContent, builder.SelectionRange);
                            }
                        }
                    }
                    catch (COMException)
                    {
                        // No selection available, return content without position
                    }
                }

                // Check placeholder
                builder.IsPlaceholder = IsPlaceholderShowing(editElement);

                return builder.Build();
            }
            catch (Exception ex)
            {
                metricsBuilder.RecordError($"ExtractFromEditElement: {ex.Message}");
                return null;
            }
        }
    }

    /// <summary>
    /// Result of text extraction.
    /// </summary>
    internal class TextExtractionResult
    {
        public string? SelectedText { get; set; }
        public SelectionRange? SelectionRange { get; set; }
        public string? FullContent { get; set; }
        public bool HasMultipleRanges { get; set; }
        public bool FullContentTruncated { get; set; }
        public bool IsLargeDoc { get; set; }
    }

}
