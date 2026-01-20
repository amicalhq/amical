using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Automation;
using System.Windows.Automation.Text;
using WindowsHelper.Models;
using WindowsHelper.Utils;

namespace WindowsHelper.Services
{
    /// <summary>
    /// Service for extracting text selection from elements using multi-path algorithm.
    /// Implements Phase 1 extraction with TextPattern as primary path.
    /// Matches Swift's SelectionExtractor.
    /// </summary>
    public static class SelectionExtractor
    {
        // =============================================================================
        // Main Extraction Entry Point
        // =============================================================================

        /// <summary>
        /// Extract text selection from an element using multi-path algorithm.
        /// </summary>
        /// <param name="focusedElement">The originally focused element</param>
        /// <param name="extractionElement">The element to extract from (may differ from focused)</param>
        /// <param name="metricsBuilder">Builder to record extraction metrics</param>
        /// <returns>TextSelection or null if no text selection available</returns>
        public static TextSelection? Extract(
            AutomationElement focusedElement,
            AutomationElement extractionElement,
            MetricsBuilder metricsBuilder)
        {
            var builder = new TextSelectionBuilder();

            // Track both elements - extraction element may change during retry paths
            var currentExtractionElement = extractionElement;

            // Step 2: Check if focused element is editable
            var focusedIsEditable = UIAutomationHelpers.IsElementEditable(focusedElement);

            // Step 2.1: SECURE FIELD CHECK - suppress all content if secure
            // Check focused element ONLY (early exit)
            if (UIAutomationHelpers.IsSecureField(focusedElement))
            {
                return TextSelectionBuilder.SecureField(focusedIsEditable);
            }

            // Variables to track extraction state
            SelectionRange? selectionRange = null;
            string? selectedText = null;
            string? fullContent = null;
            bool hasMultipleRanges = false;
            The0 extractionMethod = The0.None;

            // Track if large doc path was used (content already windowed)
            bool isLargeDoc = false;
            bool fullContentTruncated = false;

            // =============================================================================
            // Path A: TextPattern (PRIMARY - equivalent to Swift's TextMarker)
            // NOTE: Uses extractionElement (the text-capable element), not focusedElement.
            // This matches Swift where extract() receives the text-capable element found by
            // findTextCapableElement(), not the original system focus. In container-focus
            // scenarios, extractionElement is the text field inside, while focusedElement
            // is the container - we want to extract from the text field.
            // =============================================================================
            metricsBuilder.TextPatternAttempted = true;
            var textPatternResult = ExtractViaTextPattern(extractionElement, metricsBuilder);
            if (textPatternResult != null)
            {
                metricsBuilder.TextPatternSucceeded = true;
                selectedText = textPatternResult.SelectedText;
                selectionRange = textPatternResult.SelectionRange;
                hasMultipleRanges = textPatternResult.HasMultipleRanges;
                extractionMethod = The0.TextMarkerRange;

                // Handle large doc case - content already windowed
                if (textPatternResult.IsLargeDoc)
                {
                    isLargeDoc = true;
                    fullContent = textPatternResult.FullContent;
                    fullContentTruncated = textPatternResult.FullContentTruncated;
                }
            }

            // =============================================================================
            // Document Retry Path: When TextPattern fails on focused element
            // =============================================================================
            if (extractionMethod == The0.None)
            {
                metricsBuilder.DocumentRetryAttempted = true;

                // Re-query app focused element for containsFocus scoring (like Swift does)
                var appFocusedElement = GetAppFocusedElement();

                // Search from extractionElement (the text-capable element), use appFocusedElement for scoring
                var documentElement = FindDocumentElement(extractionElement, appFocusedElement);
                if (documentElement != null)
                {
                    metricsBuilder.DocumentFound = true;

                    // Try TextPattern on Document
                    var docResult = ExtractViaTextPattern(documentElement, metricsBuilder);
                    if (docResult != null)
                    {
                        metricsBuilder.TextPatternSucceeded = true;
                        metricsBuilder.DocumentRetrySucceeded = true;
                        currentExtractionElement = documentElement;  // SWITCH extraction element
                        selectedText = docResult.SelectedText;
                        selectionRange = docResult.SelectionRange;
                        hasMultipleRanges = docResult.HasMultipleRanges;
                        extractionMethod = The0.TextMarkerRange;

                        // Handle large doc case
                        if (docResult.IsLargeDoc)
                        {
                            isLargeDoc = true;
                            fullContent = docResult.FullContent;
                            fullContentTruncated = docResult.FullContentTruncated;
                        }
                    }
                    // If TextPattern fails on Document, DON'T switch extractionElement
                }
            }

            // =============================================================================
            // Deep Text Element Path: When Document retry fails
            // =============================================================================
            if (extractionMethod == The0.None)
            {
                var deepTextElement = UIAutomationHelpers.FindDeepestTextElement(extractionElement);
                if (deepTextElement != null)
                {
                    // Try TextPattern on deep element
                    var deepResult = ExtractViaTextPattern(deepTextElement, metricsBuilder);
                    if (deepResult != null)
                    {
                        metricsBuilder.TextPatternSucceeded = true;
                        currentExtractionElement = deepTextElement;  // SWITCH
                        selectedText = deepResult.SelectedText;
                        selectionRange = deepResult.SelectionRange;
                        hasMultipleRanges = deepResult.HasMultipleRanges;
                        extractionMethod = The0.TextMarkerRange;

                        // Handle large doc case
                        if (deepResult.IsLargeDoc)
                        {
                            isLargeDoc = true;
                            fullContent = deepResult.FullContent;
                            fullContentTruncated = deepResult.FullContentTruncated;
                        }
                    }
                    else
                    {
                        // Try selectedTextRange fallback on deep element
                        var rangeResult = ExtractViaSelectedTextRange(deepTextElement);
                        if (rangeResult != null)
                        {
                            currentExtractionElement = deepTextElement;  // SWITCH
                            selectedText = rangeResult.SelectedText;
                            selectionRange = rangeResult.SelectionRange;
                            extractionMethod = The0.SelectedTextRange;
                        }
                    }
                }
            }

            // =============================================================================
            // Path B: SelectedTextRange (Fallback 1)
            // =============================================================================
            if (extractionMethod == The0.None)
            {
                metricsBuilder.RecordFallback(The0.SelectedTextRange);
                var result = ExtractViaSelectedTextRange(currentExtractionElement);
                if (result != null)
                {
                    selectedText = result.SelectedText;
                    selectionRange = result.SelectionRange;
                    extractionMethod = The0.SelectedTextRange;
                }
            }

            // =============================================================================
            // Path C: SelectedTextRanges (Fallback 2 - Multi-select)
            // =============================================================================
            if (extractionMethod == The0.None)
            {
                metricsBuilder.RecordFallback(The0.SelectedTextRanges);
                var result = ExtractViaSelectedTextRanges(currentExtractionElement);
                if (result != null)
                {
                    selectedText = result.SelectedText;
                    selectionRange = result.SelectionRange;
                    hasMultipleRanges = result.HasMultipleRanges;
                    extractionMethod = The0.SelectedTextRanges;
                }
            }

            // =============================================================================
            // Path D: ValuePattern (Fallback 3)
            // =============================================================================
            if (extractionMethod == The0.None)
            {
                metricsBuilder.RecordFallback(The0.ValueAttribute);
                if (currentExtractionElement.TryGetCurrentPattern(ValuePattern.Pattern, out var vp))
                {
                    try
                    {
                        var value = ((ValuePattern)vp).Current.Value;
                        fullContent = value;
                        extractionMethod = The0.ValueAttribute;
                        // Note: No selectionRange available from this path
                    }
                    catch { }
                }
            }

            // =============================================================================
            // Path E: TextPattern Full Content (stringForRange equivalent)
            // =============================================================================
            if (extractionMethod == The0.None)
            {
                metricsBuilder.RecordFallback(The0.StringForRange);
                if (currentExtractionElement.TryGetCurrentPattern(TextPattern.Pattern, out var tp))
                {
                    try
                    {
                        var textPattern = (TextPattern)tp;
                        // Use unbounded GetText(-1) to get full content, accepting O(n) cost as Swift does
                        var content = textPattern.DocumentRange.GetText(-1);
                        if (content != null)
                        {
                            fullContent = StringHelpers.NormalizeNewlines(content);
                            extractionMethod = The0.StringForRange;
                        }
                    }
                    catch { }
                }
            }

            // If no extraction succeeded at all, return null
            if (extractionMethod == The0.None)
            {
                return null;
            }

            // =============================================================================
            // Step 5: Full Content Retrieval (if not already obtained)
            // Skip if large doc path already provided content
            // =============================================================================
            if (!isLargeDoc && fullContent == null && selectionRange != null)
            {
                fullContent = GetFullContent(currentExtractionElement);
            }

            // =============================================================================
            // Step 3: Placeholder Check (non-blocking)
            // =============================================================================
            int? selectionLength = (int?)selectionRange?.Length;
            // OR logic: check placeholder on BOTH elements
            var focusedIsPlaceholder = UIAutomationHelpers.IsPlaceholderShowing(focusedElement, null);
            var extractionIsPlaceholder = UIAutomationHelpers.IsPlaceholderShowing(currentExtractionElement, selectionLength);
            builder.IsPlaceholder = focusedIsPlaceholder || extractionIsPlaceholder;

            // OR logic for isEditable: editable if EITHER element is editable
            var extractionIsEditable = UIAutomationHelpers.IsElementEditable(currentExtractionElement);
            builder.IsEditable = focusedIsEditable || extractionIsEditable;

            // =============================================================================
            // Step 5.1: Selection Range Validation
            // Skip clamping/re-derive for large docs (indices already relative to window)
            // =============================================================================
            if (!isLargeDoc && selectionRange != null && fullContent != null)
            {
                var (clampedRange, reDerivedSelectedText) = ClampAndRederive(fullContent, selectionRange);
                selectionRange = clampedRange;

                // Re-derive selectedText when no windowing needed
                if (fullContent.Length <= Constants.MAX_FULL_CONTENT_LENGTH)
                {
                    selectedText = reDerivedSelectedText;
                }
            }

            // =============================================================================
            // Step 6: Content Windowing
            // Skip if large doc path already windowed
            // =============================================================================
            if (!isLargeDoc && fullContent != null && fullContent.Length > Constants.MAX_FULL_CONTENT_LENGTH)
            {
                var windowResult = WindowContent(fullContent, selectionRange, metricsBuilder);
                fullContent = windowResult.WindowedContent;
                selectionRange = windowResult.AdjustedRange;
                selectedText = windowResult.SelectedText;
                fullContentTruncated = true;
            }
            else if (!isLargeDoc && fullContent != null && extractionMethod == The0.ValueAttribute)
            {
                // ValuePattern path may need head+tail truncation
                var (truncatedContent, wasTruncated) = TruncateHeadTail(fullContent);
                fullContent = truncatedContent;
                fullContentTruncated = wasTruncated;
            }
            else if (!isLargeDoc && fullContent != null && extractionMethod == The0.StringForRange)
            {
                // StringForRange path may need head+tail truncation
                if (fullContent.Length > Constants.MAX_FULL_CONTENT_LENGTH)
                {
                    var (truncatedContent, wasTruncated) = TruncateHeadTail(fullContent);
                    fullContent = truncatedContent;
                    fullContentTruncated = wasTruncated;
                }
            }

            // =============================================================================
            // Step 7: Context Computation
            // =============================================================================
            string? preSelectionText = null;
            string? postSelectionText = null;

            if (selectionRange != null && fullContent != null)
            {
                preSelectionText = ComputePreContext(fullContent, selectionRange);
                postSelectionText = ComputePostContext(fullContent, selectionRange);
            }

            // Build final result
            builder.SelectedText = selectedText;
            builder.FullContent = fullContent;
            builder.PreSelectionText = preSelectionText;
            builder.PostSelectionText = postSelectionText;
            builder.SelectionRange = selectionRange;
            builder.ExtractionMethod = extractionMethod;
            builder.HasMultipleRanges = hasMultipleRanges;
            builder.FullContentTruncated = fullContentTruncated;

            return builder.Build();
        }

