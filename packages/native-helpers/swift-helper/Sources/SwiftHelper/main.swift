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

    func start() {
        // The Unmanaged.passUnretained(self).toOpaque() passes a reference to self
        // to the callback, so it can call instance methods.
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()

        // Create an event tap.
        // We want to listen to keyDown, keyUp, and flagsChanged events.
        let eventMask =
            (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)
            | (1 << CGEventType.flagsChanged.rawValue)

        guard
            let tap = CGEvent.tapCreate(
                tap: .cgSessionEventTap,  // Tap all events in the current session
                place: .headInsertEventTap,  // Insert the tap at the head of the event tap list
                options: .defaultTap,  // Default options
                eventsOfInterest: CGEventMask(eventMask),
                callback: eventTapCallback,
                userInfo: selfPtr  // Pass a pointer to the SwiftHelper instance
            )
        else {
            let errorMsg = "Failed to create event tap\n"
            if let data = errorMsg.data(using: .utf8) {
                FileHandle.standardError.write(data)
            }
            exit(1)
        }

        self.eventTap = tap

        // Create a run loop source and add it to the current run loop.
        let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)

        // Enable the event tap.
        CGEvent.tapEnable(tap: tap, enable: true)

        // Keep the program running.
        // This will also print a message to stderr if the helper starts
        let startMsg = "SwiftHelper started and listening for events...\n"
        if let data = startMsg.data(using: .utf8) {
            FileHandle.standardError.write(data)
        }
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
DispatchQueue.global(qos: .userInitiated).async {
    FileHandle.standardError.write(
        "Starting IOBridge RPC processing in background thread...\n".data(using: .utf8)!)
    ioBridge.processRpcRequests()
}

// Start Swift helper in the main thread (this will run the main run loop)
FileHandle.standardError.write("Starting SwiftHelper in main thread...\n".data(using: .utf8)!)
swiftHelper.start()
