import Foundation
import ApplicationServices

// =============================================================================
// SelectionExtractor - Multi-Path Text Selection Extraction
// =============================================================================
// Implements the Phase 1 extraction algorithm with TextMarker as primary path.
// This enables text selection extraction in Electron/Chromium apps where
// AXSelectedTextRange fails.
// =============================================================================

/// Result from TextMarker extraction attempt
struct TextMarkerResult {
    let selectedText: String?
    let selectionRange: SelectionRange?
    let hasMultipleRanges: Bool
}

/// Service for extracting text selection from focused elements
class SelectionExtractor {

    // MARK: - Main Extraction Entry Point

    /// Extract text selection from an element using multi-path algorithm
    /// - Parameters:
    ///   - element: The AXUIElement to extract from (focused element)
    ///   - metricsBuilder: Builder to record extraction metrics
    /// - Returns: AccessibilityTextSelection or nil if no text selection available
    static func extract(from element: AXUIElement, metricsBuilder: ExtractionMetricsBuilder) -> AccessibilityTextSelection? {
        let builder = TextSelectionBuilder()

        // Track both original focused element and the element we extract from
        let focusedElement = element
        var extractionElement = element

        // Step 2: Check if element is editable (check original focused element)
        let focusedIsEditable = AXHelpers.isElementEditable(focusedElement)

        // Step 2.1: SECURE FIELD CHECK - suppress all content if secure
        if AXHelpers.isSecureField(focusedElement) {
            return TextSelectionBuilder.secureField(isEditable: focusedIsEditable)
        }

        // Variables to track extraction state
        var selectionRange: AccessibilitySelectionRange? = nil
        var selectedText: String? = nil
        var fullContent: String? = nil
        var hasMultipleRanges = false
        var extractionMethod: ExtractionMethod = .none

        // Step 4: EXTRACTION (Priority Order)

        // Path A: TextMarker (PRIMARY - works in Electron)
        metricsBuilder.textMarkerAttempted = true
        if let textMarkerResult = extractViaTextMarker(element: focusedElement, metricsBuilder: metricsBuilder) {
            metricsBuilder.textMarkerSucceeded = true
            selectedText = textMarkerResult.selectedText
            selectionRange = textMarkerResult.selectionRange
            hasMultipleRanges = textMarkerResult.hasMultipleRanges
            extractionMethod = .textMarkerRange
        }

        // WebArea Retry Path: When TextMarker fails on focused element
        if extractionMethod == .none {
            // TextMarker failed - search for a better WebArea
            metricsBuilder.webAreaRetryAttempted = true

            if let webArea = findWebArea(from: focusedElement) {
                metricsBuilder.webAreaFound = true

                // Try TextMarker on WebArea
                if let webAreaTextMarkerResult = extractViaTextMarker(element: webArea, metricsBuilder: metricsBuilder) {
                    // TextMarker SUCCEEDED on WebArea - now switch extraction element
                    metricsBuilder.textMarkerSucceeded = true  // Mark overall TextMarker as succeeded
                    metricsBuilder.webAreaRetrySucceeded = true
                    extractionElement = webArea
                    selectedText = webAreaTextMarkerResult.selectedText
                    selectionRange = webAreaTextMarkerResult.selectionRange
                    hasMultipleRanges = webAreaTextMarkerResult.hasMultipleRanges
                    extractionMethod = .textMarkerRange
                }
                // If TextMarker fails on WebArea, DON'T switch extractionElement
                // Keep using focusedElement for fallbacks (it has the content, even if noisy)
            }
        }

        // Descendant Text Element Path: When both TextMarker attempts fail
        // Try to find the actual text element inside the container (e.g., in Notion)
        if extractionMethod == .none {
            if let deepTextElement = AXHelpers.findDeepestTextElement(from: focusedElement) {
                // Found a deeper text element - try extraction on it
                if let textMarkerResult = extractViaTextMarker(element: deepTextElement, metricsBuilder: metricsBuilder) {
                    metricsBuilder.textMarkerSucceeded = true  // Mark TextMarker as succeeded
                    extractionElement = deepTextElement
                    selectedText = textMarkerResult.selectedText
                    selectionRange = textMarkerResult.selectionRange
                    hasMultipleRanges = textMarkerResult.hasMultipleRanges
                    extractionMethod = .textMarkerRange
                } else if let rangeResult = extractViaSelectedTextRange(element: deepTextElement) {
                    // TextMarker failed but SelectedTextRange works - use this element
                    // This should give us cleaner content without UI labels
                    extractionElement = deepTextElement
                    selectedText = rangeResult.selectedText
                    selectionRange = rangeResult.selectionRange
                    extractionMethod = .selectedTextRange
                }
            }
        }

        // Path B: SelectedTextRange (Fallback 1) - use extractionElement
        if extractionMethod == .none {
            metricsBuilder.recordFallback(.selectedTextRange)
            if let result = extractViaSelectedTextRange(element: extractionElement) {
                selectedText = result.selectedText
                selectionRange = result.selectionRange
                extractionMethod = .selectedTextRange
            }
        }

        // Path C: SelectedTextRanges (Fallback 2 - Multi-select) - use extractionElement
        if extractionMethod == .none {
            metricsBuilder.recordFallback(.selectedTextRanges)
            if let result = extractViaSelectedTextRanges(element: extractionElement) {
                selectedText = result.selectedText
                selectionRange = result.selectionRange
                hasMultipleRanges = result.hasMultipleRanges
                extractionMethod = .selectedTextRanges
            }
        }

        // Path D: Value Attribute (Fallback 3) - use extractionElement
        if extractionMethod == .none {
            metricsBuilder.recordFallback(.valueAttribute)
            if let value = AXHelpers.getStringAttribute(extractionElement, kAXValueAttribute) {
                fullContent = value
                extractionMethod = .valueAttribute
                // Note: No selectionRange available from this path
            }
        }

        // Path E: StringForRange (Fallback 4) - use extractionElement
        if extractionMethod == .none {
            metricsBuilder.recordFallback(.stringForRange)
            if let charCount = AXHelpers.getNumberOfCharacters(extractionElement) {
                if charCount == 0 {
                    fullContent = ""
                    extractionMethod = .stringForRange
                } else if charCount > 0 {
                    let range = CFRange(location: 0, length: charCount)
                    if let content = AXHelpers.getStringForRange(extractionElement, range: range) {
                        fullContent = content
                        extractionMethod = .stringForRange
                    }
                }
            }
        }

        // If no extraction succeeded at all, return nil
        if extractionMethod == .none {
            return nil
        }

        // Step 5: FULL CONTENT RETRIEVAL (if not already obtained) - use extractionElement
        if fullContent == nil && selectionRange != nil {
            // Try AXValue first
            fullContent = AXHelpers.getStringAttribute(extractionElement, kAXValueAttribute)

            // If fails, try AXStringForRange
            if fullContent == nil, let charCount = AXHelpers.getNumberOfCharacters(extractionElement), charCount > 0 {
                let range = CFRange(location: 0, length: charCount)
                fullContent = AXHelpers.getStringForRange(extractionElement, range: range)
            }
        }

        // Step 3: PLACEHOLDER CHECK (non-blocking)
        // Use TextMarker-derived length if available, fall back to AXSelectedTextRange
        var selectionLength: Int? = selectionRange?.length
        if selectionLength == nil {
            if let cfRange = AXHelpers.getSelectedTextRange(extractionElement) {
                selectionLength = cfRange.length
            }
        }
        // OR logic: check placeholder on BOTH elements
        let focusedIsPlaceholder = AXHelpers.isPlaceholderShowing(focusedElement, selectionLength: nil)
        let extractionIsPlaceholder = AXHelpers.isPlaceholderShowing(extractionElement, selectionLength: selectionLength)
        builder.isPlaceholder = focusedIsPlaceholder || extractionIsPlaceholder

        // OR logic for isEditable: editable if EITHER element is editable
        let extractionIsEditable = AXHelpers.isElementEditable(extractionElement)
        builder.isEditable = focusedIsEditable || extractionIsEditable

        // Step 5.1: SELECTION RANGE VALIDATION
        if var range = selectionRange, let content = fullContent {
            let contentLength = content.utf16.count
            let originalLocation = range.location
            let originalLength = range.length

            // Clamp to valid bounds
            let clampedLocation = AXHelpers.clamp(originalLocation, min: 0, max: contentLength)
            let maxLength = contentLength - clampedLocation
            let clampedLength = AXHelpers.clamp(originalLength, min: 0, max: maxLength)

            // Log if clamping occurred (no PII)
            if originalLocation != clampedLocation || originalLength != clampedLength {
                metricsBuilder.recordError("SelectionRange clamped: original exceeded content bounds")
            }

            selectionRange = SelectionRange(length: clampedLength, location: clampedLocation)

            // Step 5.2: RE-DERIVE selectedText when no windowing needed
            if contentLength <= MAX_FULL_CONTENT_LENGTH {
                if clampedLength == 0 {
                    selectedText = ""
                } else {
                    selectedText = AXHelpers.substringUTF16(content, start: clampedLocation, length: clampedLength)
                }
            }
        }

        // Step 6: CONTENT WINDOWING
        var fullContentTruncated = false
        if var content = fullContent, content.utf16.count > MAX_FULL_CONTENT_LENGTH {
            let result = windowContent(
                content: content,
                selectionRange: selectionRange,
                metricsBuilder: metricsBuilder
            )
            fullContent = result.windowedContent
            selectionRange = result.adjustedRange
            selectedText = result.selectedText
            fullContentTruncated = true
        }

        // Step 7: CONTEXT COMPUTATION
        var preSelectionText: String? = nil
        var postSelectionText: String? = nil

        if let range = selectionRange, let content = fullContent {
            let location = range.location
            let length = range.length
            let contentLength = content.utf16.count

            // Pre-selection text
            if location == 0 {
                preSelectionText = ""
            } else {
                let preStart = max(0, location - MAX_CONTEXT_LENGTH)
                let preLength = location - preStart
                preSelectionText = AXHelpers.substringUTF16(content, start: preStart, length: preLength)
            }

            // Post-selection text
            let postStart = location + length
            if postStart >= contentLength {
                postSelectionText = ""
            } else {
                let postLength = min(MAX_CONTEXT_LENGTH, contentLength - postStart)
                postSelectionText = AXHelpers.substringUTF16(content, start: postStart, length: postLength)
            }
        } else if let range = selectionRange, fullContent == nil {
            // Per spec: when selectionRange exists but fullContent is nil,
            // compute pre/post via AXStringForRange
            let location = range.location
            let length = range.length

            // Pre-selection text via AXStringForRange
            if location == 0 {
                preSelectionText = ""
            } else {
                let preStart = max(0, location - MAX_CONTEXT_LENGTH)
                let preLength = location - preStart
                let preRange = CFRange(location: preStart, length: preLength)
                preSelectionText = AXHelpers.getStringForRange(extractionElement, range: preRange)
            }

            // Post-selection text via AXStringForRange
            let postStart = location + length
            // We don't know total length, so just try to get MAX_CONTEXT_LENGTH
            let postRange = CFRange(location: postStart, length: MAX_CONTEXT_LENGTH)
            postSelectionText = AXHelpers.getStringForRange(extractionElement, range: postRange)
        }

        // Build final result
        builder.selectedText = selectedText
        builder.fullContent = fullContent
        builder.preSelectionText = preSelectionText
        builder.postSelectionText = postSelectionText
        builder.selectionRange = selectionRange
        builder.extractionMethod = extractionMethod
        builder.hasMultipleRanges = hasMultipleRanges
        builder.fullContentTruncated = fullContentTruncated

        return builder.build()
    }