        // =============================================================================
        // TextPattern Extraction (Primary Path)
        // =============================================================================

        /// <summary>
        /// Extract selection using TextPattern - equivalent to Swift's TextMarker path.
        /// Tries GetSelection first, then GetCaretRange for cursor-only.
        /// For large documents, uses WindowAroundSelection to avoid O(n) cost.
        /// </summary>
        private static TextExtractionResult? ExtractViaTextPattern(
            AutomationElement element,
            MetricsBuilder metricsBuilder)
        {
            if (!element.TryGetCurrentPattern(TextPattern.Pattern, out var tp))
                return null;

            var textPattern = (TextPattern)tp;
            TextPatternRange? selectionRange = null;
            bool hasMultipleRanges = false;

            try
            {
                // Try to get selection
                var selections = textPattern.GetSelection();
                if (selections != null && selections.Length > 0)
                {
                    selectionRange = selections[0];
                    hasMultipleRanges = selections.Length > 1;
                }
            }
            catch (COMException ex)
            {
                metricsBuilder.RecordError($"TextPattern.GetSelection failed: {ex.HResult}");
            }
            catch (InvalidOperationException ex)
            {
                metricsBuilder.RecordError($"TextPattern.GetSelection invalid: {ex.Message}");
            }

            // If no selection, try to get caret position (Win10+)
            if (selectionRange == null)
            {
                selectionRange = GetCaretRange(element);
            }

            if (selectionRange == null)
                return null;

            // PRE-CHECK: Probe document length first (spec compliance)
            var docLength = ProbeDocumentLength(textPattern);

            if (docLength <= Constants.MAX_FULL_CONTENT_LENGTH)
            {
                // SMALL DOC: Safe to compute absolute indices
                return ExtractFromSmallDocument(textPattern, selectionRange, hasMultipleRanges, metricsBuilder);
            }
            else
            {
                // LARGE DOC: Use windowed extraction to avoid O(n) cost
                return ExtractFromLargeDocument(textPattern, selectionRange, hasMultipleRanges, metricsBuilder);
            }
        }

