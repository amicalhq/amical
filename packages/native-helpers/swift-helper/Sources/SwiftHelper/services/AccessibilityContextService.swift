import Foundation
import ApplicationServices
import AppKit

// =============================================================================
// AccessibilityContextService - Main Entry Point for Accessibility API
// =============================================================================
// Coordinates all services to extract accessibility context.
// This is the main entry point called from RpcHandler.
// =============================================================================

/// Main service for accessibility context extraction
class AccessibilityContextService {

    // MARK: - Main API

    /// Get accessibility context using the extraction algorithm
    /// - Parameter editableOnly: Only return text selection if element is editable (default: false per spec)
    /// - Returns: AppContext with all accessibility context, or nil if unavailable
    static func getAccessibilityContext(editableOnly: Bool = false) -> AppContext? {
        // Start metrics tracking
        let metricsBuilder = ExtractionMetricsBuilder()

        // Check permissions
        guard PermissionsService.checkPermissions() else {
            logError("Accessibility permissions not granted")
            return nil
        }

        // Get frontmost application
        let pid = AXHelpers.getFrontProcessID()
        guard pid > 0 else {
            logError("Could not get frontmost application PID")
            return nil
        }

        // Build application info (arguments in alphabetical order per generated types)
        let applicationInfo = ApplicationInfo(
            bundleIdentifier: AXHelpers.getBundleIdentifier(pid: pid),
            name: AXHelpers.getProcessName(pid: pid),
            pid: Int(pid),
            version: AXHelpers.getApplicationVersion(pid: pid)
        )

        // Get focused element
        var focusedElementInfo: AXElementInfo? = nil
        var textSelectionInfo: AccessibilityTextSelection? = nil

        if let focusedElement = FocusService.getFocusedElement(pid: pid) {
            // Touch descendants to ensure they're accessible (triggers lazy loading)
            AXHelpers.touchDescendants(focusedElement, maxDepth: TOUCH_DESCENDANTS_MAX_DEPTH)

            // Try to find a text-capable element
            if let focusResult = FocusService.findTextCapableElement(from: focusedElement, editableOnly: editableOnly) {
                focusedElementInfo = FocusService.getElementInfo(element: focusResult.element)

                // Extract text selection
                textSelectionInfo = SelectionExtractor.extract(from: focusResult.element, metricsBuilder: metricsBuilder)

                // Apply editableOnly filter
                if editableOnly {
                    if let selection = textSelectionInfo, !selection.isEditable {
                        textSelectionInfo = nil
                    }
                }
            } else {
                // No text-capable element found, but still get basic element info
                focusedElementInfo = FocusService.getElementInfo(element: focusedElement)
            }
        }

        // Get window info
        let windowInfo = FocusService.getWindowInfo(pid: pid)

        // Build metrics
        let metrics = metricsBuilder.build()

        // Build and return context (arguments in alphabetical order per generated types)
        return AppContext(
            application: applicationInfo,
            focusedElement: focusedElementInfo,
            metrics: metrics,
            schemaVersion: .the20,
            textSelection: textSelectionInfo,
            timestamp: Date().timeIntervalSince1970,
            windowInfo: windowInfo
        )
    }

    // MARK: - Permission APIs

    /// Get accessibility permission status
    static func getAccessibilityStatus() -> GetAccessibilityStatusResult {
        return PermissionsService.getStatus()
    }

    /// Request accessibility permission
    static func requestAccessibilityPermission() -> RequestAccessibilityPermissionResult {
        return PermissionsService.requestPermission()
    }

    // MARK: - Logging

    private static func logError(_ message: String) {
        FileHandle.standardError.write("❌ \(message)\n".data(using: .utf8)!)
    }

    private static func logDebug(_ message: String) {
        #if DEBUG
        FileHandle.standardError.write("🔍 \(message)\n".data(using: .utf8)!)
        #endif
    }
}