    // MARK: - Path A: TextMarker Extraction

    /// Extract selection using TextMarker APIs (works in Electron/Chromium)
    /// Tries single range (AXSelectedTextMarkerRange) first, then multi-range (AXSelectedTextMarkerRanges)
    private static func extractViaTextMarker(element: AXUIElement, metricsBuilder: ExtractionMetricsBuilder) -> TextMarkerResult? {
        // Try single range first
        if let result = extractViaSingleTextMarkerRange(element: element, metricsBuilder: metricsBuilder) {
            return result
        }

        // If single range failed, try multi-range (use first range)
        return extractViaMultiTextMarkerRanges(element: element, metricsBuilder: metricsBuilder)
    }

    /// Extract selection using single AXSelectedTextMarkerRange
    private static func extractViaSingleTextMarkerRange(element: AXUIElement, metricsBuilder: ExtractionMetricsBuilder) -> TextMarkerResult? {
        // 1. Get TextMarker range
        var markerRangeRef: CFTypeRef?
        let rangeError = AXUIElementCopyAttributeValue(
            element,
            "AXSelectedTextMarkerRange" as CFString,
            &markerRangeRef
        )

        guard rangeError == .success, let markerRange = markerRangeRef else {
            metricsBuilder.recordError("TextMarker: AXSelectedTextMarkerRange failed, AXError=\(rangeError.rawValue)")
            return nil
        }

        // Extract from the marker range
        return extractFromMarkerRange(markerRange, element: element, metricsBuilder: metricsBuilder, hasMultipleRanges: false)
    }