        /// <summary>
        /// Probe document length using bounded GetText.
        /// Uses MAX*2+1 buffer to account for CRLF-heavy docs that shrink after normalization.
        /// Returns normalized length for accurate threshold comparison.
        /// </summary>
        private static int ProbeDocumentLength(TextPattern textPattern)
        {
            try
            {
                var docRange = textPattern.DocumentRange;
                // Use MAX*2+1 buffer to handle worst-case CRLF (every char could be \r\n → \n)
                // This ensures CRLF-heavy large docs aren't misclassified as small
                var probeLimit = Constants.MAX_FULL_CONTENT_LENGTH * 2 + 1;
                var probeText = docRange.GetText(probeLimit);
                if (probeText == null) return 0;

                // Normalize to get accurate length comparison
                var normalized = StringHelpers.NormalizeNewlines(probeText);
                return normalized?.Length ?? 0;
            }
            catch
            {
                // If probe fails, assume small doc (safer - will compute absolute indices)
                return 0;
            }
        }

        /// <summary>
        /// Extract from small document - compute absolute indices (safe for small docs).
        /// </summary>
        private static TextExtractionResult? ExtractFromSmallDocument(
            TextPattern textPattern,
            TextPatternRange selectionRange,
            bool hasMultipleRanges,
            MetricsBuilder metricsBuilder)
        {
            try
            {
                var docRange = textPattern.DocumentRange;

                // Get text before selection (normalize IMMEDIATELY)
                var beforeRange = docRange.Clone();
                beforeRange.MoveEndpointByRange(
                    TextPatternRangeEndpoint.End,
                    selectionRange,
                    TextPatternRangeEndpoint.Start);
                var rawBeforeText = beforeRange.GetText(-1);
                var beforeText = StringHelpers.NormalizeNewlines(rawBeforeText);
                var location = beforeText?.Length ?? 0;

                // Get selected text (normalize IMMEDIATELY)
                var rawSelectedText = selectionRange.GetText(-1);
                var selectedText = StringHelpers.NormalizeNewlines(rawSelectedText);
                var length = selectedText?.Length ?? 0;

                return new TextExtractionResult
                {
                    SelectedText = selectedText,
                    SelectionRange = new SelectionRange { Location = location, Length = length },
                    HasMultipleRanges = hasMultipleRanges,
                    IsLargeDoc = false
                };
            }
            catch (Exception ex)
            {
                metricsBuilder.RecordError($"TextPattern small doc extraction failed: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Extract from large document using WindowAroundSelection approach.
        /// Uses TextPatternRange manipulation to get context without reading from doc start.
        /// Returns windowed content with RELATIVE indices.
        /// </summary>
        private static TextExtractionResult? ExtractFromLargeDocument(
            TextPattern textPattern,
            TextPatternRange selectionRange,
            bool hasMultipleRanges,
            MetricsBuilder metricsBuilder)
        {
            try
            {
                // Get selected text with MAX+1 buffer, then truncate at surrogate boundary if needed
                // This prevents splitting a surrogate pair at exactly MAX characters
                var rawSelectedText = selectionRange.GetText(Constants.MAX_FULL_CONTENT_LENGTH + 1);
                var selectedText = StringHelpers.NormalizeNewlines(rawSelectedText);

                // Truncate at surrogate boundary if exceeds MAX
                if (selectedText != null && selectedText.Length > Constants.MAX_FULL_CONTENT_LENGTH)
                {
                    var truncateAt = StringHelpers.AdjustForSurrogatePairs(
                        selectedText,
                        Constants.MAX_FULL_CONTENT_LENGTH,
                        SurrogatePairDirection.Backward);
                    selectedText = selectedText.Substring(0, truncateAt);
                }
                var selectionLength = selectedText?.Length ?? 0;

                // Get BEFORE context by cloning and moving start backward
                string beforeContext = "";
                try
                {
                    var beforeRange = selectionRange.Clone();
                    // Move START endpoint backward by WINDOW_PADDING characters
                    var moved = beforeRange.MoveEndpointByUnit(
                        TextPatternRangeEndpoint.Start,
                        TextUnit.Character,
                        -Constants.WINDOW_PADDING);

                    if (moved != 0)
                    {
                        // Move END to selection START to get just the before text
                        beforeRange.MoveEndpointByRange(
                            TextPatternRangeEndpoint.End,
                            selectionRange,
                            TextPatternRangeEndpoint.Start);

                        var rawBefore = beforeRange.GetText(Constants.WINDOW_PADDING);
                        beforeContext = StringHelpers.NormalizeNewlines(rawBefore) ?? "";
                    }
                }
                catch
                {
                    // If before context fails, continue with empty
                }

                // Get AFTER context by cloning and moving end forward
                string afterContext = "";
                try
                {
                    var afterRange = selectionRange.Clone();
                    // Move END endpoint forward by WINDOW_PADDING characters
                    var moved = afterRange.MoveEndpointByUnit(
                        TextPatternRangeEndpoint.End,
                        TextUnit.Character,
                        Constants.WINDOW_PADDING);

                    if (moved != 0)
                    {
                        // Move START to selection END to get just the after text
                        afterRange.MoveEndpointByRange(
                            TextPatternRangeEndpoint.Start,
                            selectionRange,
                            TextPatternRangeEndpoint.End);

                        var rawAfter = afterRange.GetText(Constants.WINDOW_PADDING);
                        afterContext = StringHelpers.NormalizeNewlines(rawAfter) ?? "";
                    }
                }
                catch
                {
                    // If after context fails, continue with empty
                }

                // Combine windowed content
                var windowedContent = beforeContext + (selectedText ?? "") + afterContext;

                // Ensure windowed content doesn't exceed MAX
                if (windowedContent.Length > Constants.MAX_FULL_CONTENT_LENGTH)
                {
                    // Truncate symmetrically around selection
                    var availableForContext = Constants.MAX_FULL_CONTENT_LENGTH - selectionLength;
                    var contextPerSide = availableForContext / 2;

                    if (beforeContext.Length > contextPerSide)
                    {
                        var trimStart = beforeContext.Length - contextPerSide;
                        trimStart = StringHelpers.AdjustForSurrogatePairs(beforeContext, trimStart, SurrogatePairDirection.Forward);
                        beforeContext = beforeContext.Substring(trimStart);
                    }

                    if (afterContext.Length > contextPerSide)
                    {
                        var trimLength = StringHelpers.AdjustForSurrogatePairs(afterContext, contextPerSide, SurrogatePairDirection.Backward);
                        afterContext = afterContext.Substring(0, trimLength);
                    }

                    windowedContent = beforeContext + (selectedText ?? "") + afterContext;
                }

                // Location is RELATIVE to windowed content (= length of beforeContext)
                var relativeLocation = beforeContext.Length;

                return new TextExtractionResult
                {
                    SelectedText = selectedText,
                    SelectionRange = new SelectionRange { Location = relativeLocation, Length = selectionLength },
                    HasMultipleRanges = hasMultipleRanges,
                    FullContent = windowedContent,
                    FullContentTruncated = true,
                    IsLargeDoc = true
                };
            }
            catch (Exception ex)
            {
                metricsBuilder.RecordError($"TextPattern large doc extraction failed: {ex.Message}");
                return null;
            }
        }

        // =============================================================================
        // SelectedTextRange Extraction (Path B)
        // =============================================================================

        /// <summary>
        /// Extract selection via basic TextPattern.GetSelection() without full index calculation.
        /// Maps to Swift's extractViaSelectedTextRange.
        /// </summary>
        private static TextExtractionResult? ExtractViaSelectedTextRange(AutomationElement element)
        {
            if (!element.TryGetCurrentPattern(TextPattern.Pattern, out var tp))
                return null;

            var textPattern = (TextPattern)tp;

            try
            {
                var selections = textPattern.GetSelection();
                if (selections == null || selections.Length == 0)
                    return null;

                // IMPORTANT: If multiple ranges exist, return null so Path C handles it
                // This ensures hasMultipleRanges gets set correctly for multi-select scenarios
                // (Round 12 fix)
                if (selections.Length > 1)
                    return null;

                var selRange = selections[0];

                // Get selected text directly (normalize IMMEDIATELY)
                var rawSelectedText = selRange.GetText(-1);
                var selectedText = StringHelpers.NormalizeNewlines(rawSelectedText);
                var length = selectedText?.Length ?? 0;

                // Get location via endpoint comparison
                var docRange = textPattern.DocumentRange;
                var beforeRange = docRange.Clone();
                beforeRange.MoveEndpointByRange(
                    TextPatternRangeEndpoint.End,
                    selRange,
                    TextPatternRangeEndpoint.Start);
                var rawBeforeText = beforeRange.GetText(-1);
                var beforeText = StringHelpers.NormalizeNewlines(rawBeforeText);
                var location = beforeText?.Length ?? 0;

                return new TextExtractionResult
                {
                    SelectedText = selectedText,
                    SelectionRange = new SelectionRange { Location = location, Length = length },
                    HasMultipleRanges = false
                };
            }
            catch
            {
                return null;
            }
        }

        // =============================================================================
        // SelectedTextRanges Extraction (Path C - Multi-select)
        // =============================================================================

        /// <summary>
        /// Extract selection via TextPattern.GetSelection() handling multiple ranges.
        /// Maps to Swift's extractViaSelectedTextRanges.
        /// </summary>
        private static TextExtractionResult? ExtractViaSelectedTextRanges(AutomationElement element)
        {
            if (!element.TryGetCurrentPattern(TextPattern.Pattern, out var tp))
                return null;

            var textPattern = (TextPattern)tp;

            try
            {
                var selections = textPattern.GetSelection();
                if (selections == null || selections.Length == 0)
                    return null;

                var hasMultipleRanges = selections.Length > 1;

                // If only one range, this is same as selectedTextRange - should have been handled
                if (!hasMultipleRanges)
                    return null;

                // Sort ranges by position and use first (lowest)
                var docRange = textPattern.DocumentRange;
                TextPatternRange? primaryRange = null;
                int primaryPosition = int.MaxValue;

                foreach (var selRange in selections)
                {
                    try
                    {
                        var beforeRange = docRange.Clone();
                        beforeRange.MoveEndpointByRange(
                            TextPatternRangeEndpoint.End,
                            selRange,
                            TextPatternRangeEndpoint.Start);
                        // IMPORTANT: Normalize BEFORE computing position to keep indices aligned
                        var rawBeforeText = beforeRange.GetText(-1);
                        var beforeText = StringHelpers.NormalizeNewlines(rawBeforeText);
                        var position = beforeText?.Length ?? 0;

                        if (position < primaryPosition)
                        {
                            primaryPosition = position;
                            primaryRange = selRange;
                        }
                    }
                    catch
                    {
                        // Skip this range if we can't calculate position
                    }
                }

                if (primaryRange == null)
                    return null;

                // Extract from primary range
                var rawSelectedText = primaryRange.GetText(-1);
                var selectedText = StringHelpers.NormalizeNewlines(rawSelectedText);
                var length = selectedText?.Length ?? 0;

                return new TextExtractionResult
                {
                    SelectedText = selectedText,
                    SelectionRange = new SelectionRange { Location = primaryPosition, Length = length },
                    HasMultipleRanges = true
                };
            }
            catch
            {
                return null;
            }
        }

        // =============================================================================
        // Caret Range (Cursor-Only Position)
        // =============================================================================

        /// <summary>
        /// Get caret range when no selection exists (cursor-only position).
        /// Returns a TextPatternRange representing the cursor position (zero-length).
        /// </summary>
        private static TextPatternRange? GetCaretRange(AutomationElement element)
        {
            try
            {
                if (!element.TryGetCurrentPattern(TextPattern2.Pattern, out var pattern))
                    return null;

                var textPattern2 = (TextPattern2)pattern;
                var caretRange = textPattern2.GetCaretRange(out bool isActive);

                if (!isActive || caretRange == null)
                    return null;

                return caretRange;
            }
            catch
            {
                return null;
            }
        }

        // =============================================================================
        // App Focused Element (for containsFocus scoring)
        // =============================================================================

        /// <summary>
        /// Get the application-level focused element.
        /// Equivalent to Swift's getAppFocusedElement(forPid:).
        /// </summary>
        private static AutomationElement? GetAppFocusedElement()
        {
            try
            {
                return AutomationElement.FocusedElement;
            }
            catch
            {
                return null;
            }
        }

        // =============================================================================
        // Document Search
        // =============================================================================

        /// <summary>
        /// Find best Document element matching Swift's selectBestWebArea scoring.
        /// </summary>
        private static AutomationElement? FindDocumentElement(
            AutomationElement focusedElement,
            AutomationElement? appFocusedElement = null)
        {
            var focusedIsDocument = focusedElement.Current.ControlType == ControlType.Document;
            var candidates = new List<DocumentCandidate>();

            // 1. Collect from ancestors (only if focused is NOT already a Document)
            if (!focusedIsDocument)
            {
                var ancestorDocs = UIAutomationHelpers.FindDocumentsInAncestors(focusedElement);
                candidates.AddRange(ancestorDocs);
            }

            // 2. Collect from descendants (ALWAYS, even if focused is Document)
            var descendantDocs = UIAutomationHelpers.FindDocumentsInDescendants(focusedElement);
            candidates.AddRange(descendantDocs);

            // 3. Select best candidate using 4-tier scoring
            return SelectBestDocument(candidates, focusedElement, appFocusedElement);
        }

        /// <summary>
        /// Select best Document using Swift's 4-tier scoring.
        /// </summary>
        private static AutomationElement? SelectBestDocument(
            List<DocumentCandidate> candidates,
            AutomationElement focusedElement,
            AutomationElement? appFocusedElement)
        {
            if (candidates.Count == 0) return null;

            // Score each candidate
            var scored = candidates.Select(c =>
            {
                var hasTextPattern = UIAutomationHelpers.HasTextPatternSelection(c.Element);

                // Focus is "related" if either:
                // 1. Focus is inside the Document
                // 2. Document is inside focus
                bool containsFocus = false;
                if (appFocusedElement != null)
                {
                    containsFocus = UIAutomationHelpers.IsDescendantOrEqual(appFocusedElement, c.Element) ||
                                   UIAutomationHelpers.IsDescendantOrEqual(c.Element, appFocusedElement);
                }

                return new { Candidate = c, HasTextPattern = hasTextPattern, ContainsFocus = containsFocus };
            }).ToList();

            // Tier 1: TextPattern + contains focus (DEEPEST descendant wins)
            var tier1 = scored.Where(s => s.HasTextPattern && s.ContainsFocus).ToList();
            if (tier1.Count > 0)
            {
                var descendant = tier1.Where(s => !s.Candidate.IsAncestor)
                                     .OrderByDescending(s => s.Candidate.Depth)
                                     .FirstOrDefault();
                if (descendant != null) return descendant.Candidate.Element;

                var ancestor = tier1.Where(s => s.Candidate.IsAncestor)
                                   .OrderByDescending(s => s.Candidate.Depth)
                                   .FirstOrDefault();
                if (ancestor != null) return ancestor.Candidate.Element;
            }

            // Tier 2: TextPattern without focus
            var tier2 = scored.Where(s => s.HasTextPattern && !s.ContainsFocus).ToList();
            if (tier2.Count > 0)
            {
                var descendant = tier2.Where(s => !s.Candidate.IsAncestor)
                                     .OrderByDescending(s => s.Candidate.Depth)
                                     .FirstOrDefault();
                if (descendant != null) return descendant.Candidate.Element;

                var ancestor = tier2.Where(s => s.Candidate.IsAncestor)
                                   .OrderByDescending(s => s.Candidate.Depth)
                                   .FirstOrDefault();
                if (ancestor != null) return ancestor.Candidate.Element;
            }

            // Tier 3: Contains focus without TextPattern
            var tier3 = scored.Where(s => s.ContainsFocus && !s.HasTextPattern).ToList();
            if (tier3.Count > 0)
            {
                var descendant = tier3.Where(s => !s.Candidate.IsAncestor)
                                     .OrderByDescending(s => s.Candidate.Depth)
                                     .FirstOrDefault();
                if (descendant != null) return descendant.Candidate.Element;

                var ancestor = tier3.Where(s => s.Candidate.IsAncestor)
                                   .OrderByDescending(s => s.Candidate.Depth)
                                   .FirstOrDefault();
                if (ancestor != null) return ancestor.Candidate.Element;
            }

            // Tier 4: Deepest descendant, then nearest ancestor
            var descendantFallback = candidates.Where(c => !c.IsAncestor)
                                               .OrderByDescending(c => c.Depth)
                                               .FirstOrDefault();
            if (descendantFallback.Element != null) return descendantFallback.Element;

            var ancestorFallback = candidates.Where(c => c.IsAncestor)
                                             .OrderByDescending(c => c.Depth)
                                             .FirstOrDefault();
            return ancestorFallback.Element;
        }

        // =============================================================================
        // Full Content Retrieval
        // =============================================================================

        /// <summary>
        /// Get full content from element, trying ValuePattern then TextPattern.
        /// </summary>
        private static string? GetFullContent(AutomationElement element)
        {
            // Try AXValue first
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var vp))
            {
                try
                {
                    var value = ((ValuePattern)vp).Current.Value;
                    if (value != null)
                        return StringHelpers.NormalizeNewlines(value);
                }
                catch { }
            }

            // Try TextPattern DocumentRange
            if (element.TryGetCurrentPattern(TextPattern.Pattern, out var tp))
            {
                try
                {
                    var textPattern = (TextPattern)tp;
                    // Use unbounded GetText(-1) to handle CRLF-heavy docs correctly
                    var content = textPattern.DocumentRange.GetText(-1);
                    return StringHelpers.NormalizeNewlines(content);
                }
                catch { }
            }

            return null;
        }

        // =============================================================================
        // Selection Range Clamping
        // =============================================================================

        /// <summary>
        /// Clamp selection range to content bounds and re-derive selectedText.
        /// </summary>
        private static (SelectionRange? range, string? selectedText) ClampAndRederive(
            string? fullContent,
            SelectionRange? range)
        {
            if (fullContent == null || range == null)
                return (range, null);

            var contentLength = fullContent.Length;

            // Clamp location to content bounds
            var location = StringHelpers.Clamp((int)range.Location, 0, contentLength);

            // Clamp length so selection doesn't exceed content
            var maxLength = contentLength - location;
            var length = StringHelpers.Clamp((int)range.Length, 0, maxLength);

            // Re-derive selectedText from clamped range
            string? selectedText = null;
            if (length > 0)
            {
                selectedText = StringHelpers.SubstringUtf16(fullContent, location, length);
            }
            else if (length == 0 && location <= contentLength)
            {
                selectedText = "";  // Cursor-only position
            }

            return (new SelectionRange { Location = location, Length = length }, selectedText);
        }

        // =============================================================================
        // Content Windowing
        // =============================================================================

        /// <summary>
        /// Apply content windowing based on the spec algorithm.
        /// </summary>
        private static WindowResult WindowContent(
            string content,
            SelectionRange? selectionRange,
            MetricsBuilder metricsBuilder)
        {
            var totalLength = content.Length;

            // CASE A: No selection - head+tail truncation
            if (selectionRange == null)
            {
                var (truncated, _) = TruncateHeadTail(content);
                return new WindowResult
                {
                    WindowedContent = truncated,
                    AdjustedRange = null,
                    SelectedText = null,
                    Truncated = true
                };
            }

            var location = (int)selectionRange.Location;
            var length = (int)selectionRange.Length;

            // CASE B: Selection exceeds max - clamp to selection start
            if (length > Constants.MAX_FULL_CONTENT_LENGTH)
            {
                var windowStart = location;
                var windowEnd = Math.Min(location + Constants.MAX_FULL_CONTENT_LENGTH, totalLength);

                // Adjust for surrogate pairs
                windowStart = StringHelpers.AdjustForSurrogatePairs(content, windowStart, SurrogatePairDirection.Forward);
                windowEnd = StringHelpers.AdjustForSurrogatePairs(content, windowEnd, SurrogatePairDirection.Backward);

                var windowedContent = StringHelpers.SubstringUtf16(content, windowStart, windowEnd - windowStart) ?? "";
                var windowLength = windowedContent.Length;

                // Compute adjusted range
                var rawLocation = location - windowStart;
                var adjustedLocation = StringHelpers.Clamp(rawLocation, 0, windowLength);
                var maxPossibleLength = windowLength - adjustedLocation;
                var adjustedLength = StringHelpers.Clamp(length, 0, maxPossibleLength);

                var selectedText = StringHelpers.SubstringUtf16(windowedContent, adjustedLocation, adjustedLength);

                return new WindowResult
                {
                    WindowedContent = windowedContent,
                    AdjustedRange = new SelectionRange { Location = adjustedLocation, Length = adjustedLength },
                    SelectedText = selectedText,
                    Truncated = true
                };
            }

            // CASE C: Selection fits - window around selection
            var caseC_windowStart = Math.Max(0, location - Constants.WINDOW_PADDING);
            var caseC_windowEnd = Math.Min(totalLength, location + length + Constants.WINDOW_PADDING);

            // Shrink symmetrically if needed
            if (caseC_windowEnd - caseC_windowStart > Constants.MAX_FULL_CONTENT_LENGTH)
            {
                var selectionCenter = location + length / 2;
                caseC_windowStart = Math.Max(0, selectionCenter - Constants.MAX_FULL_CONTENT_LENGTH / 2);
                caseC_windowEnd = Math.Min(totalLength, caseC_windowStart + Constants.MAX_FULL_CONTENT_LENGTH);
                caseC_windowStart = Math.Max(0, caseC_windowEnd - Constants.MAX_FULL_CONTENT_LENGTH);
            }

            // Adjust for surrogate pairs
            caseC_windowStart = StringHelpers.AdjustForSurrogatePairs(content, caseC_windowStart, SurrogatePairDirection.Forward);
            caseC_windowEnd = StringHelpers.AdjustForSurrogatePairs(content, caseC_windowEnd, SurrogatePairDirection.Backward);

            var caseC_windowedContent = StringHelpers.SubstringUtf16(content, caseC_windowStart, caseC_windowEnd - caseC_windowStart) ?? "";
            var caseC_windowLength = caseC_windowedContent.Length;

            // Compute adjusted range
            var caseC_rawLocation = location - caseC_windowStart;
            var caseC_adjustedLocation = StringHelpers.Clamp(caseC_rawLocation, 0, caseC_windowLength);
            var caseC_maxPossibleLength = caseC_windowLength - caseC_adjustedLocation;
            var caseC_adjustedLength = StringHelpers.Clamp(length, 0, caseC_maxPossibleLength);

            var caseC_selectedText = StringHelpers.SubstringUtf16(caseC_windowedContent, caseC_adjustedLocation, caseC_adjustedLength);

            return new WindowResult
            {
                WindowedContent = caseC_windowedContent,
                AdjustedRange = new SelectionRange { Location = caseC_adjustedLocation, Length = caseC_adjustedLength },
                SelectedText = caseC_selectedText,
                Truncated = true
            };
        }

        /// <summary>
        /// Truncate large content using head+tail strategy when no selection is available.
        /// </summary>
        private static (string content, bool truncated) TruncateHeadTail(string? content)
        {
            if (content == null)
                return ("", false);

            var normalized = StringHelpers.NormalizeNewlines(content);
            if (normalized == null || normalized.Length <= Constants.MAX_FULL_CONTENT_LENGTH)
                return (normalized ?? "", false);

            // Head+tail truncation with delimiter (matching Swift)
            const string delimiter = "\n...\n";
            var delimiterLength = delimiter.Length;
            var availableSpace = Constants.MAX_FULL_CONTENT_LENGTH - delimiterLength;
            var headSize = availableSpace / 2;
            var tailSize = availableSpace - headSize;
            var tailStart = normalized.Length - tailSize;

            // Adjust for surrogate pairs
            headSize = StringHelpers.AdjustForSurrogatePairs(normalized, headSize, SurrogatePairDirection.Backward);
            tailStart = StringHelpers.AdjustForSurrogatePairs(normalized, tailStart, SurrogatePairDirection.Forward);

            var headContent = StringHelpers.SubstringUtf16(normalized, 0, headSize) ?? "";
            var tailContent = StringHelpers.SubstringUtf16(normalized, tailStart, normalized.Length - tailStart) ?? "";

            return (headContent + delimiter + tailContent, true);
        }

        // =============================================================================
        // Context Computation
        // =============================================================================

        /// <summary>
        /// Compute pre-selection context (up to MAX_CONTEXT_LENGTH chars before selection).
        /// </summary>
        private static string? ComputePreContext(string? fullContent, SelectionRange? range)
        {
            if (fullContent == null || range == null)
                return null;

            var location = (int)range.Location;
            var contentLength = fullContent.Length;

            if (location == 0)
                return "";

            var preStart = Math.Max(0, location - Constants.MAX_CONTEXT_LENGTH);
            var preLength = location - preStart;

            // Adjust for surrogate pairs - move START forward to not split pair
            preStart = StringHelpers.AdjustForSurrogatePairs(fullContent, preStart, SurrogatePairDirection.Forward);
            preLength = location - preStart;

            return StringHelpers.SubstringUtf16(fullContent, preStart, preLength);
        }

        /// <summary>
        /// Compute post-selection context (up to MAX_CONTEXT_LENGTH chars after selection).
        /// </summary>
        private static string? ComputePostContext(string? fullContent, SelectionRange? range)
        {
            if (fullContent == null || range == null)
                return null;

            var location = (int)range.Location;
            var length = (int)range.Length;
            var contentLength = fullContent.Length;

            var postStart = location + length;

            if (postStart >= contentLength)
                return "";

            var postLength = Math.Min(Constants.MAX_CONTEXT_LENGTH, contentLength - postStart);

            // Adjust for surrogate pairs - move END backward to not split pair
            var adjustedEnd = StringHelpers.AdjustForSurrogatePairs(
                fullContent, postStart + postLength, SurrogatePairDirection.Backward);
            postLength = adjustedEnd - postStart;

            return StringHelpers.SubstringUtf16(fullContent, postStart, postLength);
        }
    }
}
