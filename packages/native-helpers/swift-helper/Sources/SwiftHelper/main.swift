import ApplicationServices
import CoreGraphics
import Foundation

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
        StdoutWriter.writeEvent(eventData)
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
            HelperLogger.logRawToStderr(
                "Accessibility permission not granted. Event tap disabled. RPC methods still available.\n"
            )
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

            HelperLogger.logRawToStderr(
                "Event tap created successfully. Keyboard monitoring active.\n"
            )
        } else {
            HelperLogger.logRawToStderr(
                "Failed to create event tap despite having permissions.\n"
            )
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
        HelperLogger.logRawToStderr(startMsg)

        CFRunLoopRun()
    }

    deinit {
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
            // CFMachPortInvalidate(tap) // This might be needed for complete cleanup
            // CFRelease(tap) // And this
        }
        let endMsg = "SwiftHelper stopping.\n"
        HelperLogger.logRawToStderr(endMsg)
    }
}

// Create instances of both helpers
let swiftHelper = SwiftHelper()
let ioBridge = IOBridge(jsonEncoder: JSONEncoder(), jsonDecoder: JSONDecoder())

// Start RPC processing in a background thread
// Using .userInteractive QoS for high priority (reduces latency for audio muting)
DispatchQueue.global(qos: .userInteractive).async {
    HelperLogger.logRawToStderr("Starting IOBridge RPC processing in background thread...\n")
    ioBridge.processRpcRequests()
}

// Start Swift helper in the main thread (this will run the main run loop)
HelperLogger.logRawToStderr("Starting SwiftHelper in main thread...\n")
swiftHelper.start()