    /// Extract selection using AXSelectedTextMarkerRanges (multi-cursor), using the first range
    private static func extractViaMultiTextMarkerRanges(element: AXUIElement, metricsBuilder: ExtractionMetricsBuilder) -> TextMarkerResult? {
        // 1. Get TextMarker ranges array
        var markerRangesRef: CFTypeRef?
        let rangesError = AXUIElementCopyAttributeValue(
            element,
            "AXSelectedTextMarkerRanges" as CFString,
            &markerRangesRef
        )

        guard rangesError == .success, let rangesArray = markerRangesRef as? [AnyObject], !rangesArray.isEmpty else {
            metricsBuilder.recordError("TextMarker: AXSelectedTextMarkerRanges failed or empty, AXError=\(rangesError.rawValue)")
            return nil
        }

        // Use the first range
        let firstRange = rangesArray[0]
        let hasMultipleRanges = rangesArray.count > 1

        // Extract from the first marker range
        return extractFromMarkerRange(firstRange as CFTypeRef, element: element, metricsBuilder: metricsBuilder, hasMultipleRanges: hasMultipleRanges)
    }

    /// Extract text and indices from a TextMarker range
    private static func extractFromMarkerRange(_ markerRange: CFTypeRef, element: AXUIElement, metricsBuilder: ExtractionMetricsBuilder, hasMultipleRanges: Bool) -> TextMarkerResult? {
        // 2. Get start marker
        var startMarkerRef: CFTypeRef?
        let startError = AXUIElementCopyParameterizedAttributeValue(
            element,
            "AXStartTextMarkerForTextMarkerRange" as CFString,
            markerRange,
            &startMarkerRef
        )

        guard startError == .success, let startMarker = startMarkerRef else {
            metricsBuilder.recordError("TextMarker: AXStartTextMarkerForTextMarkerRange failed, AXError=\(startError.rawValue)")
            return nil
        }

        // 3. Get end marker
        var endMarkerRef: CFTypeRef?
        let endError = AXUIElementCopyParameterizedAttributeValue(
            element,
            "AXEndTextMarkerForTextMarkerRange" as CFString,
            markerRange,
            &endMarkerRef
        )

        guard endError == .success, let endMarker = endMarkerRef else {
            metricsBuilder.recordError("TextMarker: AXEndTextMarkerForTextMarkerRange failed, AXError=\(endError.rawValue)")
            return nil
        }

        // 4. Convert markers to indices
        var startIndexRef: CFTypeRef?
        let startIndexError = AXUIElementCopyParameterizedAttributeValue(
            element,
            "AXIndexForTextMarker" as CFString,
            startMarker,
            &startIndexRef
        )

        guard startIndexError == .success,
              let startIndexNumber = startIndexRef as? NSNumber else {
            metricsBuilder.recordError("TextMarker: AXIndexForTextMarker (start) failed, AXError=\(startIndexError.rawValue)")
            return nil
        }

        var endIndexRef: CFTypeRef?
        let endIndexError = AXUIElementCopyParameterizedAttributeValue(
            element,
            "AXIndexForTextMarker" as CFString,
            endMarker,
            &endIndexRef
        )

        guard endIndexError == .success,
              let endIndexNumber = endIndexRef as? NSNumber else {
            metricsBuilder.recordError("TextMarker: AXIndexForTextMarker (end) failed, AXError=\(endIndexError.rawValue)")
            return nil
        }

        let startIndex = startIndexNumber.intValue
        let endIndex = endIndexNumber.intValue

        // Validate indices per spec: negative or end < start should fail
        if startIndex < 0 || endIndex < 0 {
            metricsBuilder.recordError("TextMarker: Invalid indices - negative values (start=\(startIndex), end=\(endIndex))")
            return nil
        }
        if endIndex < startIndex {
            metricsBuilder.recordError("TextMarker: Invalid indices - end < start (start=\(startIndex), end=\(endIndex))")
            return nil
        }

        let length = endIndex - startIndex

        // 5. Get text for marker range
        var attributedStringRef: CFTypeRef?
        let stringError = AXUIElementCopyParameterizedAttributeValue(
            element,
            "AXAttributedStringForTextMarkerRange" as CFString,
            markerRange,
            &attributedStringRef
        )

        var selectedText: String? = nil
        if stringError == .success, let attrString = attributedStringRef as? NSAttributedString {
            selectedText = attrString.string
        } else if stringError == .success, let plainString = attributedStringRef as? String {
            selectedText = plainString
        } else if length == 0 {
            // Cursor only - no selection, this is fine
            selectedText = ""
        } else {
            metricsBuilder.recordError("TextMarker: AXAttributedStringForTextMarkerRange failed, AXError=\(stringError.rawValue)")
        }

        let selectionRange = SelectionRange(length: length, location: startIndex)

        return TextMarkerResult(
            selectedText: selectedText,
            selectionRange: selectionRange,
            hasMultipleRanges: hasMultipleRanges
        )
    }

