import Foundation
import CoreGraphics

// Define a struct for the key event data
struct KeyEventData: Codable {
    let keyCode: CGKeyCode
    let eventType: String // "keyDown" or "keyUp"
    // Add other relevant data like modifiers if needed
    // let flags: CGEventFlags
}

// Function to handle the event tap
func eventTapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    guard let refcon = refcon else {
        return Unmanaged.passRetained(event)
    }
    let anInstance = Unmanaged<KeyTapHelper>.fromOpaque(refcon).takeUnretainedValue()

    if type == .keyDown || type == .keyUp {
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        let eventTypeString = (type == .keyDown) ? "keyDown" : "keyUp"

        let keyEvent = KeyEventData(keyCode: CGKeyCode(keyCode), eventType: eventTypeString)

        anInstance.sendKeyEvent(keyEvent)
    } else if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        // Re-enable the tap if it times out or is disabled by user input
        if let tap = anInstance.eventTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
    }

    return Unmanaged.passRetained(event)
}

class KeyTapHelper {
    var eventTap: CFMachPort?
    let outputPipe = Pipe()
    let errorPipe = Pipe() // For logging errors from the helper

    init() {
        // Redirect stdout to the pipe for IPC
        // dup2(outputPipe.fileHandleForWriting.fileDescriptor, STDOUT_FILENO)
        // For debugging, you might want to print to stderr of the helper itself
        // dup2(errorPipe.fileHandleForWriting.fileDescriptor, STDERR_FILENO)
    }

    func sendKeyEvent(_ eventData: KeyEventData) {
        let encoder = JSONEncoder()
        do {
            let jsonData = try encoder.encode(eventData)
            if let jsonString = String(data: jsonData, encoding: .utf8) {
                // Print to stdout, which will be captured by the Electron process
                print(jsonString)
                fflush(stdout) // Ensure the output is sent immediately
            }
        } catch {
            // Log errors to the helper's stderr
            let errorMsg = "Error encoding KeyEventData: \(error)\n"
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
        // We want to listen to keyDown and keyUp events.
        let eventMask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)

        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap, // Tap all events in the current session
            place: .headInsertEventTap, // Insert the tap at the head of the event tap list
            options: .defaultTap, // Default options
            eventsOfInterest: CGEventMask(eventMask),
            callback: eventTapCallback,
            userInfo: selfPtr // Pass a pointer to the KeyTapHelper instance
        ) else {
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
        let startMsg = "KeyTapHelper started and listening for events...\n"
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
        let endMsg = "KeyTapHelper stopping.\n"
        if let data = endMsg.data(using: .utf8) {
            FileHandle.standardError.write(data)
        }
    }
}

// Create an instance of the helper and start it.
let helper = KeyTapHelper()
helper.start()
