import Foundation
import ApplicationServices // For AXUIElement and Accessibility APIs
import AppKit // Added AppKit for NSWorkspace
import CoreAudio // For audio control

// Represents a node in the accessibility tree. Must be Codable to be sent via RPC.
struct AccessibilityElementNode: Codable {
    // Basic properties - expand as needed
    let role: String?
    let description: String? // Corresponds to AXDescription
    let title: String?       // Corresponds to AXTitle
    let value: String?       // Corresponds to AXValue (might need to be AnyCodable or specific types)
    let identifier: String?  // Corresponds to AXIdentifier (often not set)
    // let frame: CGRect?    // CGRect is not directly Codable, would need a wrapper or separate fields
    let children: [AccessibilityElementNode]?

    // Example for frame if you want to include it:
    struct CodableRect: Codable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double

        init?(rect: CGRect?) {
            guard let rect = rect else { return nil }
            self.x = Double(rect.origin.x)
            self.y = Double(rect.origin.y)
            self.width = Double(rect.size.width)
            self.height = Double(rect.size.height)
        }
    }
    // let codableFrame: CodableRect?
    
    // Initializer for convenience (internal use during tree construction)
    init(role: String?, description: String?, title: String?, value: String?, identifier: String?, children: [AccessibilityElementNode]?) {
        self.role = role
        self.description = description
        self.title = title
        self.value = value
        self.identifier = identifier
        self.children = children
        // self.codableFrame = CodableRect(rect: frame) // If using frame
    }
}

class AccessibilityService {

    private let maxDepth = 10 // To prevent excessively deep recursion and large payloads

    // Properties to store original audio states
    private var originalSystemMuteState: Bool?
    private var originalSystemVolume: Float32?

    // Fetches a value for a given accessibility attribute from an element.
    private func getAttributeValue(element: AXUIElement, attribute: String) -> String? {
        var value: AnyObject?
        let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        if error == .success, let strValue = value as? String {
            return strValue
        }
        // Could also handle other types like AXValue (numbers, bools) if needed
        return nil
    }
    