    // MARK: - Path B: SelectedTextRange Extraction

    /// Extract selection using standard AXSelectedTextRange
    /// Uses AXStringForRange for text extraction (more reliable for Chromium/Electron per spec)
    private static func extractViaSelectedTextRange(element: AXUIElement) -> TextMarkerResult? {
        guard let cfRange = AXHelpers.getSelectedTextRange(element) else {
            return nil
        }

        let location = cfRange.location
        let length = cfRange.length

        // Get selected text using AXStringForRange (more reliable for Chromium/Electron)
        var selectedText: String? = nil
        if length == 0 {
            selectedText = ""
        } else {
            // Try AXStringForRange first (per spec - more reliable)
            selectedText = AXHelpers.getStringForRange(element, range: cfRange)
            // Fall back to AXSelectedText if needed
            if selectedText == nil {
                selectedText = AXHelpers.getStringAttribute(element, kAXSelectedTextAttribute)
            }
        }

        return TextMarkerResult(
            selectedText: selectedText,
            selectionRange: SelectionRange(length: length, location: location),
            hasMultipleRanges: false
        )
    }

    // MARK: - Path C: SelectedTextRanges Extraction

    /// Extract selection using AXSelectedTextRanges (multi-select)
    private static func extractViaSelectedTextRanges(element: AXUIElement) -> TextMarkerResult? {
        var rangesRef: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(
            element,
            "AXSelectedTextRanges" as CFString,
            &rangesRef
        )

        guard error == .success, let ranges = rangesRef as? [AXValue], !ranges.isEmpty else {
            return nil
        }

        // Convert ranges and sort by location
        var cfRanges: [CFRange] = []
        for rangeValue in ranges {
            var range = CFRange()
            if AXValueGetValue(rangeValue, .cfRange, &range) {
                cfRanges.append(range)
            }
        }

        guard !cfRanges.isEmpty else { return nil }

        // Sort by location (ascending)
        cfRanges.sort { $0.location < $1.location }

        // Use first (lowest location) as primary
        let primaryRange = cfRanges[0]
        let hasMultipleRanges = cfRanges.count > 1

        // Get selected text for primary range
        var selectedText: String? = nil
        if primaryRange.length == 0 {
            selectedText = ""
        } else {
            selectedText = AXHelpers.getStringForRange(element, range: primaryRange)
        }

        return TextMarkerResult(
            selectedText: selectedText,
            selectionRange: SelectionRange(length: primaryRange.length, location: primaryRange.location),
            hasMultipleRanges: hasMultipleRanges
        )
    }

