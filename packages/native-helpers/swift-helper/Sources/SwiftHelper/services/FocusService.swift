import Foundation
import ApplicationServices
import AppKit

// =============================================================================
// FocusService - Focus Resolution and Element Discovery
// =============================================================================
// Handles finding the focused element and searching for text-capable elements
// when the focused element is not directly text-capable.
// =============================================================================

/// Result of focus resolution
struct FocusResult {
    let element: AXUIElement
    let role: String?
    let wasSearched: Bool  // True if we had to search for a text-capable element
}

/// Service for resolving focus and finding text-capable elements
class FocusService {

    // MARK: - Get Focused Element

    /// Get the focused element for the frontmost application
    /// - Parameter pid: Process ID of the application
    /// - Returns: The focused AXUIElement, or nil if none found
    static func getFocusedElement(pid: pid_t) -> AXUIElement? {
        let application = AXHelpers.createApplicationElement(pid: pid)

        // Enable manual accessibility for specific apps (Chrome, Firefox, etc.)
        let bundleId = AXHelpers.getBundleIdentifier(pid: pid)
        AXHelpers.enableManualAccessibilityIfNeeded(application: application, bundleId: bundleId)

        // Try to get focused UI element
        var focusedElement: CFTypeRef?
        var error = AXUIElementCopyAttributeValue(
            application,
            kAXFocusedUIElementAttribute as CFString,
            &focusedElement
        )

        // Fallback to focused window if focused element fails
        if error != .success {
            error = AXUIElementCopyAttributeValue(
                application,
                kAXFocusedWindowAttribute as CFString,
                &focusedElement
            )
        }

        guard error == .success, let element = focusedElement else {
            return nil
        }

        return (element as! AXUIElement)
    }

    // MARK: - Find Text-Capable Element

    /// Find a text-capable element starting from the focused element
    /// Searches descendants first, then ancestors
    /// - Parameters:
    ///   - element: Starting element
    ///   - editableOnly: If true, only return editable elements
    /// - Returns: FocusResult with the found element, or nil
    static func findTextCapableElement(from element: AXUIElement, editableOnly: Bool) -> FocusResult? {
        let role = AXHelpers.getStringAttribute(element, kAXRoleAttribute)

        // Check if current element is text-capable
        if AXHelpers.isTextCapable(element) {
            if !editableOnly || AXHelpers.isElementEditable(element) {
                return FocusResult(element: element, role: role, wasSearched: false)
            }
        }

        // Search descendants for text-capable element
        if let descendant = searchDescendantsForTextCapable(element: element, editableOnly: editableOnly) {
            let descendantRole = AXHelpers.getStringAttribute(descendant, kAXRoleAttribute)
            return FocusResult(element: descendant, role: descendantRole, wasSearched: true)
        }

        // Search ancestors for text-capable element
        if let ancestor = searchAncestorsForTextCapable(element: element, editableOnly: editableOnly) {
            let ancestorRole = AXHelpers.getStringAttribute(ancestor, kAXRoleAttribute)
            return FocusResult(element: ancestor, role: ancestorRole, wasSearched: true)
        }

        // If editableOnly is false, return the original element if it has any text attributes
        if !editableOnly && AXHelpers.hasAttribute(element, kAXValueAttribute) {
            return FocusResult(element: element, role: role, wasSearched: false)
        }

        return nil
    }

    // MARK: - Descendant Search

    /// Search descendants for a text-capable element using BFS
    private static func searchDescendantsForTextCapable(
        element: AXUIElement,
        editableOnly: Bool,
        maxDepth: Int = TREE_WALK_MAX_DEPTH,
        maxElements: Int = TREE_WALK_MAX_ELEMENTS
    ) -> AXUIElement? {
        var queue: [(element: AXUIElement, depth: Int)] = [(element, 0)]
        var elementsSearched = 0

        while !queue.isEmpty && elementsSearched < maxElements {
            let (current, currentDepth) = queue.removeFirst()
            elementsSearched += 1

            // Skip if we've exceeded max depth
            guard currentDepth < maxDepth else { continue }

            let children = AXHelpers.getChildren(current)

            for child in children {
                // Check if child is text-capable
                if AXHelpers.isTextCapable(child) {
                    if !editableOnly || AXHelpers.isElementEditable(child) {
                        return child
                    }
                }

                // Add to queue for further search
                queue.append((child, currentDepth + 1))
            }
        }

        return nil
    }

    // MARK: - Ancestor Search

    /// Search ancestors for a text-capable element
    private static func searchAncestorsForTextCapable(
        element: AXUIElement,
        editableOnly: Bool,
        maxDepth: Int = TREE_WALK_MAX_DEPTH
    ) -> AXUIElement? {
        var currentElement = element

        for _ in 0..<maxDepth {
            guard let parent = AXHelpers.getParent(currentElement) else { break }

            if AXHelpers.isTextCapable(parent) {
                if !editableOnly || AXHelpers.isElementEditable(parent) {
                    return parent
                }
            }

            currentElement = parent
        }

        return nil
    }

    // MARK: - Element Info Extraction

