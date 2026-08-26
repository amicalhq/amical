import Foundation
import ObjCExceptionCatcher

/// Flexible RPC request that can parse any method string
struct FlexibleRPCRequest: Codable {
    let id: String
    let method: String
    let params: JSONAny?
}

enum RPCDispatchFailure: Swift.Error {
    case invalidParams(data: Data?, message: String)
    case internalError(data: Data?, message: String)

    var code: Int {
        switch self {
        case .invalidParams:
            return -32602
        case .internalError:
            return -32603
        }
    }

    var data: Data? {
        switch self {
        case .invalidParams(let data, _), .internalError(let data, _):
            return data
        }
    }

    var message: String {
        switch self {
        case .invalidParams(_, let message), .internalError(_, let message):
            return message
        }
    }
}

enum RPCResponseExecutor {
    static func execute(
        id: String,
        operation: () async throws -> JSONAny?
    ) async -> RPCResponseSchema {
        do {
            return RPCResponseSchema(error: nil, id: id, result: try await operation())
        } catch let failure as RPCDispatchFailure {
            let error = Error(
                code: failure.code,
                data: failure.data.flatMap {
                    try? JSONDecoder().decode(JSONAny.self, from: $0)
                },
                message: failure.message
            )
            return RPCResponseSchema(error: error, id: id, result: nil)
        } catch {
            let payload = Error(
                code: -32603,
                data: nil,
                message: "Internal error: \(error.localizedDescription)"
            )
            return RPCResponseSchema(error: payload, id: id, result: nil)
        }
    }
}

class IOBridge: NSObject {
    private let accessibilityService: AccessibilityService
    private let recordingAmbianceController: RecordingAmbianceController
    // Copy capture polls the pasteboard for up to the capture timeout; it
    // touches no AX state, so it gets its own serial queue instead of
    // blocking AccessibilityQueue (and the AX context requests behind it).
    private let copyCaptureQueue = DispatchQueue(label: "com.amical.helper.copy-capture")

    override init() {
        let accessibilityService = AccessibilityService()
        let audioService = AudioService()  // Audio preloaded here at startup
        self.accessibilityService = accessibilityService
        self.recordingAmbianceController = RecordingAmbianceController(
            playSound: { try await audioService.playSound(named: $0) },
            muteSystemAudio: { accessibilityService.muteSystemAudio() },
            restoreSystemAudio: { accessibilityService.restoreSystemAudio() },
            log: { HelperLogger.logToStderr($0) }
        )
        super.init()
    }

    private func logToStderr(_ message: String) {
        HelperLogger.logToStderr(message)
    }

    func handleRpcRequest(_ request: RPCRequestSchema) async {
        let response = await RPCResponseExecutor.execute(id: request.id) { [self] in
            try await dispatchRpcRequest(request)
        }
        sendRpcResponse(response)
    }

    private func dispatchRpcRequest(_ request: RPCRequestSchema) async throws -> JSONAny? {
        switch request.method {
        case .getAccessibilityTreeDetails:
            return try encodeResult(try await handleAccessibilityTreeDetails(request))

        case .getAccessibilityContext:
            return try encodeResult(
                try await handleGetAccessibilityContext(params: request.params))

        case .getAccessibilityStatus:
            logToStderr("[IOBridge] Handling getAccessibilityStatus for ID: \(request.id)")
            return try encodeResult(AccessibilityContextService.getAccessibilityStatus())

        case .requestAccessibilityPermission:
            logToStderr(
                "[IOBridge] Handling requestAccessibilityPermission for ID: \(request.id)")
            return try encodeResult(AccessibilityContextService.requestAccessibilityPermission())

        case .pasteText:
            return try encodeResult(try await handlePasteText(request))

        case .startRecording:
            return try encodeResult(try await handleStartRecording(request))

        case .stopRecording:
            return try encodeResult(try await handleStopRecording(request))

        case .setShortcuts:
            return try encodeResult(try handleSetShortcuts(request))

        case .setDraftEnterCapture:
            return try encodeResult(try handleSetDraftEnterCapture(request))

        case .setAllowInjectedKeys:
            return try encodeResult(try handleSetAllowInjectedKeys(request))

        case .recheckPressedKeys:
            return try encodeResult(try handleRecheckPressedKeys(request))

        case .getSelectedTextViaCopy:
            return try encodeResult(try await handleGetSelectedTextViaCopy(request))

        }
    }