    // MARK: - WebArea Search

    /// Candidate structure for WebArea selection
    private struct WebAreaCandidate {
        let element: AXUIElement
        let depth: Int          // positive = descendant, negative = ancestor
        let isAncestor: Bool
    }

    /// Find best AXWebArea from descendants (and optionally ancestors)
    /// - Parameter focusedElement: The currently focused element
    /// - Returns: Best AXWebArea element to use for extraction, or nil if none found
    private static func findWebArea(from focusedElement: AXUIElement) -> AXUIElement? {
        let focusedIsWebArea = AXHelpers.getRole(focusedElement) == "AXWebArea"

        var candidates: [WebAreaCandidate] = []

        // 1. Collect from ancestors (only if focused is NOT already a WebArea)
        if !focusedIsWebArea {
            let ancestorWebAreas = AXHelpers.findWebAreasInAncestors(
                element: focusedElement,
                excludeElement: focusedElement,
                maxLevels: WEB_AREA_ANCESTOR_SEARCH_DEPTH
            )
            for (webArea, depth) in ancestorWebAreas {
                candidates.append(WebAreaCandidate(element: webArea, depth: depth, isAncestor: true))
            }
        }

        // 2. Collect from descendants (ALWAYS, even if focused is WebArea)
        let children = AXHelpers.getChildren(focusedElement)
        if children.count > 0 {
            let descendantWebAreas = AXHelpers.findWebAreasInDescendants(
                element: focusedElement,
                excludeElement: focusedElement,
                maxDepth: FIND_WEB_AREAS_MAX_DEPTH,
                maxElements: FIND_WEB_AREAS_MAX_ELEMENTS
            )
            for (webArea, depth) in descendantWebAreas {
                candidates.append(WebAreaCandidate(element: webArea, depth: depth, isAncestor: false))
            }
        }

        // 3. Select best candidate based on preference order
        return selectBestWebArea(from: candidates, focusedElement: focusedElement)
    }