    /// Extract element info from an AXUIElement
    static func getElementInfo(element: AXUIElement) -> AXElementInfo {
        let role = AXHelpers.getStringAttribute(element, kAXRoleAttribute)
        let subrole = AXHelpers.getStringAttribute(element, kAXSubroleAttribute)
        let title = AXHelpers.getStringAttribute(element, kAXTitleAttribute)
        let description = AXHelpers.getStringAttribute(element, kAXDescriptionAttribute)
        let isEditable = AXHelpers.isElementEditable(element)
        let isSecure = AXHelpers.isSecureField(element)

        // Suppress value for secure fields
        let value: String? = isSecure ? nil : AXHelpers.getStringAttribute(element, kAXValueAttribute)

        // Check placeholder
        let isPlaceholder = AXHelpers.isPlaceholderShowing(element, selectionLength: nil)

        // Check focus (AXFocused attribute)
        let isFocused = AXHelpers.getBoolAttribute(element, kAXFocusedAttribute) ?? true

        // Arguments in alphabetical order per generated types
        return AXElementInfo(
            description: description,
            isEditable: isEditable,
            isFocused: isFocused,
            isPlaceholder: isPlaceholder,
            isSecure: isSecure,
            role: role,
            subrole: subrole,
            title: title,
            value: value
        )
    }

    // MARK: - Window Info Extraction

    /// Get window info for an application
    static func getWindowInfo(pid: pid_t) -> AccessibilityWindowInfo? {
        let application = AXHelpers.createApplicationElement(pid: pid)

        // Get main window
        var mainWindow: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(
            application,
            kAXMainWindowAttribute as CFString,
            &mainWindow
        )

        guard error == .success, let windowRef = mainWindow else {
            return nil
        }

        // Verify it's an AXUIElement
        guard CFGetTypeID(windowRef) == AXUIElementGetTypeID() else {
            return nil
        }

        let window = windowRef as! AXUIElement
        let title = AXHelpers.getStringAttribute(window, kAXTitleAttribute)

        // Get URL if this is a browser
        let bundleId = AXHelpers.getBundleIdentifier(pid: pid)
        let url = getBrowserURL(windowElement: window, bundleId: bundleId)

        return AccessibilityWindowInfo(title: title, url: url)
    }

    // MARK: - Browser URL Extraction

    /// Get browser URL from window element
    private static func getBrowserURL(windowElement: AXUIElement, bundleId: String?) -> String? {
        // Determine browser type
        let isChromiumBrowser = bundleId?.lowercased().contains("chrome") == true ||
                               bundleId?.lowercased().contains("chromium") == true ||
                               bundleId == "com.microsoft.edgemac" ||
                               bundleId == "com.brave.Browser" ||
                               bundleId == "com.operasoftware.Opera" ||
                               bundleId == "com.vivaldi.Vivaldi"

        let isFirefox = bundleId == "org.mozilla.firefox"

        // For Chromium browsers and Firefox: Prioritize AXWebArea tree walk
        if isChromiumBrowser || isFirefox {
            if let url = findURLInChildren(element: windowElement, maxDepth: CHROMIUM_URL_SEARCH_DEPTH) {
                return url
            }
            // Fallback to window-level attributes if tree walk fails
            if let url = AXHelpers.getStringAttribute(windowElement, kAXDocumentAttribute), !url.isEmpty {
                return url
            }
            if let url = AXHelpers.getStringAttribute(windowElement, kAXURLAttribute), !url.isEmpty {
                return url
            }
            return nil
        }

        // For non-Chromium browsers: Try window-level attributes first (more reliable)
        if let url = AXHelpers.getStringAttribute(windowElement, kAXDocumentAttribute), !url.isEmpty {
            return url
        }

        if let url = AXHelpers.getStringAttribute(windowElement, kAXURLAttribute), !url.isEmpty {
            return url
        }

        // Shallow tree walk as fallback for non-Chromium browsers
        return findURLInChildren(element: windowElement, maxDepth: NON_CHROMIUM_URL_SEARCH_DEPTH)
    }

    /// Find URL in children using BFS
    private static func findURLInChildren(element: AXUIElement, maxDepth: Int) -> String? {
        var queue: [(element: AXUIElement, depth: Int)] = [(element, 0)]

        while !queue.isEmpty {
            let (currentElement, currentDepth) = queue.removeFirst()

            guard currentDepth < maxDepth else { continue }

            let children = AXHelpers.getChildren(currentElement)

            for child in children {
                let role = AXHelpers.getStringAttribute(child, kAXRoleAttribute)

                // Check address fields
                if role == "AXTextField" || role == "AXComboBox" || role == "AXSafariAddressAndSearchField" {
                    if let value = AXHelpers.getStringAttribute(child, kAXValueAttribute),
                       !value.isEmpty,
                       (value.hasPrefix("http://") || value.hasPrefix("https://") || value.contains(".")) {
                        return value
                    }
                }

                // Check web areas
                if role == "AXWebArea" {
                    if let url = AXHelpers.getStringAttribute(child, kAXURLAttribute), !url.isEmpty {
                        return url
                    }
                    if let url = AXHelpers.getStringAttribute(child, kAXDocumentAttribute), !url.isEmpty {
                        return url
                    }
                }

                queue.append((child, currentDepth + 1))
            }
        }

        return nil
    }
}
