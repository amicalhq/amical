import Foundation
import ApplicationServices
import AppKit

// Apps that need manual accessibility enabling
let appsManuallyEnableAx: Set<String> = ["com.google.Chrome", "org.mozilla.firefox", "com.microsoft.edgemac", "com.apple.Safari"]

struct ProcessInfo {
    let pid: pid_t
    let name: String?
    let bundleIdentifier: String?
    let version: String?
}

struct Selection {
    let text: String
    let process: ProcessInfo
    let preSelection: String?
    let postSelection: String?
    let fullContent: String?
    let selectionRange: NSRange?
    let isEditable: Bool
    let elementType: String?
}

class AccessibilityContextService {
    
    static func checkAccessibilityPermissions(prompt: Bool = false) -> Bool {
        let options: [String: Any] = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt]
        return AXIsProcessTrustedWithOptions(options as CFDictionary)
    }
    
    static func getFrontProcessID() -> pid_t {
        guard let frontmostApp = NSWorkspace.shared.frontmostApplication else {
            FileHandle.standardError.write("❌ No frontmost application found\n".data(using: .utf8)!)
            return 0
        }
        return frontmostApp.processIdentifier
    }
    
    static func getProcessName(pid: pid_t) -> String? {
        guard let application = NSRunningApplication(processIdentifier: pid),
              let url = application.executableURL else {
            return nil
        }
        return url.lastPathComponent
    }
    
    static func getBundleIdentifier(pid: pid_t) -> String? {
        guard let application = NSRunningApplication(processIdentifier: pid) else {
            return nil
        }
        return application.bundleIdentifier
    }
    
    static func getApplicationVersion(pid: pid_t) -> String? {
        guard let application = NSRunningApplication(processIdentifier: pid),
              let bundle = Bundle(url: application.bundleURL ?? URL(fileURLWithPath: "")) else {
            return nil
        }
        return bundle.infoDictionary?["CFBundleShortVersionString"] as? String
    }
    
    static func touchDescendantElements(_ element: AXUIElement, maxDepth: Int) {
        guard maxDepth > 0 else { return }
        
        var children: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children)
        
        guard error == .success, let childrenArray = children as? [AXUIElement] else {
            return
        }
        
        // Limit to 8 children to avoid performance issues
        let limitedChildren = Array(childrenArray.prefix(8))
        for child in limitedChildren {
            touchDescendantElements(child, maxDepth: maxDepth - 1)
        }
    }
    
    static func _getFocusedElement(pid: pid_t) -> AXUIElement? {
        let application = AXUIElementCreateApplication(pid)
        
        // Enable manual accessibility for specific apps
        if let bundleId: String = getBundleIdentifier(pid: pid),
           appsManuallyEnableAx.contains(bundleId) {
            FileHandle.standardError.write("🔧 Enabling manual accessibility for \(bundleId)\n".data(using: .utf8)!)
            AXUIElementSetAttributeValue(application, "AXManualAccessibility" as CFString, kCFBooleanTrue)
            AXUIElementSetAttributeValue(application, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
        }
        
        var focusedElement: CFTypeRef?
        var error = AXUIElementCopyAttributeValue(application, kAXFocusedUIElementAttribute as CFString, &focusedElement)
        
        // Fallback to focused window if focused element fails
        if error != .success {
            FileHandle.standardError.write("⚠️ Failed to get focused element, trying focused window...\n".data(using: .utf8)!)
            error = AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute as CFString, &focusedElement)
        }
        
        guard error == .success, let element = focusedElement else {
            FileHandle.standardError.write("❌ Failed to get focused element or window. Error: \(error.rawValue)\n".data(using: .utf8)!)
            return nil
        }
        
        return (element as! AXUIElement)
    }
    
    static func getAttributeValue(element: AXUIElement, attribute: String) -> String? {
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        
        if error == .success {
            if let stringValue = value as? String {
                return stringValue
            } else if let numberValue = value as? NSNumber {
                return numberValue.stringValue
            } else if let boolValue = value as? Bool {
                return boolValue ? "true" : "false"
            }
        }
        return nil
    }
    
    static func getAttributeNames(element: AXUIElement) -> [String] {
        var attributeNames: CFArray?
        let error = AXUIElementCopyAttributeNames(element, &attributeNames)
        
        if error == .success, let names = attributeNames as? [String] {
            return names
        }
        return []
    }
    
    static func isElementEditable(element: AXUIElement) -> Bool {
        let role = getAttributeValue(element: element, attribute: kAXRoleAttribute)
        let subrole = getAttributeValue(element: element, attribute: kAXSubroleAttribute)
        
        // Check for editable roles
        let editableRoles = ["AXTextField", "AXTextArea", "AXComboBox"]
        if let role = role, editableRoles.contains(role) {
            return true
        }
        
        // Check for editable subroles
        let editableSubroles = ["AXSecureTextField", "AXSearchField"]
        if let subrole = subrole, editableSubroles.contains(subrole) {
            return true
        }
        
        // Check if element has AXValue attribute (often indicates editability)
        let attributes = getAttributeNames(element: element)
        return attributes.contains(kAXValueAttribute)
    }
    
    static func getParentChain(element: AXUIElement, maxDepth: Int = 10) -> [String] {
        var chain: [String] = []
        var currentElement = element
        
        for _ in 0..<maxDepth {
            var parent: CFTypeRef?
            let error = AXUIElementCopyAttributeValue(currentElement, kAXParentAttribute as CFString, &parent)
            
            if error == .success, let parentElement = parent {
                // Check if the parent is actually an AXUIElement
                if CFGetTypeID(parentElement) == AXUIElementGetTypeID() {
                    let axParent = parentElement as! AXUIElement
                    if let role = getAttributeValue(element: axParent, attribute: kAXRoleAttribute) {
                        chain.append(role)
                    }
                    currentElement = axParent
                } else {
                    break
                }
            } else {
                break
            }
        }
        
        return chain
    }
    
    static func getTextSelection(element: AXUIElement) -> TextSelection? {
        // Get selected text
        guard let selectedText = getAttributeValue(element: element, attribute: kAXSelectedTextAttribute),
              !selectedText.isEmpty else {
            return nil
        }
        
        // Get full content
        let fullContent = getAttributeValue(element: element, attribute: kAXValueAttribute)
        
        // Get selection range
        var selectionRange: SelectionRange? = nil
        var rangeValue: CFTypeRef?
        let rangeError = AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &rangeValue)
        
        if rangeError == .success, let axValue = rangeValue {
            var range = CFRange()
            if AXValueGetValue(axValue as! AXValue, .cfRange, &range) {
                selectionRange = SelectionRange(length: Int(range.length), location: Int(range.location))
            }
        }
        
        // Calculate pre and post selection text
        var preSelectionText: String? = nil
        var postSelectionText: String? = nil
        
        if let fullContent = fullContent, let range = selectionRange {
            let nsString = fullContent as NSString
            
            if range.location > 0 {
                let preRange = NSRange(location: 0, length: range.location)
                preSelectionText = nsString.substring(with: preRange)
            }
            
            let postStart = range.location + range.length
            if postStart < nsString.length {
                let postRange = NSRange(location: postStart, length: nsString.length - postStart)
                postSelectionText = nsString.substring(with: postRange)
            }
        }
        
        let isEditable = isElementEditable(element: element)
        
        return TextSelection(
            fullContent: fullContent,
            isEditable: isEditable,
            postSelectionText: postSelectionText,
            preSelectionText: preSelectionText,
            selectedText: selectedText,
            selectionRange: selectionRange
        )
    }
    
    static func getBrowserURL(windowElement: AXUIElement, bundleId: String?) -> String? {
        var foundURL: String? = nil
        var urlSource = "none"
        
        // Debug: Print all window attributes
        FileHandle.standardError.write("🔍 Window attributes:\n".data(using: .utf8)!)
        let attributes = getAttributeNames(element: windowElement)
        for attribute in attributes {
            if let value = getAttributeValue(element: windowElement, attribute: attribute) {
                FileHandle.standardError.write("  \(attribute): \(value)\n".data(using: .utf8)!)
            } else {
                FileHandle.standardError.write("  \(attribute): <no value>\n".data(using: .utf8)!)
            }
        }
        
        // Determine browser type for conditional logic
        let isChromiumBrowser = bundleId?.lowercased().contains("chrome") == true || 
                               bundleId?.lowercased().contains("chromium") == true ||
                               bundleId == "com.microsoft.edgemac" ||
                               bundleId == "com.brave.Browser" ||
                               bundleId == "com.operasoftware.Opera" ||
                               bundleId == "com.vivaldi.Vivaldi"
        
        let isFirefox = bundleId == "org.mozilla.firefox"
        
        FileHandle.standardError.write("🔍 Browser type - Chromium: \(isChromiumBrowser), Firefox: \(isFirefox), Bundle: \(bundleId ?? "unknown")\n".data(using: .utf8)!)
        
        // For Chromium browsers and Firefox: Prioritize AXWebArea (live URL)
        if isChromiumBrowser || isFirefox {
            FileHandle.standardError.write("🔍 Using AXWebArea priority for Chromium/Firefox browser\n".data(using: .utf8)!)
            foundURL = findURLInChildren(element: windowElement, depth: 0, maxDepth: 30)
            if foundURL != nil {
                urlSource = "tree_walking_priority"
                FileHandle.standardError.write("🔍 Found URL from AXWebArea (priority): \(foundURL!)\n".data(using: .utf8)!)
                return foundURL
            }
        }
        
        // Try window-level attributes (reliable for Safari, fallback for others)
        var urlRef: CFTypeRef?
        let docErr = AXUIElementCopyAttributeValue(windowElement,
                                                   kAXDocumentAttribute as CFString,
                                                   &urlRef)
        if docErr == .success, let urlString = urlRef as? String, !urlString.isEmpty {
            foundURL = urlString
            urlSource = "window_document"
            FileHandle.standardError.write("🔍 Found URL from window document: \(urlString)\n".data(using: .utf8)!)
            
            // For Safari and other WebKit browsers, this is reliable, return immediately
            if !isChromiumBrowser && !isFirefox {
                return foundURL
            }
            // For Chromium/Firefox, keep this as fallback but continue looking
        }
        
        if AXUIElementCopyAttributeValue(windowElement,
                                         kAXURLAttribute as CFString,
                                         &urlRef) == .success,
           let urlString = urlRef as? String, !urlString.isEmpty {
            if foundURL == nil {
                foundURL = urlString
                urlSource = "window_url"
                FileHandle.standardError.write("🔍 Found URL from window URL attribute: \(urlString)\n".data(using: .utf8)!)
                
                // For Safari and other WebKit browsers, this is reliable, return immediately
                if !isChromiumBrowser && !isFirefox {
                    return foundURL
                }
            }
        }

        // For non-Chromium browsers that didn't find window URLs, try tree walking
        if !isChromiumBrowser && !isFirefox && foundURL == nil {
            foundURL = findURLInChildren(element: windowElement, depth: 0, maxDepth: 3)
            if foundURL != nil {
                urlSource = "tree_walking_fallback"
                FileHandle.standardError.write("🔍 Found URL from tree walking (fallback): \(foundURL!)\n".data(using: .utf8)!)
                return foundURL
            }
        }

        if foundURL != nil {
            FileHandle.standardError.write("🔍 Returning URL (\(urlSource)): \(foundURL!)\n".data(using: .utf8)!)
            return foundURL
        }

        FileHandle.standardError.write("🔍 No URL found from any method\n".data(using: .utf8)!)
        return nil
    }
    
    static func findURLInChildren(element: AXUIElement, depth: Int, maxDepth: Int) -> String? {
        guard depth < maxDepth else { return nil }
        
        // BFS implementation using a queue
        var queue: [(element: AXUIElement, depth: Int)] = [(element, depth)]
        
        while !queue.isEmpty {
            let (currentElement, currentDepth) = queue.removeFirst()
            
            // Skip if we've exceeded max depth
            guard currentDepth < maxDepth else { continue }
            
            var childrenRef: CFTypeRef?
            guard AXUIElementCopyAttributeValue(currentElement,
                                                kAXChildrenAttribute as CFString,
                                                &childrenRef) == .success,
                  let children = childrenRef as? [AXUIElement] else {
                continue
            }
            
            // Process all children at current level first (BFS)
            for child in children {
                // Check role first
                var roleRef: CFTypeRef?
                guard AXUIElementCopyAttributeValue(child,
                                                    kAXRoleAttribute as CFString,
                                                    &roleRef) == .success,
                      let role = roleRef as? String else {
                    continue
                }
                
                // log role
                FileHandle.standardError.write("🔍 Found element with role: \(role) at depth \(currentDepth + 1)\n".data(using: .utf8)!)
                // log all attribute names
                FileHandle.standardError.write("🔍 Element attributes: \(getAttributeNames(element: child))\n".data(using: .utf8)!)
                // log kAXURLAttribute
                FileHandle.standardError.write("🔍 kAXURLAttribute: \(getAttributeValue(element: child, attribute: kAXURLAttribute) ?? "none")\n".data(using: .utf8)!)
                
                // Priority 1: Address/search fields (most current)
                if role == "AXTextField" || role == "AXComboBox" || role == "AXSafariAddressAndSearchField" {
                    var valueRef: CFTypeRef?
                    if AXUIElementCopyAttributeValue(child,
                                                     kAXValueAttribute as CFString,
                                                     &valueRef) == .success,
                       let value = valueRef as? String,
                       !value.isEmpty,
                       (value.hasPrefix("http://") || value.hasPrefix("https://") || value.contains(".")) {
                        FileHandle.standardError.write("🔍 Found URL in address field (\(role)): \(value)\n".data(using: .utf8)!)
                        return value
                    }
                }
                
                // Priority 2: Web areas
                if role == "AXWebArea" {
                    FileHandle.standardError.write("🔍 Found AXWebArea element at depth \(currentDepth + 1)\n".data(using: .utf8)!)
                    // list all attributes for this element
                    FileHandle.standardError.write("🔍 AXWebArea attributes: \(getAttributeNames(element: child))\n".data(using: .utf8)!)
                    // iterate and list value for all attributes
                    for attribute in getAttributeNames(element: child) {
                        FileHandle.standardError.write("🔍 \(attribute): \(getAttributeValue(element: child, attribute: attribute) ?? "none")\n".data(using: .utf8)!)
                    }
                    var urlRef: CFTypeRef?
                    if AXUIElementCopyAttributeValue(child,
                                                     kAXURLAttribute as CFString,
                                                     &urlRef) == .success,
                       let urlString = urlRef as? String, !urlString.isEmpty {
                        FileHandle.standardError.write("🔍 Found URL in web area: \(urlString)\n".data(using: .utf8)!)
                        return urlString
                    }
                    
                    if AXUIElementCopyAttributeValue(child,
                                                     kAXDocumentAttribute as CFString,
                                                     &urlRef) == .success,
                       let urlString = urlRef as? String, !urlString.isEmpty {
                        FileHandle.standardError.write("🔍 Found URL in web area document: \(urlString)\n".data(using: .utf8)!)
                        return urlString
                    }
                }
                
                // Add child to queue for next level processing
                queue.append((child, currentDepth + 1))
            }
        }
        
        return nil
    }
    
    static func getWindowInfo(pid: pid_t) -> WindowInfo? {
        let application = AXUIElementCreateApplication(pid)
        
        // Get main window
        var mainWindow: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(application, kAXMainWindowAttribute as CFString, &mainWindow)
        
        guard error == .success, let windowRef = mainWindow else {
            return nil
        }
        
        // Check if the window is actually an AXUIElement
        guard CFGetTypeID(windowRef) == AXUIElementGetTypeID() else {
            return nil
        }
        
        let window = windowRef as! AXUIElement
        let title = getAttributeValue(element: window, attribute: kAXTitleAttribute)
        
        // Get URL if this is a browser
        let url = getBrowserURL(windowElement: window, bundleId: getBundleIdentifier(pid: pid))
        
        return WindowInfo(
            title: title,
            url: url
        )
    }
    
    static func getAccessibilityContext(editableOnly: Bool = false) -> Context? {
        // Check accessibility permissions
        guard checkAccessibilityPermissions() else {
            FileHandle.standardError.write("❌ Accessibility permissions not granted\n".data(using: .utf8)!)
            return nil
        }
        
        // Get frontmost application
        let pid = getFrontProcessID()
        guard pid > 0 else {
            FileHandle.standardError.write("❌ Could not get frontmost application PID\n".data(using: .utf8)!)
            return nil
        }
        
        let processName = getProcessName(pid: pid)
        let bundleId = getBundleIdentifier(pid: pid)
        let version = getApplicationVersion(pid: pid)
        
        // Create application info
        let applicationInfo = Application(
            bundleIdentifier: bundleId,
            name: processName,
            version: version
        )
        
        // Get focused element
        var focusedElementInfo: FocusedElement? = nil
        var textSelectionInfo: TextSelection? = nil
        
        if let focusedElement = _getFocusedElement(pid: pid) {
            // Touch descendant elements to ensure they're accessible
            touchDescendantElements(focusedElement, maxDepth: 3)
            
            let role = getAttributeValue(element: focusedElement, attribute: kAXRoleAttribute)
            let title = getAttributeValue(element: focusedElement, attribute: kAXTitleAttribute)
            let description = getAttributeValue(element: focusedElement, attribute: kAXDescriptionAttribute)
            let value = getAttributeValue(element: focusedElement, attribute: kAXValueAttribute)
            let isEditable = isElementEditable(element: focusedElement)
            
            focusedElementInfo = FocusedElement(
                description: description,
                isEditable: isEditable,
                role: role,
                title: title,
                value: value
            )
            
            // Get text selection if available and not filtered by editableOnly
            if let textSelection = getTextSelection(element: focusedElement) {
                if !editableOnly || textSelection.isEditable {
                    textSelectionInfo = textSelection
                }
            }
        }
        
        // Get window info
        let windowInfo = getWindowInfo(pid: pid)
        
        // Create context
        let context = Context(
            application: applicationInfo,
            focusedElement: focusedElementInfo,
            textSelection: textSelectionInfo,
            timestamp: Date().timeIntervalSince1970,
            windowInfo: windowInfo
        )
        
        return context
    }
} 