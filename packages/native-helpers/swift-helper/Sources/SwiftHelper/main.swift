import CoreGraphics
import Foundation

// Import the generated models
// Note: We'll manually create the proper HelperEvent structure since quicktype doesn't handle discriminated unions well

// Define the proper event structures that match the TypeScript schemas
struct KeyEventPayload: Codable {
    let key: String?
    let code: String?
    let altKey: Bool?
    let ctrlKey: Bool?
    let shiftKey: Bool?
    let metaKey: Bool?
    let keyCode: Int?
    let fnKeyPressed: Bool?
}

struct HelperEvent: Codable {
    let type: String
    let payload: KeyEventPayload
    let timestamp: String?

    init(type: String, payload: KeyEventPayload, timestamp: String? = nil) {
        self.type = type
        self.payload = payload
        self.timestamp = timestamp
    }
}

// Function to handle the event tap
func eventTapCallback(
    proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard let refcon = refcon else {
        return Unmanaged.passRetained(event)
    }
    let anInstance = Unmanaged<SwiftHelper>.fromOpaque(refcon).takeUnretainedValue()

    if type == .keyDown || type == .keyUp {
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        let eventTypeString = (type == .keyDown) ? "keyDown" : "keyUp"

        // Create the proper payload structure
        let payload = KeyEventPayload(
            key: nil,  // We could map keyCode to key string if needed
            code: nil,  // We could map keyCode to code string if needed
            altKey: event.flags.contains(.maskAlternate),
            ctrlKey: event.flags.contains(.maskControl),
            shiftKey: event.flags.contains(.maskShift),
            metaKey: event.flags.contains(.maskCommand),
            keyCode: Int(keyCode),
            fnKeyPressed: event.flags.contains(.maskSecondaryFn)
        )

        let helperEvent = HelperEvent(
            type: eventTypeString,
            payload: payload,
            timestamp: ISO8601DateFormatter().string(from: Date())
        )

        anInstance.sendKeyEvent(helperEvent)
    } else if type == .flagsChanged {
        // Handle flags changed events (like Fn key press/release)
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)

        let payload = KeyEventPayload(
            key: nil,
            code: nil,
            altKey: event.flags.contains(.maskAlternate),
            ctrlKey: event.flags.contains(.maskControl),
            shiftKey: event.flags.contains(.maskShift),
            metaKey: event.flags.contains(.maskCommand),
            keyCode: Int(keyCode),
            fnKeyPressed: event.flags.contains(.maskSecondaryFn)
        )

        let helperEvent = HelperEvent(
            type: "flagsChanged",
            payload: payload,
            timestamp: ISO8601DateFormatter().string(from: Date())
        )

        anInstance.sendKeyEvent(helperEvent)
    } else if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        // Re-enable the tap if it times out or is disabled by user input
        if let tap = anInstance.eventTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
    }

    return Unmanaged.passRetained(event)
}

class SwiftHelper {
    var eventTap: CFMachPort?
    let outputPipe = Pipe()
    let errorPipe = Pipe()  // For logging errors from the helper

    init() {
        // Redirect stdout to the pipe for IPC
        // dup2(outputPipe.fileHandleForWriting.fileDescriptor, STDOUT_FILENO)
        // For debugging, you might want to print to stderr of the helper itself
        // dup2(errorPipe.fileHandleForWriting.fileDescriptor, STDERR_FILENO)
    }

    func sendKeyEvent(_ eventData: HelperEvent) {
        let encoder = JSONEncoder()
        do {
            let jsonData = try encoder.encode(eventData)
            if let jsonString = String(data: jsonData, encoding: .utf8) {
                // Print to stdout, which will be captured by the Electron process
                print(jsonString)
                fflush(stdout)  // Ensure the output is sent immediately
            }
        } catch {
            // Log errors to the helper's stderr
            let errorMsg = "Error encoding HelperEvent: \(error)\n"
            if let data = errorMsg.data(using: .utf8) {
                FileHandle.standardError.write(data)
            }
        }
    }

    func checkAccessibilityPermission() -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    func attemptEventTapCreation() {
        // Don't recreate if already exists
        guard eventTap == nil else {
            return
        }

        // Check accessibility permission before attempting
        guard checkAccessibilityPermission() else {
            FileHandle.standardError.write("Accessibility permission not granted. Event tap disabled. RPC methods still available.\n".data(using: .utf8)!)
            return
        }

        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        let eventMask =
            (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)
            | (1 << CGEventType.flagsChanged.rawValue)

        if let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: CGEventMask(eventMask),
            callback: eventTapCallback,
            userInfo: selfPtr
        ) {
            self.eventTap = tap

            // Create a run loop source and add it to the current run loop
            let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
            CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)

            // Enable the event tap
            CGEvent.tapEnable(tap: tap, enable: true)

            FileHandle.standardError.write("Event tap created successfully. Keyboard monitoring active.\n".data(using: .utf8)!)
        } else {
            FileHandle.standardError.write("Failed to create event tap despite having permissions.\n".data(using: .utf8)!)
        }
    }

    func setupPermissionObserver() {
        // Observe accessibility permission changes
        DistributedNotificationCenter.default().addObserver(
            forName: NSNotification.Name("com.apple.accessibility.api"),
            object: nil,
            queue: .main
        ) { [weak self] _ in
            // Delay to allow permission change to propagate
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                self?.attemptEventTapCreation()
            }
        }
    }

    func start() {
        // Try to create event tap if permissions available
        attemptEventTapCreation()

        // Set up observer for permission changes
        setupPermissionObserver()

        // Keep the program running (works even without event tap)
        let startMsg = eventTap != nil
            ? "SwiftHelper started and listening for events...\n"
            : "SwiftHelper started in degraded mode (no accessibility permission). RPC methods available.\n"
        FileHandle.standardError.write(startMsg.data(using: .utf8)!)

        CFRunLoopRun()
    }

    deinit {
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
            // CFMachPortInvalidate(tap) // This might be needed for complete cleanup
            // CFRelease(tap) // And this
        }
        let endMsg = "SwiftHelper stopping.\n"
        if let data = endMsg.data(using: .utf8) {
            FileHandle.standardError.write(data)
        }
    }
}

// Create instances of both helpers
let swiftHelper = SwiftHelper()
let ioBridge = IOBridge(jsonEncoder: JSONEncoder(), jsonDecoder: JSONDecoder())

// Start RPC processing in a background thread
// Using .userInteractive QoS for high priority (reduces latency for audio muting)
DispatchQueue.global(qos: .userInteractive).async {
    FileHandle.standardError.write(
        "Starting IOBridge RPC processing in background thread...\n".data(using: .utf8)!)
    ioBridge.processRpcRequests()
}

// Start Swift helper in the main thread (this will run the main run loop)
FileHandle.standardError.write("Starting SwiftHelper in main thread...\n".data(using: .utf8)!)
swiftHelper.start()