    /// Select best WebArea from candidates
    /// Preference order (DEEPEST descendant wins at ALL levels):
    ///   1. Marker range present + contains focus
    ///   2. Marker range present (focus unavailable)
    ///   3. Contains focus without marker range
    ///   4. DEEPEST descendant, then nearest ancestor
    private static func selectBestWebArea(
        from candidates: [WebAreaCandidate],
        focusedElement: AXUIElement
    ) -> AXUIElement? {
        guard !candidates.isEmpty else { return nil }

        // Get app-level focused element for containment validation
        let pid = AXHelpers.getPid(focusedElement)
        let appFocusedElement = AXHelpers.getAppFocusedElement(forPid: pid)

        // Score each candidate
        struct ScoredCandidate {
            let candidate: WebAreaCandidate
            let hasMarkerRange: Bool
            let containsFocus: Bool
        }

        let scored = candidates.map { c -> ScoredCandidate in
            // Focus is "related" if EITHER:
            // 1. Focus is inside the WebArea (focus is descendant/equal of WebArea)
            // 2. WebArea is inside focus (WebArea is descendant/equal of focused container)
            let containsFocus: Bool
            if let focused = appFocusedElement {
                containsFocus = AXHelpers.isDescendantOrEqual(focused, of: c.element) ||
                               AXHelpers.isDescendantOrEqual(c.element, of: focused)
            } else {
                containsFocus = false
            }
            return ScoredCandidate(
                candidate: c,
                hasMarkerRange: AXHelpers.hasTextMarkerRange(c.element),
                containsFocus: containsFocus
            )
        }

        // 1. BEST: Has marker range AND contains focus (DEEPEST descendant wins)
        let withMarkerAndFocus = scored.filter { $0.hasMarkerRange && $0.containsFocus }
        if !withMarkerAndFocus.isEmpty {
            // Prefer deepest descendant
            if let descendant = withMarkerAndFocus
                .filter({ !$0.candidate.isAncestor })
                .max(by: { $0.candidate.depth < $1.candidate.depth }) {
                return descendant.candidate.element
            }
            // Otherwise nearest ancestor
            if let ancestor = withMarkerAndFocus
                .filter({ $0.candidate.isAncestor })
                .max(by: { $0.candidate.depth < $1.candidate.depth }) {
                return ancestor.candidate.element
            }
        }

        // 2. Has marker range (without focus - focus detection may be unavailable)
        let withMarker = scored.filter { $0.hasMarkerRange && !$0.containsFocus }
        if !withMarker.isEmpty {
            // Deepest descendant first
            if let descendant = withMarker
                .filter({ !$0.candidate.isAncestor })
                .max(by: { $0.candidate.depth < $1.candidate.depth }) {
                return descendant.candidate.element
            }
            // Then nearest ancestor
            if let ancestor = withMarker
                .filter({ $0.candidate.isAncestor })
                .max(by: { $0.candidate.depth < $1.candidate.depth }) {
                return ancestor.candidate.element
            }
        }

        // 3. Contains focus but no marker range
        let withFocus = scored.filter { $0.containsFocus && !$0.hasMarkerRange }
        if !withFocus.isEmpty {
            // Prefer deepest descendant
            if let descendant = withFocus
                .filter({ !$0.candidate.isAncestor })
                .max(by: { $0.candidate.depth < $1.candidate.depth }) {
                return descendant.candidate.element
            }
            if let ancestor = withFocus
                .filter({ $0.candidate.isAncestor })
                .max(by: { $0.candidate.depth < $1.candidate.depth }) {
                return ancestor.candidate.element
            }
        }

        // 4. Fallback: deepest descendant first, then nearest ancestor
        let descendants = candidates.filter { !$0.isAncestor }
        if let deepest = descendants.max(by: { $0.depth < $1.depth }) {
            return deepest.element
        }
        let ancestors = candidates.filter { $0.isAncestor }
        if let nearest = ancestors.max(by: { $0.depth < $1.depth }) {
            return nearest.element
        }

        return nil
    }

