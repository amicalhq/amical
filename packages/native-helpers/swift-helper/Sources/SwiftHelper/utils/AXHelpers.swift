import Foundation
import ApplicationServices
import AppKit

// =============================================================================
// AXHelpers - Common Accessibility API Utilities
// =============================================================================
// Shared utilities for working with macOS Accessibility APIs.
// Extracted from AccessibilityContextService for reuse in v2 implementation.
// =============================================================================

// Note: Constants are defined in utils/Constants.swift

// MARK: - Surrogate Pair Direction

/// Direction for surrogate pair boundary adjustment
enum SurrogatePairDirection {
    case forward  // For windowStart: move into content to include complete character
    case backward // For windowEnd: move out of content to exclude incomplete character
}

// MARK: - AXHelpers

/// Utilities for working with macOS Accessibility APIs
enum AXHelpers {

    // MARK: - Attribute Access

    /// Get a string attribute value from an AXUIElement
    static func getStringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

        guard error == .success else { return nil }

        if let stringValue = value as? String {
            return stringValue
        } else if let numberValue = value as? NSNumber {
            return numberValue.stringValue
        } else if let boolValue = value as? Bool {
            return boolValue ? "true" : "false"
        }
        return nil
    }

    /// Get a boolean attribute value from an AXUIElement
    static func getBoolAttribute(_ element: AXUIElement, _ attribute: String) -> Bool? {
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

        guard error == .success else { return nil }

        if let boolValue = value as? Bool {
            return boolValue
        } else if let numberValue = value as? NSNumber {
            return numberValue.boolValue
        }
        return nil
    }

    /// Get an integer attribute value from an AXUIElement
    static func getIntAttribute(_ element: AXUIElement, _ attribute: String) -> Int? {
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

        guard error == .success else { return nil }

        if let numberValue = value as? NSNumber {
            return numberValue.intValue
        }
        return nil
    }

    /// Get all attribute names for an AXUIElement
    static func getAttributeNames(_ element: AXUIElement) -> [String] {
        var attributeNames: CFArray?
        let error = AXUIElementCopyAttributeNames(element, &attributeNames)

        if error == .success, let names = attributeNames as? [String] {
            return names
        }
        return []
    }

    /// Check if an element has a specific attribute
    static func hasAttribute(_ element: AXUIElement, _ attribute: String) -> Bool {
        return getAttributeNames(element).contains(attribute)
    }

    /// Get a raw CFTypeRef attribute value
    static func getRawAttribute(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        return error == .success ? value : nil
    }

    /// Get a parameterized attribute value
    static func getParameterizedAttribute(_ element: AXUIElement, _ attribute: String, parameter: CFTypeRef) -> CFTypeRef? {
        var value: CFTypeRef?
        let error = AXUIElementCopyParameterizedAttributeValue(element, attribute as CFString, parameter, &value)
        return error == .success ? value : nil
    }

    // MARK: - Element Type Detection

    /// Roles that are typically editable text fields
    static let editableRoles: Set<String> = [
        "AXTextField",
        "AXTextArea",
        "AXComboBox"
    ]

    /// Subroles that indicate editable text fields
    static let editableSubroles: Set<String> = [
        "AXSecureTextField",
        "AXSearchField"
    ]

    /// Check if an element is editable
    static func isElementEditable(_ element: AXUIElement) -> Bool {
        let role = getStringAttribute(element, kAXRoleAttribute)
        let subrole = getStringAttribute(element, kAXSubroleAttribute)

        // Check for editable roles
        if let role = role, editableRoles.contains(role) {
            return true
        }

        // Check for editable subroles
        if let subrole = subrole, editableSubroles.contains(subrole) {
            return true
        }

        // Check if element has AXValue attribute (often indicates editability)
        return hasAttribute(element, kAXValueAttribute)
    }

    /// Check if an element is a secure/password field
    /// Per spec: check subrole == "AXSecureTextField" OR role contains "Secure"
    static func isSecureField(_ element: AXUIElement) -> Bool {
        // Check subrole first (most common case)
        let subrole = getStringAttribute(element, kAXSubroleAttribute)
        if subrole == "AXSecureTextField" {
            return true
        }

        // Also check if role contains "Secure" (per spec)
        if let role = getStringAttribute(element, kAXRoleAttribute) {
            if role.contains("Secure") {
                return true
            }
        }

        return false
    }

    /// Check if an element is showing placeholder text
    static func isPlaceholderShowing(_ element: AXUIElement, selectionLength: Int?) -> Bool {
        let placeholderValue = getStringAttribute(element, "AXPlaceholderValue")
        let currentValue = getStringAttribute(element, kAXValueAttribute)

        guard let placeholder = placeholderValue, !placeholder.isEmpty else {
            return false
        }

        // Placeholder is showing if:
        // 1. Placeholder exists AND is non-empty
        // 2. AND one of: currentValue is nil/empty OR matches placeholder
        // 3. AND (selectionLength == 0 OR selectionLength is unknown)
        let valueIsEmpty = currentValue == nil || currentValue!.isEmpty
        let valueMatchesPlaceholder = currentValue == placeholder
        let selectionIsZeroOrUnknown = selectionLength == nil || selectionLength == 0

        return (valueIsEmpty || valueMatchesPlaceholder) && selectionIsZeroOrUnknown
    }

    /// Check if element is text-capable (can contain text selection)
    static func isTextCapable(_ element: AXUIElement) -> Bool {
        // Check for TextMarker range attribute
        if hasAttribute(element, "AXSelectedTextMarkerRange") {
            return true
        }

        // Check for standard text range attribute
        if hasAttribute(element, kAXSelectedTextRangeAttribute) {
            return true
        }

        // Check for value attribute with editable role
        let role = getStringAttribute(element, kAXRoleAttribute)
        if hasAttribute(element, kAXValueAttribute) {
            if let role = role, editableRoles.contains(role) {
                return true
            }
        }

        // Check for web area roles
        if role == "AXWebArea" {
            return true
        }

        return false
    }

    // MARK: - Element Tree Navigation

    /// Get children of an AXUIElement
    static func getChildren(_ element: AXUIElement) -> [AXUIElement] {
        var children: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children)

        guard error == .success, let childrenArray = children as? [AXUIElement] else {
            return []
        }
        return childrenArray
    }

    /// Get parent of an AXUIElement
    static func getParent(_ element: AXUIElement) -> AXUIElement? {
        var parent: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, kAXParentAttribute as CFString, &parent)

        guard error == .success, let parentRef = parent else { return nil }

        // Verify it's actually an AXUIElement
        if CFGetTypeID(parentRef) == AXUIElementGetTypeID() {
            return (parentRef as! AXUIElement)
        }
        return nil
    }

    /// Get the parent chain of an element (up to maxDepth)
    static func getParentChain(_ element: AXUIElement, maxDepth: Int = PARENT_CHAIN_MAX_DEPTH) -> [AXUIElement] {
        var chain: [AXUIElement] = []
        var currentElement = element

        for _ in 0..<maxDepth {
            guard let parent = getParent(currentElement) else { break }
            chain.append(parent)
            currentElement = parent
        }

        return chain
    }

    /// Touch descendant elements to ensure they're accessible (triggers lazy loading)
    static func touchDescendants(_ element: AXUIElement, maxDepth: Int = TOUCH_DESCENDANTS_MAX_DEPTH) {
        guard maxDepth > 0 else { return }

        let children = getChildren(element)
        let limitedChildren = Array(children.prefix(TOUCH_DESCENDANTS_PREFIX_LIMIT))

        for child in limitedChildren {
            touchDescendants(child, maxDepth: maxDepth - 1)
        }
    }

    // MARK: - Selection Range Helpers

    /// Get CFRange from AXSelectedTextRange attribute
    static func getSelectedTextRange(_ element: AXUIElement) -> CFRange? {
        var rangeValue: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &rangeValue)

        guard error == .success, let axValue = rangeValue else { return nil }

        var range = CFRange()
        if AXValueGetValue(axValue as! AXValue, .cfRange, &range) {
            return range
        }
        return nil
    }

    /// Get text for a specific range using AXStringForRange
    static func getStringForRange(_ element: AXUIElement, range: CFRange) -> String? {
        var mutableRange = range
        var rangeValue: AXValue?
        rangeValue = AXValueCreate(.cfRange, &mutableRange) as AXValue?

        guard let rangeParam = rangeValue else { return nil }

        var result: CFTypeRef?
        let error = AXUIElementCopyParameterizedAttributeValue(
            element,
            kAXStringForRangeParameterizedAttribute as CFString,
            rangeParam,
            &result
        )

        return error == .success ? result as? String : nil
    }

    /// Get the total number of characters in the element
    static func getNumberOfCharacters(_ element: AXUIElement) -> Int? {
        return getIntAttribute(element, kAXNumberOfCharactersAttribute)
    }

    // MARK: - UTF-16 String Helpers

    /// Adjust offset to avoid splitting surrogate pairs (single source of truth)
    ///
    /// - direction .forward: Used for windowStart - move INTO content to include complete char
    ///   - At LOW surrogate (trail): move +1 to skip the orphan trail
    ///   - Previous is HIGH surrogate (lead): move +1 to include complete pair
    ///
    /// - direction .backward: Used for windowEnd - move OUT of content to exclude incomplete char
    ///   - At LOW surrogate (trail): move -1 to exclude orphan trail
    ///   - Previous is HIGH surrogate (lead): move -1 to exclude lead (pair would be split)
    static func adjustForSurrogatePairs(_ content: String, offset: Int, direction: SurrogatePairDirection) -> Int {
        let utf16 = content.utf16
        guard offset > 0 && offset < utf16.count else { return offset }

        let idx = utf16.index(utf16.startIndex, offsetBy: offset)
        let codeUnit = utf16[idx]

        // At a LOW surrogate (trail) - the HIGH surrogate is before us
        if UTF16.isTrailSurrogate(codeUnit) {
            return direction == .forward ? offset + 1 : offset - 1
        }

        // Check if previous code unit is a HIGH surrogate (lead) - we'd split the pair
        if offset > 0 {
            let prevIdx = utf16.index(before: idx)
            let prevCodeUnit = utf16[prevIdx]
            if UTF16.isLeadSurrogate(prevCodeUnit) {
                return direction == .forward ? offset + 1 : offset - 1
            }
        }

        return offset
    }

    /// Clamp a value to a range
    static func clamp<T: Comparable>(_ value: T, min minValue: T, max maxValue: T) -> T {
        return max(minValue, min(maxValue, value))
    }

    /// Extract a substring using UTF-16 indices
    static func substringUTF16(_ content: String, start: Int, length: Int) -> String? {
        let utf16 = content.utf16
        let totalLength = utf16.count

        guard start >= 0 && start <= totalLength && length >= 0 else { return nil }

        let endOffset = min(start + length, totalLength)
        let startIdx = utf16.index(utf16.startIndex, offsetBy: start)
        let endIdx = utf16.index(utf16.startIndex, offsetBy: endOffset)

        return String(utf16[startIdx..<endIdx])
    }

    // MARK: - Process Helpers

    /// Get the frontmost application's process ID
    static func getFrontProcessID() -> pid_t {
        guard let frontmostApp = NSWorkspace.shared.frontmostApplication else {
            return 0
        }
        return frontmostApp.processIdentifier
    }

    /// Get the running application for a process ID
    static func getRunningApplication(pid: pid_t) -> NSRunningApplication? {
        return NSRunningApplication(processIdentifier: pid)
    }

    /// Get the process name for a PID
    static func getProcessName(pid: pid_t) -> String? {
        guard let application = getRunningApplication(pid: pid),
              let url = application.executableURL else {
            return nil
        }
        return url.lastPathComponent
    }

    /// Get the bundle identifier for a PID
    static func getBundleIdentifier(pid: pid_t) -> String? {
        return getRunningApplication(pid: pid)?.bundleIdentifier
    }

    /// Get the application version for a PID
    static func getApplicationVersion(pid: pid_t) -> String? {
        guard let application = getRunningApplication(pid: pid),
              let bundleURL = application.bundleURL,
              let bundle = Bundle(url: bundleURL) else {
            return nil
        }
        return bundle.infoDictionary?["CFBundleShortVersionString"] as? String
    }

    /// Create an AXUIElement for an application by PID
    static func createApplicationElement(pid: pid_t) -> AXUIElement {
        return AXUIElementCreateApplication(pid)
    }

    /// Enable manual accessibility for specific apps (Chrome, Firefox, etc.)
    static func enableManualAccessibilityIfNeeded(application: AXUIElement, bundleId: String?) {
        guard let bundleId = bundleId, appsRequiringManualAX.contains(bundleId) else { return }

        AXUIElementSetAttributeValue(application, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        AXUIElementSetAttributeValue(application, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
    }

    // MARK: - Permission Helpers

    /// Check if accessibility permissions are granted
    static func checkAccessibilityPermissions(prompt: Bool = false) -> Bool {
        let options: [String: Any] = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt]
        return AXIsProcessTrustedWithOptions(options as CFDictionary)
    }

    // MARK: - WebArea Search Helpers

    /// Get the role of an element
    static func getRole(_ element: AXUIElement) -> String? {
        return getStringAttribute(element, kAXRoleAttribute)
    }

    /// Get the process ID from an AXUIElement
    static func getPid(_ element: AXUIElement) -> pid_t? {
        var pid: pid_t = 0
        let error = AXUIElementGetPid(element, &pid)
        return error == .success ? pid : nil
    }

    /// Get the focused element for a specific application by PID
    static func getAppFocusedElement(forPid pid: pid_t?) -> AXUIElement? {
        guard let pid = pid, pid > 0 else { return nil }

        let application = AXUIElementCreateApplication(pid)
        var focusedElement: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(
            application,
            kAXFocusedUIElementAttribute as CFString,
            &focusedElement
        )

        guard error == .success, let element = focusedElement else {
            return nil
        }

        return (element as! AXUIElement)
    }

    /// Check if element A is a descendant of or equal to element B
    /// Uses AXParent chain traversal
    static func isDescendantOrEqual(_ elementA: AXUIElement, of elementB: AXUIElement) -> Bool {
        // Check if they're the same element
        if CFEqual(elementA, elementB) {
            return true
        }

        // Walk up parent chain from elementA looking for elementB
        var current: AXUIElement? = elementA
        var depth = 0
        let maxDepth = DESCENDANT_CHECK_MAX_DEPTH // Prevent infinite loops

        while let element = current, depth < maxDepth {
            if let parent = getParent(element) {
                if CFEqual(parent, elementB) {
                    return true
                }
                current = parent
                depth += 1
            } else {
                break
            }
        }

        return false
    }

    /// Check if an element has a text marker range attribute (single or multi-range)
    /// Returns true if:
    /// - AXSelectedTextMarkerRange is present (not nil, length=0 is valid cursor), OR
    /// - AXSelectedTextMarkerRanges array has at least one range
    static func hasTextMarkerRange(_ element: AXUIElement) -> Bool {
        // Check single range (AXSelectedTextMarkerRange)
        var singleRangeRef: CFTypeRef?
        let singleError = AXUIElementCopyAttributeValue(
            element,
            "AXSelectedTextMarkerRange" as CFString,
            &singleRangeRef
        )
        if singleError == .success && singleRangeRef != nil {
            return true
        }

        // Check multi-range (AXSelectedTextMarkerRanges)
        var multiRangeRef: CFTypeRef?
        let multiError = AXUIElementCopyAttributeValue(
            element,
            "AXSelectedTextMarkerRanges" as CFString,
            &multiRangeRef
        )
        if multiError == .success, let ranges = multiRangeRef as? [Any], !ranges.isEmpty {
            return true
        }

        return false
    }

    /// Find the descendant text element that actually has focus/cursor
    /// Priority: AXFocused text element > element with non-zero selection > element with most content
    /// - Parameters:
    ///   - element: Starting element (container)
    ///   - maxDepth: Maximum depth to search
    ///   - maxElements: Maximum elements to visit
    /// - Returns: The focused text element, or nil if none found
    static func findDeepestTextElement(
        from element: AXUIElement,
        maxDepth: Int = FIND_TEXT_ELEMENT_MAX_DEPTH,
        maxElements: Int = FIND_TEXT_ELEMENT_MAX_ELEMENTS
    ) -> AXUIElement? {
        var focusedCandidate: AXUIElement? = nil      // Element with AXFocused=true AND has value
        var selectionCandidate: AXUIElement? = nil    // Element with non-zero selection range
        var fallbackCandidate: AXUIElement? = nil     // Element with most content (fallback)
        var fallbackContentLength: Int = 0
        var elementsVisited = 0

        // BFS queue: (element, depth)
        var queue: [(AXUIElement, Int)] = [(element, 0)]

        while !queue.isEmpty && elementsVisited < maxElements {
            let (currentElement, currentDepth) = queue.removeFirst()
            elementsVisited += 1

            guard currentDepth < maxDepth else { continue }

            let children = getChildren(currentElement)

            for child in children {
                // Check if this is a text element (has AXValue)
                let value = getStringAttribute(child, kAXValueAttribute)
                let hasValue = value != nil && !value!.isEmpty

                // Check if element has AXSelectedTextRange
                let range = getSelectedTextRange(child)
                let hasRange = range != nil

                // Priority 1: Check if this element has AXFocused=true AND has content
                var focusedRef: CFTypeRef?
                let focusedError = AXUIElementCopyAttributeValue(child, kAXFocusedAttribute as CFString, &focusedRef)
                if focusedError == .success, let focused = focusedRef as? Bool, focused {
                    if hasValue && hasRange {
                        focusedCandidate = child
                    }
                }

                // Priority 2: Check if selection range indicates cursor is here (non-zero location or has selection)
                // IMPORTANT: Require non-empty content to be a valid candidate
                if let r = range, hasValue {
                    if selectionCandidate == nil && (r.location > 0 || r.length > 0) {
                        // Verify the content can accommodate the selection
                        if let v = value, v.utf16.count >= r.location {
                            selectionCandidate = child
                        }
                    }
                }

                // Priority 3: Fallback to element with most content that has a selection range
                // IMPORTANT: Require non-empty content to be a valid candidate
                if hasRange && hasValue, let v = value {
                    let contentLength = v.utf16.count
                    if contentLength > fallbackContentLength {
                        fallbackContentLength = contentLength
                        fallbackCandidate = child
                    }
                }

                queue.append((child, currentDepth + 1))
            }
        }

        // Return in priority order: focused > selection-based > most content
        return focusedCandidate ?? selectionCandidate ?? fallbackCandidate
    }

    /// BFS search for AXWebArea elements in descendants
    /// - Parameters:
    ///   - element: Starting element for search
    ///   - excludeElement: Element to exclude from results (typically the focused element)
    ///   - maxDepth: Maximum depth to search (default 10)
    ///   - maxElements: Maximum elements to visit (default 200)
    /// - Returns: Array of (WebArea, depth) tuples
    static func findWebAreasInDescendants(
        element: AXUIElement,
        excludeElement: AXUIElement,
        maxDepth: Int = FIND_WEB_AREAS_MAX_DEPTH,
        maxElements: Int = FIND_WEB_AREAS_MAX_ELEMENTS
    ) -> [(AXUIElement, Int)] {
        var results: [(AXUIElement, Int)] = []
        var elementsVisited = 0

        // BFS queue: (element, depth)
        var queue: [(AXUIElement, Int)] = [(element, 0)]

        while !queue.isEmpty && elementsVisited < maxElements {
            let (currentElement, currentDepth) = queue.removeFirst()
            elementsVisited += 1

            // Skip if we've exceeded max depth for children
            guard currentDepth < maxDepth else { continue }

            let children = getChildren(currentElement)

            for child in children {
                // Check if this child is an AXWebArea
                if let role = getRole(child), role == "AXWebArea" {
                    // Exclude the original focused element
                    if !CFEqual(child, excludeElement) {
                        results.append((child, currentDepth + 1))
                    }
                }

                // Add child to queue for further exploration
                queue.append((child, currentDepth + 1))
            }
        }

        return results
    }

    /// Walk up parent chain looking for AXWebArea elements
    /// - Parameters:
    ///   - element: Starting element for search
    ///   - excludeElement: Element to exclude from results
    ///   - maxLevels: Maximum levels to traverse up (default 3)
    /// - Returns: Array of (WebArea, depth) tuples where depth is negative (-1 = parent, -2 = grandparent)
    static func findWebAreasInAncestors(
        element: AXUIElement,
        excludeElement: AXUIElement,
        maxLevels: Int = 3
    ) -> [(AXUIElement, Int)] {
        var results: [(AXUIElement, Int)] = []
        var current: AXUIElement? = element
        var level = 0

        while let currentElement = current, level < maxLevels {
            guard let parent = getParent(currentElement) else { break }
            level += 1

            // Check if parent is AXWebArea
            if let role = getRole(parent), role == "AXWebArea" {
                // Exclude the original focused element
                if !CFEqual(parent, excludeElement) {
                    results.append((parent, -level)) // Negative depth for ancestors
                }
            }

            current = parent
        }

        return results
    }
}