    private func handleAccessibilityTreeDetails(
        _ request: RPCRequestSchema
    ) async throws -> GetAccessibilityTreeDetailsResultSchema {
        logToStderr("[IOBridge] Handling getAccessibilityTreeDetails for ID: \(request.id)")
        let params: GetAccessibilityTreeDetailsParamsSchema? = try decodeOptionalParams(
            request.params,
            method: "getAccessibilityTreeDetails"
        )

        return try await AccessibilityQueue.shared.perform { [self] in
            switch ExceptionCatcher.try({
                self.accessibilityService.fetchFullAccessibilityTree(rootId: params?.rootID)
            }) {
            case .success(let tree):
                var treeAsJSON: JSONAny?
                if let tree {
                    treeAsJSON = try self.encodeResult(tree)
                }
                return GetAccessibilityTreeDetailsResultSchema(tree: treeAsJSON)

            case .exception(let exception):
                throw RPCDispatchFailure.internalError(
                    data: self.exceptionData(exception),
                    message: "\(exception.name): \(exception.reason)"
                )
            }
        }
    }

    private func handleGetAccessibilityContext(
        params: JSONAny?
    ) async throws -> GetAccessibilityContextResult {
        logToStderr("[IOBridge] Handling getAccessibilityContext")
        let decoded: GetAccessibilityContextParams? = try decodeOptionalParams(
            params,
            method: "getAccessibilityContext"
        )
        let editableOnly = decoded?.editableOnly ?? false

        return try await AccessibilityQueue.shared.perform {
            switch ExceptionCatcher.try({
                AccessibilityContextService.getAccessibilityContext(editableOnly: editableOnly)
            }) {
            case .success(let context):
                return GetAccessibilityContextResult(context: context)

            case .exception(let exception):
                throw RPCDispatchFailure.internalError(
                    data: nil,
                    message: "\(exception.name): \(exception.reason)"
                )
            }
        }
    }

    private func handlePasteText(
        _ request: RPCRequestSchema
    ) async throws -> PasteTextResultSchema {
        logToStderr("[IOBridge] Handling pasteText for ID: \(request.id)")
        let params: PasteTextParamsSchema = try decodeRequiredParams(
            request.params,
            method: "pasteText"
        )

        return try await performOnCopyCaptureQueue { [self] in
            let preserveClipboard = params.preserveClipboard ?? true
            let success = accessibilityService.pasteText(
                transcript: params.transcript,
                preserveClipboard: preserveClipboard
            )
            return PasteTextResultSchema(
                message: success ? "Pasted successfully" : "Paste failed",
                success: success
            )
        }
    }

    private func handleStartRecording(
        _ request: RPCRequestSchema
    ) async throws -> StartRecordingResultSchema {
        logToStderr("[IOBridge] Handling startRecording for ID: \(request.id)")
        let params: StartRecordingParamsSchema = try decodeRequiredParams(
            request.params,
            method: "startRecording"
        )

        let success = await recordingAmbianceController.startRecording(
            muteSystemAudio: params.muteSystemAudio,
            muteSounds: params.muteSounds == true
        )

        return StartRecordingResultSchema(
            message: success ? "Recording started" : "Failed to mute system audio",
            success: success
        )
    }

    private func handleStopRecording(
        _ request: RPCRequestSchema
    ) async throws -> StopRecordingResultSchema {
        logToStderr("[IOBridge] Handling stopRecording for ID: \(request.id)")
        let params: StopRecordingParamsSchema = try decodeRequiredParams(
            request.params,
            method: "stopRecording"
        )

        let success = await recordingAmbianceController.stopRecording(
            wasMuted: params.wasMuted,
            muteSounds: params.muteSounds == true
        )

        return StopRecordingResultSchema(
            message: success ? "Recording stopped" : "Failed to restore system audio",
            success: success
        )
    }

    private func handleSetShortcuts(
        _ request: RPCRequestSchema
    ) throws -> SetShortcutsResultSchema {
        logToStderr("[IOBridge] Handling setShortcuts for ID: \(request.id)")
        let params: SetShortcutsParamsSchema = try decodeRequiredParams(
            request.params,
            method: "setShortcuts"
        )
        ShortcutManager.shared.setShortcuts(
            subsetChords: params.subsetChords,
            exactChords: params.exactChords
        )
        return SetShortcutsResultSchema(success: true)
    }

    private func handleSetDraftEnterCapture(
        _ request: RPCRequestSchema
    ) throws -> SetDraftEnterCaptureResultSchema {
        logToStderr("[IOBridge] Handling setDraftEnterCapture for ID: \(request.id)")
        let params: SetDraftEnterCaptureParamsSchema = try decodeRequiredParams(
            request.params,
            method: "setDraftEnterCapture"
        )
        ShortcutManager.shared.setDraftEnterCapture(params.enabled)
        return SetDraftEnterCaptureResultSchema(success: true)
    }