    // MARK: - Content Windowing

    /// Result of content windowing operation
    struct WindowResult {
        let windowedContent: String
        let adjustedRange: SelectionRange?
        let selectedText: String?
    }

    /// Apply content windowing based on the spec algorithm
    private static func windowContent(
        content: String,
        selectionRange: SelectionRange?,
        metricsBuilder: ExtractionMetricsBuilder
    ) -> WindowResult {
        let utf16 = content.utf16
        let totalLength = utf16.count

        // CASE A: No selection - head+tail truncation
        guard let range = selectionRange else {
            let delimiter = "\n...\n"
            let delimiterLength = delimiter.utf16.count
            let availableSpace = MAX_FULL_CONTENT_LENGTH - delimiterLength

            var headSize = availableSpace / 2
            var tailSize = availableSpace - headSize

            // Adjust for surrogate pairs
            headSize = AXHelpers.adjustForSurrogatePairs(content, offset: headSize, direction: .backward)
            let tailStart = AXHelpers.adjustForSurrogatePairs(content, offset: totalLength - tailSize, direction: .forward)
            tailSize = totalLength - tailStart

            let headContent = AXHelpers.substringUTF16(content, start: 0, length: headSize) ?? ""
            let tailContent = AXHelpers.substringUTF16(content, start: tailStart, length: tailSize) ?? ""

            return WindowResult(
                windowedContent: headContent + delimiter + tailContent,
                adjustedRange: nil,
                selectedText: nil
            )
        }

        let location = range.location
        let length = range.length

        // CASE B: Selection exceeds max - clamp to selection start
        if length > MAX_FULL_CONTENT_LENGTH {
            var windowStart = location
            var windowEnd = min(location + MAX_FULL_CONTENT_LENGTH, totalLength)

            // Adjust for surrogate pairs FIRST
            windowStart = AXHelpers.adjustForSurrogatePairs(content, offset: windowStart, direction: .forward)
            windowEnd = AXHelpers.adjustForSurrogatePairs(content, offset: windowEnd, direction: .backward)

            let windowedContent = AXHelpers.substringUTF16(content, start: windowStart, length: windowEnd - windowStart) ?? ""
            let windowLength = windowedContent.utf16.count

            // Compute adjusted range (clamp location FIRST)
            let rawLocation = location - windowStart
            let adjustedLocation = AXHelpers.clamp(rawLocation, min: 0, max: windowLength)
            let maxPossibleLength = windowLength - adjustedLocation
            let adjustedLength = AXHelpers.clamp(length, min: 0, max: maxPossibleLength)

            let selectedText = AXHelpers.substringUTF16(windowedContent, start: adjustedLocation, length: adjustedLength)

            return WindowResult(
                windowedContent: windowedContent,
                adjustedRange: SelectionRange(length: adjustedLength, location: adjustedLocation),
                selectedText: selectedText
            )
        }

        // CASE C: Selection fits - window around selection
        var windowStart = max(0, location - WINDOW_PADDING)
        var windowEnd = min(totalLength, location + length + WINDOW_PADDING)

        // Shrink symmetrically if needed
        if windowEnd - windowStart > MAX_FULL_CONTENT_LENGTH {
            let selectionCenter = location + length / 2
            windowStart = max(0, selectionCenter - MAX_FULL_CONTENT_LENGTH / 2)
            windowEnd = min(totalLength, windowStart + MAX_FULL_CONTENT_LENGTH)
            windowStart = max(0, windowEnd - MAX_FULL_CONTENT_LENGTH)
        }

        // Adjust for surrogate pairs FIRST
        windowStart = AXHelpers.adjustForSurrogatePairs(content, offset: windowStart, direction: .forward)
        windowEnd = AXHelpers.adjustForSurrogatePairs(content, offset: windowEnd, direction: .backward)

        let windowedContent = AXHelpers.substringUTF16(content, start: windowStart, length: windowEnd - windowStart) ?? ""
        let windowLength = windowedContent.utf16.count

        // Compute adjusted range (clamp location FIRST)
        let rawLocation = location - windowStart
        let adjustedLocation = AXHelpers.clamp(rawLocation, min: 0, max: windowLength)
        let maxPossibleLength = windowLength - adjustedLocation
        let adjustedLength = AXHelpers.clamp(length, min: 0, max: maxPossibleLength)

        let selectedText = AXHelpers.substringUTF16(windowedContent, start: adjustedLocation, length: adjustedLength)

        return WindowResult(
            windowedContent: windowedContent,
            adjustedRange: SelectionRange(length: adjustedLength, location: adjustedLocation),
            selectedText: selectedText
        )
    }
}
