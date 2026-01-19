import Foundation

// =============================================================================
// Accessibility Builders
// =============================================================================
// Builder pattern helpers for creating accessibility response types.
// These use the auto-generated types from models/generated/models.swift.
// =============================================================================

// MARK: - Type Aliases for Backward Compatibility

/// Maps to the generated `Context` type (AppContext in TypeScript)
typealias AppContext = Context

/// Maps to the generated `Application` type (ApplicationInfo in TypeScript)
typealias ApplicationInfo = Application

/// Maps to the generated `FocusedElement` type (AXElementInfo in TypeScript)
typealias AXElementInfo = FocusedElement

/// Maps to the generated `Metrics` type (ExtractionMetrics in TypeScript)
typealias ExtractionMetrics = Metrics

/// Maps to the generated `The0` enum (ExtractionMethod in TypeScript)
typealias ExtractionMethod = The0

/// Maps to the generated `SelectionRange` type (same name)
typealias AccessibilitySelectionRange = SelectionRange

/// Maps to the generated `TextSelection` type (same name)
typealias AccessibilityTextSelection = TextSelection

/// Maps to the generated `WindowInfo` type (same name)
typealias AccessibilityWindowInfo = WindowInfo

/// Maps to the generated params type
typealias GetAccessibilityContextParams = GetAccessibilityContextParamsSchema

/// Maps to the generated result type
typealias GetAccessibilityContextResult = GetAccessibilityContextResultSchema

// MARK: - Result Types for Other Methods

/// Response result for getAccessibilityStatus
struct GetAccessibilityStatusResult: Codable {
    /// Does the app have accessibility permission?
    let hasPermission: Bool
    /// Is accessibility enabled system-wide?
    let isEnabled: Bool
}

/// Response result for requestAccessibilityPermission
struct RequestAccessibilityPermissionResult: Codable {
    /// Was permission granted?
    let granted: Bool
}

// MARK: - Builder for TextSelection

/// Builder for creating TextSelection with proper defaults
class TextSelectionBuilder {
    var selectedText: String? = nil
    var fullContent: String? = nil
    var preSelectionText: String? = nil
    var postSelectionText: String? = nil
    var selectionRange: SelectionRange? = nil
    var isEditable: Bool = false
    var extractionMethod: ExtractionMethod = .none
    var hasMultipleRanges: Bool = false
    var isPlaceholder: Bool = false
    var isSecure: Bool = false
    var fullContentTruncated: Bool = false

    func build() -> TextSelection {
        return TextSelection(
            extractionMethod: extractionMethod,
            fullContent: fullContent,
            fullContentTruncated: fullContentTruncated,
            hasMultipleRanges: hasMultipleRanges,
            isEditable: isEditable,
            isPlaceholder: isPlaceholder,
            isSecure: isSecure,
            postSelectionText: postSelectionText,
            preSelectionText: preSelectionText,
            selectedText: selectedText,
            selectionRange: selectionRange
        )
    }

    /// Create a secure field result (all content fields suppressed)
    static func secureField(isEditable: Bool) -> TextSelection {
        return TextSelection(
            extractionMethod: .none,
            fullContent: nil,
            fullContentTruncated: false,
            hasMultipleRanges: false,
            isEditable: isEditable,
            isPlaceholder: false,
            isSecure: true,
            postSelectionText: nil,
            preSelectionText: nil,
            selectedText: nil,
            selectionRange: nil  // Suppressed to prevent password length leakage
        )
    }
}

// MARK: - Builder for Metrics

/// Builder for creating Metrics
class ExtractionMetricsBuilder {
    private var startTime: CFAbsoluteTime
    var textMarkerAttempted: Bool = false
    var textMarkerSucceeded: Bool = false
    var fallbacksUsed: [ExtractionMethod] = []
    var errors: [String] = []
    var timedOut: Bool = false

    // WebArea retry path metrics
    var webAreaRetryAttempted: Bool = false
    var webAreaFound: Bool = false
    var webAreaRetrySucceeded: Bool = false

    init() {
        self.startTime = CFAbsoluteTimeGetCurrent()
    }

    func recordFallback(_ method: ExtractionMethod) {
        fallbacksUsed.append(method)
    }

    func recordError(_ message: String) {
        // Ensure no PII in error messages
        errors.append(message)
    }

    func build() -> Metrics {
        let endTime = CFAbsoluteTimeGetCurrent()
        let totalTimeMs = (endTime - startTime) * 1000

        // Set timedOut flag if we exceeded best-effort timeout (per spec)
        let didTimeout = totalTimeMs > EXTRACTION_TIMEOUT_MS

        return Metrics(
            errors: errors,
            fallbacksUsed: fallbacksUsed,
            textMarkerAttempted: textMarkerAttempted,
            textMarkerSucceeded: textMarkerSucceeded,
            timedOut: didTimeout,
            totalTimeMS: totalTimeMs,
            webAreaFound: webAreaFound,
            webAreaRetryAttempted: webAreaRetryAttempted,
            webAreaRetrySucceeded: webAreaRetrySucceeded
        )
    }
}
