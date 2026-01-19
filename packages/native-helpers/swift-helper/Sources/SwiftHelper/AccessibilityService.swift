import AppKit  // Added AppKit for NSWorkspace
import ApplicationServices  // For AXUIElement and Accessibility APIs
import CoreAudio  // For audio control
import Foundation

// Represents a node in the accessibility tree. Must be Codable to be sent via RPC.
struct AccessibilityElementNode: Codable {
    // Basic properties - expand as needed
    let role: String?
    let description: String?  // Corresponds to AXDescription
    let title: String?  // Corresponds to AXTitle
    let value: String?  // Corresponds to AXValue (might need to be AnyCodable or specific types)
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
    init(
        role: String?, description: String?, title: String?, value: String?, identifier: String?,
        children: [AccessibilityElementNode]?
    ) {
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

    private let maxDepth = ACCESSIBILITY_TREE_MAX_DEPTH  // To prevent excessively deep recursion and large payloads
    private let dateFormatter: DateFormatter

    // Properties to store original audio states
    private var originalSystemMuteState: Bool?
    private var originalSystemVolume: Float32?

    init() {
        self.dateFormatter = DateFormatter()
        self.dateFormatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
    }

    private func logToStderr(_ message: String) {
        let timestamp = dateFormatter.string(from: Date())
        let logMessage = "[\(timestamp)] \(message)\n"
        FileHandle.standardError.write(logMessage.data(using: .utf8)!)
    }

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
            logToStderr("[AccessibilityService] Error getting default output device: \(status).")
            return nil
        }
    }

    private func isDeviceMuted(deviceID: AudioDeviceID) -> Bool? {
        var isMuted: UInt32 = 0
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyMute,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain  // Master channel
        )
        var propertySize = UInt32(MemoryLayout<UInt32>.size)

        var isSettable: DarwinBoolean = false
        let infoStatus = AudioObjectIsPropertySettable(deviceID, &propertyAddress, &isSettable)
        if infoStatus != noErr || !isSettable.boolValue {
            logToStderr(
                "[AccessibilityService] Mute property not supported or not settable for device \(deviceID)."
            )
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
            logToStderr(
                "[AccessibilityService] Error getting mute state for device \(deviceID): \(status)."
            )
            return nil
        }
    }

    private func setDeviceMute(deviceID: AudioDeviceID, mute: Bool) -> OSStatus {
        var muteVal: UInt32 = mute ? 1 : 0
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyMute,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain  // Master channel
        )
        let propertySize = UInt32(MemoryLayout<UInt32>.size)

        var isSettable: DarwinBoolean = false
        let infoStatus = AudioObjectIsPropertySettable(deviceID, &propertyAddress, &isSettable)
        if infoStatus != noErr {
            logToStderr(
                "[AccessibilityService] Error checking if mute is settable for device \(deviceID): \(infoStatus)."
            )
            return infoStatus
        }
        if !isSettable.boolValue {
            logToStderr(
                "[AccessibilityService] Mute property is not settable for device \(deviceID).")
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
            logToStderr(
                "[AccessibilityService] Error setting mute state for device \(deviceID) to \(mute): \(status)."
            )
        }
        return status
    }

    private func getDeviceVolume(deviceID: AudioDeviceID) -> Float32? {
        var volume: Float32 = 0.0
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyVolumeScalar,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain  // Master channel
        )
        var propertySize = UInt32(MemoryLayout<Float32>.size)

        if AudioObjectHasProperty(deviceID, &propertyAddress) == false {
            logToStderr(
                "[AccessibilityService] Volume scalar property not supported for device \(deviceID)."
            )
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
            logToStderr(
                "[AccessibilityService] Error getting volume for device \(deviceID): \(status).")
            return nil
        }
    }

    private func setDeviceVolume(deviceID: AudioDeviceID, volume: Float32) -> OSStatus {
        var newVolume = min(max(volume, 0.0), 1.0)  // Clamp volume to 0.0-1.0
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyVolumeScalar,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain  // Master channel
        )
        let propertySize = UInt32(MemoryLayout<Float32>.size)

        var isSettable: DarwinBoolean = false
        let infoStatus = AudioObjectIsPropertySettable(deviceID, &propertyAddress, &isSettable)
        if infoStatus != noErr {
            logToStderr(
                "[AccessibilityService] Error checking if volume is settable for device \(deviceID): \(infoStatus)."
            )
            return infoStatus
        }
        if !isSettable.boolValue {
            logToStderr(
                "[AccessibilityService] Volume property is not settable for device \(deviceID).")
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
            logToStderr(
                "[AccessibilityService] Error setting volume for device \(deviceID) to \(newVolume): \(status)."
            )
        }
        return status
    }

    // Recursive function to build the tree from a given AXUIElement
    func buildTree(fromElement element: AXUIElement, currentDepth: Int) -> AccessibilityElementNode?
    {
        if currentDepth > maxDepth {
            // Return a placeholder or nil if max depth is exceeded
            return AccessibilityElementNode(
                role: "DepthLimitExceeded", description: "Max recursion depth reached", title: nil,
                value: nil, identifier: nil, children: nil)
        }

        let role = getAttributeValue(element: element, attribute: kAXRoleAttribute)
        let description = getAttributeValue(element: element, attribute: kAXDescriptionAttribute)
        let title = getAttributeValue(element: element, attribute: kAXTitleAttribute)
        let value = getAttributeValue(element: element, attribute: kAXValueAttribute)
        let identifier = getAttributeValue(element: element, attribute: kAXIdentifierAttribute)
        // Add more attributes as needed (e.g., kAXFrameAttribute, kAXEnabledAttribute)

        var childNodes: [AccessibilityElementNode]? = nil
        if let axChildren = getChildren(element: element) {
            childNodes = []  // Initialize if there are children to process
            for childElement in axChildren {
                if let childNode = buildTree(
                    fromElement: childElement, currentDepth: currentDepth + 1)
                {
                    childNodes?.append(childNode)
                }
            }
            if childNodes?.isEmpty ?? true {  // If loop completed but no valid childNodes were added
                childNodes = nil
            }
        }

        // Only create a node if it has some meaningful data or children
        // This helps to avoid empty nodes for elements that might not be relevant
        if role != nil || description != nil || title != nil || value != nil || identifier != nil
            || (childNodes != nil && !childNodes!.isEmpty)
        {
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
        logToStderr(
            "[AccessibilityService] Starting fetchFullAccessibilityTree. rootId: \(rootId ?? "nil")"
        )

        var rootElement: AXUIElement?

        if let id = rootId, id.lowercased() == "focusedapp" {
            // Get the focused application
            guard let frontmostApp = NSWorkspace.shared.frontmostApplication else {
                logToStderr("[AccessibilityService] Could not get frontmost application.")
                return nil
            }
            rootElement = AXUIElementCreateApplication(frontmostApp.processIdentifier)
            logToStderr(
                "[AccessibilityService] Targeting focused app: \(frontmostApp.localizedName ?? "Unknown App") (PID: \(frontmostApp.processIdentifier))"
            )
        } else if let id = rootId, !id.isEmpty {
            // Basic PID lookup if rootId is a number (representing a PID)
            // More robust app lookup by bundle ID would be better for non-PID rootIds.
            if let pid = Int32(id) {
                rootElement = AXUIElementCreateApplication(pid)
                logToStderr("[AccessibilityService] Targeting PID: \(pid)")
            } else {
                logToStderr(
                    "[AccessibilityService] rootId '\(id)' is not 'focusedapp' or a valid PID. Falling back to system-wide (or implement bundle ID lookup)."
                )
                // Fallback or specific error for unhandled rootId format
                // For now, let's try system-wide if rootId isn't 'focusedapp' or PID.
                rootElement = AXUIElementCreateSystemWide()
                logToStderr(
                    "[AccessibilityService] Defaulting to system-wide due to unhandled rootId.")
            }
        } else {
            // Default to system-wide if rootId is nil or empty
            rootElement = AXUIElementCreateSystemWide()
            logToStderr("[AccessibilityService] Targeting system-wide accessibility tree.")
        }

        guard let element = rootElement else {
            logToStderr("[AccessibilityService] Failed to create root AXUIElement.")
            return nil
        }

        let tree = buildTree(fromElement: element, currentDepth: 0)
        logToStderr(
            "[AccessibilityService] Finished buildTree. Result is \(tree == nil ? "nil" : "not nil")."
        )
        return tree
    }

    // MARK: - System Audio Control

    public func muteSystemAudio() -> Bool {
        logToStderr("[AccessibilityService] Attempting to mute system audio.")
        guard let deviceID = getDefaultOutputDeviceID() else {
            logToStderr("[AccessibilityService] Could not get default output device to mute audio.")
            return false
        }

        // Store original state
        self.originalSystemMuteState = isDeviceMuted(deviceID: deviceID)
        self.originalSystemVolume = getDeviceVolume(deviceID: deviceID)

        logToStderr(
            "[AccessibilityService] Original mute state: \(String(describing: self.originalSystemMuteState)), Original volume: \(String(describing: self.originalSystemVolume))."
        )

        // Attempt to mute
        let muteStatus = setDeviceMute(deviceID: deviceID, mute: true)
        if muteStatus == noErr {
            logToStderr("[AccessibilityService] System audio muted successfully via mute property.")
            return true
        } else {
            logToStderr(
                "[AccessibilityService] Failed to set mute property (status: \(muteStatus)). Attempting to set volume to 0."
            )
            let volumeStatus = setDeviceVolume(deviceID: deviceID, volume: 0.0)
            if volumeStatus == noErr {
                logToStderr("[AccessibilityService] System audio silenced by setting volume to 0.")
            } else {
                logToStderr(
                    "[AccessibilityService] Failed to silence system audio by setting volume to 0 (status: \(volumeStatus))."
                )
            }
            return false
        }
    }

    public func restoreSystemAudio() -> Bool {
        logToStderr("[AccessibilityService] Attempting to restore system audio.")
        guard let deviceID = getDefaultOutputDeviceID() else {
            logToStderr(
                "[AccessibilityService] Could not get default output device to restore audio.")
            return false
        }

        if let originalMute = self.originalSystemMuteState {
            let muteStatus = setDeviceMute(deviceID: deviceID, mute: originalMute)
            if muteStatus == noErr {
                logToStderr("[AccessibilityService] System mute state restored to \(originalMute).")
            } else {
                logToStderr(
                    "[AccessibilityService] Failed to restore original mute state (status: \(muteStatus))."
                )
            }
        }

        let shouldRestoreVolume =
            self.originalSystemVolume != nil
            && (self.originalSystemMuteState == false || self.originalSystemMuteState == nil)

        if shouldRestoreVolume, let originalVolume = self.originalSystemVolume {
            let volumeStatus = setDeviceVolume(deviceID: deviceID, volume: originalVolume)
            if volumeStatus == noErr {
                logToStderr("[AccessibilityService] System volume restored to \(originalVolume).")
            } else {
                logToStderr(
                    "[AccessibilityService] Failed to restore original volume (status: \(volumeStatus))."
                )
            }
        }

        self.originalSystemMuteState = nil
        self.originalSystemVolume = nil
        logToStderr(
            "[AccessibilityService] System audio restoration attempt complete. Stored states cleared."
        )
        return true
    }

    // Pastes the given text into the active application
    public func pasteText(transcript: String) -> Bool {
        logToStderr("[AccessibilityService] Attempting to paste transcript: \(transcript).")

        let pasteboard = NSPasteboard.general
        let originalPasteboardItems =
            pasteboard.pasteboardItems?.compactMap { item -> NSPasteboardItem? in
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

        let originalChangeCount = pasteboard.changeCount  // Save change count to detect external modifications

        pasteboard.clearContents()
        let success = pasteboard.setString(transcript, forType: .string)

        if !success {
            logToStderr("[AccessibilityService] Failed to set string on pasteboard.")
            // Restore original content before returning
            restorePasteboard(
                pasteboard: pasteboard, items: originalPasteboardItems,
                originalChangeCount: originalChangeCount)
            return false
        }

        // Simulate Cmd+V using virtual key codes from Constants.swift
        let source = CGEventSource(stateID: .hidSystemState)

        let cmdDown = CGEvent(keyboardEventSource: source, virtualKey: VK_COMMAND, keyDown: true)
        cmdDown?.flags = .maskCommand

        let vDown = CGEvent(keyboardEventSource: source, virtualKey: VK_V, keyDown: true)
        vDown?.flags = .maskCommand  // Keep command flag for the V press as well

        let vUp = CGEvent(keyboardEventSource: source, virtualKey: VK_V, keyDown: false)
        vUp?.flags = .maskCommand

        let cmdUp = CGEvent(keyboardEventSource: source, virtualKey: VK_COMMAND, keyDown: false)
        // No flags needed for key up typically, or just .maskCommand if it was held

        if cmdDown == nil || vDown == nil || vUp == nil || cmdUp == nil {
            logToStderr("[AccessibilityService] Failed to create CGEvent for paste.")
            restorePasteboard(
                pasteboard: pasteboard, items: originalPasteboardItems,
                originalChangeCount: originalChangeCount)
            return false
        }

        let loc: CGEventTapLocation = .cgSessionEventTap

        cmdDown!.post(tap: loc)
        vDown!.post(tap: loc)
        vUp!.post(tap: loc)
        cmdUp!.post(tap: loc)

        logToStderr("[AccessibilityService] Paste keyboard events posted.")

        // Restore the original pasteboard content after a short delay
        // to allow the paste action to complete.
        DispatchQueue.main.asyncAfter(deadline: .now() + PASTE_RESTORE_DELAY_SECONDS) {
            self.restorePasteboard(
                pasteboard: pasteboard, items: originalPasteboardItems,
                originalChangeCount: originalChangeCount)
        }

        return true
    }

    private func restorePasteboard(
        pasteboard: NSPasteboard, items: [NSPasteboardItem], originalChangeCount: Int
    ) {
        // Only restore if our temporary content is still the active content on the pasteboard.
        // This means the changeCount should be exactly one greater than when we saved it,
        // indicating our setString operation was the last modification.
        if pasteboard.changeCount == originalChangeCount + 1 {
            pasteboard.clearContents()
            if !items.isEmpty {
                pasteboard.writeObjects(items)
            }
            logToStderr("[AccessibilityService] Original pasteboard content restored.")
        } else {
            // If changeCount is different, it means another app or the user has modified the pasteboard
            // after we set our transcript but before this restoration block was executed.
            // In this case, we should not interfere with the new pasteboard content.
            logToStderr(
                "[AccessibilityService] Pasteboard changed by another process or a new copy occurred (expected changeCount: \(originalChangeCount + 1), current: \(pasteboard.changeCount)); not restoring original content to avoid conflict."
            )
        }
    }

    // Determines whether a keyboard event should be forwarded to the Electron application.
    // This method should be called from the CGEventTap callback in main.swift or RpcHandler.swift.
    public func shouldForwardKeyboardEvent(event: CGEvent) -> Bool {
        let type = event.type
        let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))

        // Uncomment for verbose logging from Swift helper:
        // logToStderr("[AccessibilityService] shouldForwardKeyboardEvent: type=\(type.rawValue), keyCode=\(keyCode), flags=\(event.flags.rawValue)")

        if type == .flagsChanged {
            // Always forward flagsChanged events. These are crucial for Electron to know
            // the state of modifier keys, including when the Fn key itself is pressed or released,
            // which is used to control recording.
            // logToStderr("[AccessibilityService] Forwarding flagsChanged event.")
            return true
        }

        if type == .keyDown || type == .keyUp {
            // For keyDown and keyUp events, only forward if the event is FOR THE Fn KEY ITSELF.
            if keyCode == VK_FUNCTION {
                // logToStderr("[AccessibilityService] Forwarding \(type == .keyDown ? "keyDown" : "keyUp") event because it IS the Fn key (keyCode: \(keyCode)).")
                return true
            } else {
                // logToStderr("[AccessibilityService] Suppressing \(type == .keyDown ? "keyDown" : "keyUp") event for keyCode \(keyCode) because it is NOT the Fn key.")
                return false
            }
        }

        // For any other event types (e.g., mouse events, system-defined), don't forward by default.
        // logToStderr("[AccessibilityService] Suppressing event of unhandled type: \(type.rawValue).")
        return false
    }
}