    // Fetches children of an accessibility element.
    private func getChildren(element: AXUIElement) -> [AXUIElement]? {
        var value: AnyObject?
        let error = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value)
        if error == .success, let children = value as? [AXUIElement] {
            return children
        }
        return nil
    }

    // MARK: - Audio Control Helpers
    private func getDefaultOutputDeviceID() -> AudioDeviceID? {
        var deviceID: AudioDeviceID = kAudioObjectUnknown
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var propertySize = UInt32(MemoryLayout<AudioDeviceID>.size)

        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &propertyAddress,
            0,
            nil,
            &propertySize,
            &deviceID
        )

        if status == noErr && deviceID != kAudioObjectUnknown {
            return deviceID
        } else {
            FileHandle.standardError.write("[AccessibilityService] Error getting default output device: \(status).\\n".data(using: .utf8)!)
            return nil
        }
    }

    private func isDeviceMuted(deviceID: AudioDeviceID) -> Bool? {
        var isMuted: UInt32 = 0
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyMute,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain // Master channel
        )
        var propertySize = UInt32(MemoryLayout<UInt32>.size)
        
        var isSettable: DarwinBoolean = false
        let infoStatus = AudioObjectIsPropertySettable(deviceID, &propertyAddress, &isSettable)
        if infoStatus != noErr || !isSettable.boolValue {
            FileHandle.standardError.write("[AccessibilityService] Mute property not supported or not settable for device \(deviceID).\\n".data(using: .utf8)!)
            return nil 
        }

        let status = AudioObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            &propertySize,
            &isMuted
        )

        if status == noErr {
            return isMuted == 1
        } else {
            FileHandle.standardError.write("[AccessibilityService] Error getting mute state for device \(deviceID): \(status).\\n".data(using: .utf8)!)
            return nil
        }
    }

    private func setDeviceMute(deviceID: AudioDeviceID, mute: Bool) -> OSStatus {
        var muteVal: UInt32 = mute ? 1 : 0
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyMute,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain // Master channel
        )
        let propertySize = UInt32(MemoryLayout<UInt32>.size)

        var isSettable: DarwinBoolean = false
        let infoStatus = AudioObjectIsPropertySettable(deviceID, &propertyAddress, &isSettable)
        if infoStatus != noErr {
            FileHandle.standardError.write("[AccessibilityService] Error checking if mute is settable for device \(deviceID): \(infoStatus).\\n".data(using: .utf8)!)
            return infoStatus
        }
        if !isSettable.boolValue {
            FileHandle.standardError.write("[AccessibilityService] Mute property is not settable for device \(deviceID).\\n".data(using: .utf8)!)
            return kAudioHardwareUnsupportedOperationError
        }

        let status = AudioObjectSetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            propertySize,
            &muteVal
        )
        if status != noErr {
            FileHandle.standardError.write("[AccessibilityService] Error setting mute state for device \(deviceID) to \(mute): \(status).\\n".data(using: .utf8)!)
        }
        return status
    }

    private func getDeviceVolume(deviceID: AudioDeviceID) -> Float32? {
        var volume: Float32 = 0.0
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyVolumeScalar,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain // Master channel
        )
        var propertySize = UInt32(MemoryLayout<Float32>.size)

        if AudioObjectHasProperty(deviceID, &propertyAddress) == false {
            FileHandle.standardError.write("[AccessibilityService] Volume scalar property not supported for device \(deviceID).\\n".data(using: .utf8)!)
            return nil
        }

        let status = AudioObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            &propertySize,
            &volume
        )

        if status == noErr {
            return volume
        } else {
            FileHandle.standardError.write("[AccessibilityService] Error getting volume for device \(deviceID): \(status).\\n".data(using: .utf8)!)
            return nil
        }
    }

    private func setDeviceVolume(deviceID: AudioDeviceID, volume: Float32) -> OSStatus {
        var newVolume = min(max(volume, 0.0), 1.0) // Clamp volume to 0.0-1.0
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyVolumeScalar,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain // Master channel
        )
        let propertySize = UInt32(MemoryLayout<Float32>.size)

        var isSettable: DarwinBoolean = false
        let infoStatus = AudioObjectIsPropertySettable(deviceID, &propertyAddress, &isSettable)
         if infoStatus != noErr {
            FileHandle.standardError.write("[AccessibilityService] Error checking if volume is settable for device \(deviceID): \(infoStatus).\\n".data(using: .utf8)!)
            return infoStatus
        }
        if !isSettable.boolValue {
            FileHandle.standardError.write("[AccessibilityService] Volume property is not settable for device \(deviceID).\\n".data(using: .utf8)!)
            return kAudioHardwareUnsupportedOperationError
        }

        let status = AudioObjectSetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            propertySize,
            &newVolume
        )
        if status != noErr {
            FileHandle.standardError.write("[AccessibilityService] Error setting volume for device \(deviceID) to \(newVolume): \(status).\\n".data(using: .utf8)!)
        }
        return status
    }

    // Recursive function to build the tree from a given AXUIElement
    func buildTree(fromElement element: AXUIElement, currentDepth: Int) -> AccessibilityElementNode? {
        if currentDepth > maxDepth {
            // Return a placeholder or nil if max depth is exceeded
            return AccessibilityElementNode(role: "DepthLimitExceeded", description: "Max recursion depth reached", title: nil, value: nil, identifier: nil, children: nil)
        }

        let role = getAttributeValue(element: element, attribute: kAXRoleAttribute)
        let description = getAttributeValue(element: element, attribute: kAXDescriptionAttribute)
        let title = getAttributeValue(element: element, attribute: kAXTitleAttribute)
        let value = getAttributeValue(element: element, attribute: kAXValueAttribute)
        let identifier = getAttributeValue(element: element, attribute: kAXIdentifierAttribute)
        // Add more attributes as needed (e.g., kAXFrameAttribute, kAXEnabledAttribute)

        var childNodes: [AccessibilityElementNode]? = nil
        if let axChildren = getChildren(element: element) {
            childNodes = [] // Initialize if there are children to process
            for childElement in axChildren {
                if let childNode = buildTree(fromElement: childElement, currentDepth: currentDepth + 1) {
                    childNodes?.append(childNode)
                }
            }
            if childNodes?.isEmpty ?? true { // If loop completed but no valid childNodes were added
                childNodes = nil
            }
        }

        // Only create a node if it has some meaningful data or children
        // This helps to avoid empty nodes for elements that might not be relevant
        if role != nil || description != nil || title != nil || value != nil || identifier != nil || (childNodes != nil && !childNodes!.isEmpty) {
            return AccessibilityElementNode(
                role: role,
                description: description,
                title: title,
                value: value,
                identifier: identifier,
                children: childNodes
            )
        }
        return nil
    }

    // Public method to fetch the entire accessibility tree for the system or a specific app.
    // For `rootId`: if nil, gets system-wide. If "focused", gets the focused application.
    // Otherwise, it could be a bundle identifier (not implemented here yet).
    public func fetchFullAccessibilityTree(rootId: String?) -> AccessibilityElementNode? {
        FileHandle.standardError.write("[AccessibilityService] Starting fetchFullAccessibilityTree. rootId: \(rootId ?? "nil")\n".data(using: .utf8)!)
        
        var rootElement: AXUIElement?

        if let id = rootId, id.lowercased() == "focusedapp" {
            // Get the focused application
            guard let frontmostApp = NSWorkspace.shared.frontmostApplication else {
                FileHandle.standardError.write("[AccessibilityService] Could not get frontmost application.\n".data(using: .utf8)!)
                return nil
            }
            rootElement = AXUIElementCreateApplication(frontmostApp.processIdentifier)
             FileHandle.standardError.write("[AccessibilityService] Targeting focused app: \(frontmostApp.localizedName ?? "Unknown App") (PID: \(frontmostApp.processIdentifier))\n".data(using: .utf8)!)
        } else if let id = rootId, !id.isEmpty {
            // Basic PID lookup if rootId is a number (representing a PID)
            // More robust app lookup by bundle ID would be better for non-PID rootIds.
            if let pid = Int32(id) {
                rootElement = AXUIElementCreateApplication(pid)
                FileHandle.standardError.write("[AccessibilityService] Targeting PID: \(pid)\n".data(using: .utf8)!)
            } else {
                FileHandle.standardError.write("[AccessibilityService] rootId '\(id)' is not 'focusedapp' or a valid PID. Falling back to system-wide (or implement bundle ID lookup).\n".data(using: .utf8)!)
                // Fallback or specific error for unhandled rootId format
                // For now, let's try system-wide if rootId isn't 'focusedapp' or PID.
                 rootElement = AXUIElementCreateSystemWide()
                 FileHandle.standardError.write("[AccessibilityService] Defaulting to system-wide due to unhandled rootId.\n".data(using: .utf8)!)
            }
        } else {
            // Default to system-wide if rootId is nil or empty
            rootElement = AXUIElementCreateSystemWide()
            FileHandle.standardError.write("[AccessibilityService] Targeting system-wide accessibility tree.\n".data(using: .utf8)!)
        }

        guard let element = rootElement else {
            FileHandle.standardError.write("[AccessibilityService] Failed to create root AXUIElement.\n".data(using: .utf8)!)
            return nil
        }
        
        let tree = buildTree(fromElement: element, currentDepth: 0)
        FileHandle.standardError.write("[AccessibilityService] Finished buildTree. Result is \(tree == nil ? "nil" : "not nil").\\n".data(using: .utf8)!)
        return tree
    }

    // MARK: - System Audio Control

    public func muteSystemAudio() -> Bool {
        FileHandle.standardError.write("[AccessibilityService] Attempting to mute system audio.\\n".data(using: .utf8)!)
        guard let deviceID = getDefaultOutputDeviceID() else {
            FileHandle.standardError.write("[AccessibilityService] Could not get default output device to mute audio.\\n".data(using: .utf8)!)
            return false
        }

        // Store original state
        self.originalSystemMuteState = isDeviceMuted(deviceID: deviceID)
        self.originalSystemVolume = getDeviceVolume(deviceID: deviceID)

        FileHandle.standardError.write("[AccessibilityService] Original mute state: \(String(describing: self.originalSystemMuteState)), Original volume: \(String(describing: self.originalSystemVolume)).\\n".data(using: .utf8)!)

        // Attempt to mute
        let muteStatus = setDeviceMute(deviceID: deviceID, mute: true)
        if muteStatus == noErr {
            FileHandle.standardError.write("[AccessibilityService] System audio muted successfully via mute property.\\n".data(using: .utf8)!)
            return true
        } else {
            FileHandle.standardError.write("[AccessibilityService] Failed to set mute property (status: \(muteStatus)). Attempting to set volume to 0.\\n".data(using: .utf8)!)
            let volumeStatus = setDeviceVolume(deviceID: deviceID, volume: 0.0)
            if volumeStatus == noErr {
                FileHandle.standardError.write("[AccessibilityService] System audio silenced by setting volume to 0.\\n".data(using: .utf8)!)
            } else {
                FileHandle.standardError.write("[AccessibilityService] Failed to silence system audio by setting volume to 0 (status: \(volumeStatus)).\\n".data(using: .utf8)!)
            }
            return false
        }
    }

    public func restoreSystemAudio() -> Bool {
        FileHandle.standardError.write("[AccessibilityService] Attempting to restore system audio.\\n".data(using: .utf8)!)
        guard let deviceID = getDefaultOutputDeviceID() else {
            FileHandle.standardError.write("[AccessibilityService] Could not get default output device to restore audio.\\n".data(using: .utf8)!)
            return false
        }

        if let originalMute = self.originalSystemMuteState {
            let muteStatus = setDeviceMute(deviceID: deviceID, mute: originalMute)
            if muteStatus == noErr {
                FileHandle.standardError.write("[AccessibilityService] System mute state restored to \(originalMute).\\n".data(using: .utf8)!)
            } else {
                 FileHandle.standardError.write("[AccessibilityService] Failed to restore original mute state (status: \(muteStatus)).\\n".data(using: .utf8)!)
            }
        }

        let shouldRestoreVolume = self.originalSystemVolume != nil && (self.originalSystemMuteState == false || self.originalSystemMuteState == nil)

        if shouldRestoreVolume, let originalVolume = self.originalSystemVolume {
            let volumeStatus = setDeviceVolume(deviceID: deviceID, volume: originalVolume)
             if volumeStatus == noErr {
                FileHandle.standardError.write("[AccessibilityService] System volume restored to \(originalVolume).\\n".data(using: .utf8)!)
            } else {
                FileHandle.standardError.write("[AccessibilityService] Failed to restore original volume (status: \(volumeStatus)).\\n".data(using: .utf8)!)
            }
        }

        self.originalSystemMuteState = nil
        self.originalSystemVolume = nil
        FileHandle.standardError.write("[AccessibilityService] System audio restoration attempt complete. Stored states cleared.\\n".data(using: .utf8)!)
        return true
    }

    // Pastes the given text into the active application
    public func pasteText(transcript: String) -> Bool {
        FileHandle.standardError.write("[AccessibilityService] Attempting to paste transcript: \(transcript).\n".data(using: .utf8)!)

        let pasteboard = NSPasteboard.general
        let originalPasteboardItems = pasteboard.pasteboardItems?.compactMap { item -> NSPasteboardItem? in
            let newItem = NSPasteboardItem()
            var hasData = false
            for type in item.types ?? [] {
                if let data = item.data(forType: type) {
                    newItem.setData(data, forType: type)
                    hasData = true
                }
            }
            return hasData ? newItem : nil
        } ?? []
        
        let originalChangeCount = pasteboard.changeCount // Save change count to detect external modifications

        pasteboard.clearContents()
        let success = pasteboard.setString(transcript, forType: .string)

        if !success {
            FileHandle.standardError.write("[AccessibilityService] Failed to set string on pasteboard.\n".data(using: .utf8)!)
            // Restore original content before returning
            restorePasteboard(pasteboard: pasteboard, items: originalPasteboardItems, originalChangeCount: originalChangeCount)
            return false
        }

        // Simulate Cmd+V
        // Using deprecated kVK_Command might still work but kCGEventFlagMaskCommand is preferred.
        // Virtual key code for 'v' is 9.
        let vKeyCode: CGKeyCode = 9
        
        let source = CGEventSource(stateID: .hidSystemState)

        let cmdDown = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(55), keyDown: true) // 55 is kVK_Command
        cmdDown?.flags = .maskCommand
        
        let vDown = CGEvent(keyboardEventSource: source, virtualKey: vKeyCode, keyDown: true)
        vDown?.flags = .maskCommand // Keep command flag for the V press as well

        let vUp = CGEvent(keyboardEventSource: source, virtualKey: vKeyCode, keyDown: false)
        vUp?.flags = .maskCommand

        let cmdUp = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(55), keyDown: false)
        // No flags needed for key up typically, or just .maskCommand if it was held

        if cmdDown == nil || vDown == nil || vUp == nil || cmdUp == nil {
            FileHandle.standardError.write("[AccessibilityService] Failed to create CGEvent for paste.\n".data(using: .utf8)!)
            restorePasteboard(pasteboard: pasteboard, items: originalPasteboardItems, originalChangeCount: originalChangeCount)
            return false
        }

        let loc: CGEventTapLocation = .cgSessionEventTap

        cmdDown!.post(tap: loc)
        vDown!.post(tap: loc)
        vUp!.post(tap: loc)
        cmdUp!.post(tap: loc)
        
        FileHandle.standardError.write("[AccessibilityService] Paste keyboard events posted.\\n".data(using: .utf8)!)

        // Restore the original pasteboard content after a short delay
        // to allow the paste action to complete.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { // 200ms delay
            self.restorePasteboard(pasteboard: pasteboard, items: originalPasteboardItems, originalChangeCount: originalChangeCount)
        }
        
        return true
    }

    private func restorePasteboard(pasteboard: NSPasteboard, items: [NSPasteboardItem], originalChangeCount: Int) {
        // Only restore if our temporary content is still the active content on the pasteboard.
        // This means the changeCount should be exactly one greater than when we saved it,
        // indicating our setString operation was the last modification.
        if pasteboard.changeCount == originalChangeCount + 1 {
            pasteboard.clearContents()
            if !items.isEmpty {
                 pasteboard.writeObjects(items)
            }
             FileHandle.standardError.write("[AccessibilityService] Original pasteboard content restored.\\n".data(using: .utf8)!)
        } else {
            // If changeCount is different, it means another app or the user has modified the pasteboard
            // after we set our transcript but before this restoration block was executed.
            // In this case, we should not interfere with the new pasteboard content.
            FileHandle.standardError.write("[AccessibilityService] Pasteboard changed by another process or a new copy occurred (expected changeCount: \(originalChangeCount + 1), current: \(pasteboard.changeCount)); not restoring original content to avoid conflict.\\n".data(using: .utf8)!)
        }
    }

    // Define kVK_Function if not available from a system framework directly in this context.
    // 0x3F is the virtual key code for the Fn key on Apple keyboards.
    private let kVK_Function: CGKeyCode = 0x3F

    // Determines whether a keyboard event should be forwarded to the Electron application.
    // This method should be called from the CGEventTap callback in main.swift or RpcHandler.swift.
    public func shouldForwardKeyboardEvent(event: CGEvent) -> Bool {
        let type = event.type
        let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))

        // Uncomment for verbose logging from Swift helper:
        // FileHandle.standardError.write("[AccessibilityService] shouldForwardKeyboardEvent: type=\(type.rawValue), keyCode=\(keyCode), flags=\(event.flags.rawValue)\n".data(using: .utf8)!)

        if type == .flagsChanged {
            // Always forward flagsChanged events. These are crucial for Electron to know
            // the state of modifier keys, including when the Fn key itself is pressed or released,
            // which is used to control recording.
            // FileHandle.standardError.write("[AccessibilityService] Forwarding flagsChanged event.\n".data(using: .utf8)!)
            return true
        }

        if type == .keyDown || type == .keyUp {
            // For keyDown and keyUp events, only forward if the event is FOR THE Fn KEY ITSELF.
            if keyCode == kVK_Function {
                // FileHandle.standardError.write("[AccessibilityService] Forwarding \(type == .keyDown ? "keyDown" : "keyUp") event because it IS the Fn key (keyCode: \(keyCode)).\n".data(using: .utf8)!)
                return true
            } else {
                // FileHandle.standardError.write("[AccessibilityService] Suppressing \(type == .keyDown ? "keyDown" : "keyUp") event for keyCode \(keyCode) because it is NOT the Fn key.\n".data(using: .utf8)!)
                return false
            }
        }

        // For any other event types (e.g., mouse events, system-defined), don't forward by default.
        // FileHandle.standardError.write("[AccessibilityService] Suppressing event of unhandled type: \(type.rawValue).\n".data(using: .utf8)!)
        return false
    }
}
