import Foundation
import ApplicationServices
import AppKit

// =============================================================================
// EditWatchService - Hold one text element and read it on request
// =============================================================================
// startEditWatch resolves the focused editable element once and keeps it.
// readEditWatch answers with the element's whole value and selection.
// stopEditWatch (or the next start) releases it. No timers, no comparison.
//
// Privacy rule: the value read here never reaches a log. Callers log only
// status, text length and timing.
// =============================================================================

/// Serves the three edit watch RPCs over a single held element
final class EditWatchService {

    /// Longest value (UTF-16 code units) a read returns; matches EDIT_WATCH_LIMITS.maxTextLength
    private static let maxTextLength = 8000

    /// Per-call accessibility messaging timeout for the held element (seconds)
    private static let messagingTimeoutSeconds: Float = 0.5

    // The watch gets its own serial queue: it must not wait behind a slow
    // context read on AccessibilityQueue or the copy-capture busy wait, and
    // the main thread runs the event tap.
    private let queue = DispatchQueue(
        label: "com.amical.helper.edit-watch",
        qos: .userInitiated,
        autoreleaseFrequency: .workItem
    )

    // Only touched on `queue`.
    private var watchID: String?
    private var element: AXUIElement?
    /// The last placeholder answer and the text it was for (see readValue).
    private var placeholderCheck: (text: String, showing: Bool)?

    private enum Resolution {
        case hold(AXUIElement)
        case rejected(StartStatus)
    }

    private struct ReadOutcome {
        let status: ReadStatus
        var text: String? = nil
        var selection: Selection? = nil
    }

    // MARK: - RPC entry points

    func start() async throws -> StartEditWatchResultSchema {
        try await perform { [self] in
            switch try Self.catchingExceptions({ Self.resolveElement() }) {
            case .hold(let element):
                _ = AXUIElementSetMessagingTimeout(element, Self.messagingTimeoutSeconds)
                let id = UUID().uuidString
                self.watchID = id
                self.element = element
                self.placeholderCheck = nil
                return StartEditWatchResultSchema(startStatus: .ok, watchID: id)

            case .rejected(let status):
                return StartEditWatchResultSchema(startStatus: status, watchID: nil)
            }
        }
    }

    func read(watchID: String) async throws -> ReadEditWatchResultSchema {
        try await perform { [self] in
            guard watchID == self.watchID, let element else {
                return ReadEditWatchResultSchema(
                    readMS: 0, readStatus: .unknownWatch, selection: nil, text: nil)
            }

            let startedAt = CFAbsoluteTimeGetCurrent()
            let outcome =
                (try? Self.catchingExceptions {
                    Self.readValue(of: element) { text in
                        self.placeholderShowing(element, text)
                    }
                })
                ?? ReadOutcome(status: .error)
            let readMS = (CFAbsoluteTimeGetCurrent() - startedAt) * 1000

            return ReadEditWatchResultSchema(
                readMS: readMS,
                readStatus: outcome.status,
                selection: outcome.selection,
                text: outcome.text
            )
        }
    }

    func stop(watchID: String) async throws -> StopEditWatchResultSchema {
        try await perform { [self] in
            guard watchID == self.watchID else {
                return StopEditWatchResultSchema(stopped: false)
            }
            self.watchID = nil
            self.element = nil
            self.placeholderCheck = nil
            return StopEditWatchResultSchema(stopped: true)
        }
    }

    /// The placeholder check walks part of the element's subtree (dozens of AX
    /// calls answered by the target app). Most reads see unchanged text, so
    /// the answer is kept until the text changes.
    private func placeholderShowing(_ element: AXUIElement, _ text: String) -> Bool {
        if let check = placeholderCheck, check.text == text {
            return check.showing
        }
        let showing = AXHelpers.isPlaceholderShowing(
            element, value: text, childTimeout: Self.messagingTimeoutSeconds)
        placeholderCheck = (text, showing)
        return showing
    }

    // MARK: - Accessibility work

    private static func resolveElement() -> Resolution {
        guard PermissionsService.checkPermissions() else {
            return .rejected(.noPermission)
        }

        let pid = AXHelpers.getFrontProcessID()
        guard pid > 0, let focused = FocusService.getFocusedElement(pid: pid) else {
            return .rejected(.noElement)
        }

        // getFocusedElement falls back to the focused window when nothing has
        // focus; a search from there would pick an arbitrary field.
        guard AXHelpers.getRole(focused) != kAXWindowRole else {
            return .rejected(.noElement)
        }

        guard let found = FocusService.findTextCapableElement(from: focused, editableOnly: true)
        else {
            return .rejected(.noElement)
        }

        var element = found.element
        if AXHelpers.isSecureField(element) {
            return .rejected(.secure)
        }

        var text = copyValue(of: element).text
        if text == nil, let deeper = AXHelpers.findDeepestTextElement(from: element) {
            if AXHelpers.isSecureField(deeper) {
                return .rejected(.secure)
            }
            element = deeper
            text = copyValue(of: deeper).text
        }

        guard let text else {
            return .rejected(.noValue)
        }
        if text.utf16.count > maxTextLength {
            return .rejected(.tooLong)
        }
        return .hold(element)
    }

    private static func readValue(
        of element: AXUIElement,
        placeholderShowing: (String) -> Bool
    ) -> ReadOutcome {
        let (error, text) = copyValue(of: element)
        if error == .invalidUIElement {
            return ReadOutcome(status: .gone)
        }
        guard let text else {
            return ReadOutcome(status: .error)
        }
        if text.utf16.count > maxTextLength {
            return ReadOutcome(status: .tooLong)
        }

        var selection: Selection? = nil
        if let range = AXHelpers.getSelectedTextRange(element),
            range.location >= 0, range.length >= 0
        {
            selection = Selection(length: range.length, location: range.location)
        }

        // A field that shows its placeholder is empty. The check only matters
        // when a value is present (web editors leak the placeholder in as the
        // value), and never when the user has a real selection.
        if !text.isEmpty, (selection?.length ?? 0) == 0, placeholderShowing(text) {
            return ReadOutcome(status: .ok, text: "", selection: nil)
        }
        return ReadOutcome(status: .ok, text: text, selection: selection)
    }

    private static func copyValue(of element: AXUIElement) -> (error: AXError, text: String?) {
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value)
        return (error, error == .success ? value as? String : nil)
    }

    // MARK: - Plumbing

    /// Runs accessibility work inside the NSException catcher; an exception becomes an RPC error.
    private static func catchingExceptions<T>(_ work: @escaping () -> T) throws -> T {
        switch ExceptionCatcher.try({ work() }) {
        case .success(let value?):
            return value
        case .success(nil):
            throw RPCDispatchFailure.internalError(data: nil, message: "Accessibility call returned no result")
        case .exception(let exception):
            throw RPCDispatchFailure.internalError(
                data: nil,
                message: "\(exception.name): \(exception.reason)"
            )
        }
    }

    private func perform<T>(_ operation: @escaping () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                do {
                    continuation.resume(returning: try operation())
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
}