    private func handleSetAllowInjectedKeys(
        _ request: RPCRequestSchema
    ) throws -> SetAllowInjectedKeysResultSchema {
        logToStderr(
            "[IOBridge] Handling setAllowInjectedKeys (no-op on macOS) for ID: \(request.id)")
        let _: SetAllowInjectedKeysParamsSchema = try decodeRequiredParams(
            request.params,
            method: "setAllowInjectedKeys"
        )
        return SetAllowInjectedKeysResultSchema(success: true)
    }

    private func handleRecheckPressedKeys(
        _ request: RPCRequestSchema
    ) throws -> RecheckPressedKeysResultSchema {
        logToStderr("[IOBridge] Handling recheckPressedKeys for ID: \(request.id)")
        let params: RecheckPressedKeysParamsSchema = try decodeRequiredParams(
            request.params,
            method: "recheckPressedKeys"
        )
        let staleKeyCodes = ShortcutManager.shared.getStalePressedKeyCodes(
            params.pressedKeyCodes
        )
        return RecheckPressedKeysResultSchema(staleKeyCodes: staleKeyCodes)
    }

    private func handleGetSelectedTextViaCopy(
        _ request: RPCRequestSchema
    ) async throws -> GetSelectedTextViaCopyResultSchema {
        logToStderr("[IOBridge] Handling getSelectedTextViaCopy for ID: \(request.id)")
        return try await performOnCopyCaptureQueue { [self] in
            accessibilityService.getSelectedTextViaCopy()
        }
    }

    private func decodeRequiredParams<T: Decodable>(
        _ params: JSONAny?,
        method: String
    ) throws -> T {
        guard let params else {
            throw RPCDispatchFailure.invalidParams(
                data: nil,
                message: "Missing params for \(method)"
            )
        }
        var payload: Data?
        do {
            let data = try JSONEncoder().encode(params)
            payload = data
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw RPCDispatchFailure.invalidParams(
                data: payload,
                message: "Invalid params for \(method): \(error.localizedDescription)"
            )
        }
    }

    private func decodeOptionalParams<T: Decodable>(
        _ params: JSONAny?,
        method: String
    ) throws -> T? {
        guard let params else { return nil }
        var payload: Data?
        do {
            let data = try JSONEncoder().encode(params)
            payload = data
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw RPCDispatchFailure.invalidParams(
                data: payload,
                message: "Invalid params for \(method): \(error.localizedDescription)"
            )
        }
    }

    private func encodeResult<T: Encodable>(_ result: T) throws -> JSONAny {
        do {
            let data = try JSONEncoder().encode(result)
            return try JSONDecoder().decode(JSONAny.self, from: data)
        } catch {
            throw RPCDispatchFailure.internalError(
                data: nil,
                message: "Error encoding result: \(error.localizedDescription)"
            )
        }
    }

    private func performOnCopyCaptureQueue<T>(
        _ operation: @escaping () throws -> T
    ) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            copyCaptureQueue.async {
                do {
                    continuation.resume(returning: try operation())
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private func exceptionData(_ exception: CaughtException) -> Data? {
        let payload: [String: Any] = [
            "name": exception.name,
            "reason": exception.reason,
            "callStack": exception.callStack.prefix(10).joined(separator: "\n"),
        ]
        return try? JSONSerialization.data(withJSONObject: payload)
    }

    private func sendRpcResponse(_ response: RPCResponseSchema) {
        do {
            let responseData = try JSONEncoder().encode(response)
            if let responseString = String(data: responseData, encoding: .utf8) {
                logToStderr("[Swift Biz Logic] FINAL JSON RESPONSE to stdout: \(responseString)")
                StdoutWriter.writeLine(responseString)
            }
        } catch {
            logToStderr("Error encoding RpcResponse: \(error.localizedDescription)")
        }
    }

    // Main loop for processing RPC requests from stdin
    func processRpcRequests() {
        logToStderr("IOBridge: Starting RPC request processing loop.")
        while let line = readLine(strippingNewline: true) {
            guard !line.isEmpty, let data = line.data(using: .utf8) else {
                logToStderr("Warning: Received empty or non-UTF8 line on stdin.")
                continue
            }

            do {
                let request = try JSONDecoder().decode(RPCRequestSchema.self, from: data)
                logToStderr(
                    "IOBridge: Received RPC Request ID \(request.id), Method: \(request.method)"
                )
                Task(priority: .high) { [self] in
                    await handleRpcRequest(request)
                }
            } catch {
                logToStderr(
                    "Error decoding RpcRequest from stdin: \(error.localizedDescription). Line: \(line)"
                )
            }
        }
        logToStderr("IOBridge: RPC request processing loop finished (stdin closed).")
    }
}
