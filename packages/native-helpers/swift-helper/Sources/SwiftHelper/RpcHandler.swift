import Foundation
import ObjCExceptionCatcher

/// Flexible RPC request that can parse any method string
struct FlexibleRPCRequest: Codable {
    let id: String
    let method: String
    let params: JSONAny?
}

class IOBridge: NSObject {
    let jsonEncoder: JSONEncoder
    let jsonDecoder: JSONDecoder
    private let accessibilityService: AccessibilityService
    private let audioService: AudioService
    let dateFormatter: DateFormatter

    init(jsonEncoder: JSONEncoder, jsonDecoder: JSONDecoder) {
        self.jsonEncoder = jsonEncoder
        self.jsonDecoder = jsonDecoder
        self.accessibilityService = AccessibilityService()
        self.audioService = AudioService()  // Audio preloaded here at startup
        self.dateFormatter = DateFormatter()
        self.dateFormatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        super.init()
    }

    private func logToStderr(_ message: String) {
        let timestamp = dateFormatter.string(from: Date())
        let logMessage = "[\(timestamp)] \(message)\n"
        FileHandle.standardError.write(logMessage.data(using: .utf8)!)
    }

    // Handles a single RPC Request
    func handleRpcRequest(_ request: RPCRequestSchema) {
        var rpcResponse: RPCResponseSchema

        switch request.method {
        case .getAccessibilityTreeDetails:
            // Process accessibility tree requests on dedicated thread
            AccessibilityQueue.shared.async { [weak self] in
                guard let self = self else { return }
                self.handleAccessibilityTreeDetails(request)
            }
            return

        case .getAccessibilityContext:
            // Process accessibility context requests on dedicated thread (uses v2 service)
            AccessibilityQueue.shared.async { [weak self] in
                guard let self = self else { return }
                self.handleGetAccessibilityContext(id: request.id, params: request.params)
            }
            return

        case .getAccessibilityStatus:
            handleGetAccessibilityStatus(id: request.id)
            return

        case .requestAccessibilityPermission:
            handleRequestAccessibilityPermission(id: request.id)
            return

        case .pasteText:
            logToStderr("[IOBridge] Handling pasteText for ID: \(request.id)")
            guard let paramsAnyCodable = request.params else {
                let errPayload = Error(
                    code: -32602, data: nil, message: "Missing params for pasteText")
                rpcResponse = RPCResponseSchema(error: errPayload, id: request.id, result: nil)
                sendRpcResponse(rpcResponse)
                return
            }

            do {
                let paramsData = try jsonEncoder.encode(paramsAnyCodable)
                // Corrected to use generated Swift model name from models.swift
                let pasteParams = try jsonDecoder.decode(
                    PasteTextParamsSchema.self, from: paramsData)
                logToStderr("[IOBridge] Decoded pasteParams.transcript for ID: \(request.id)")

                // Call the actual paste function (to be implemented in AccessibilityService or similar)
                let success = accessibilityService.pasteText(transcript: pasteParams.transcript)

                // Corrected to use generated Swift model name from models.swift
                let resultPayload = PasteTextResultSchema(
                    message: success ? "Pasted successfully" : "Paste failed", success: success)
                let resultData = try jsonEncoder.encode(resultPayload)
                let resultAsJsonAny = try jsonDecoder.decode(JSONAny.self, from: resultData)
                rpcResponse = RPCResponseSchema(error: nil, id: request.id, result: resultAsJsonAny)

            } catch {
                logToStderr(
                    "[IOBridge] Error processing pasteText params or operation: \(error.localizedDescription) for ID: \(request.id)"
                )
                let errPayload = Error(
                    code: -32602, data: request.params,
                    message: "Invalid params or error during paste: \(error.localizedDescription)")
                rpcResponse = RPCResponseSchema(error: errPayload, id: request.id, result: nil)
            }

        case .muteSystemAudio:
            logToStderr("[IOBridge] Handling muteSystemAudio for ID: \(request.id)")

            audioService.playSound(named: "rec-start") { [weak self] in
                guard let self = self else {
                    let timestamp = DateFormatter().string(from: Date())
                    let logMessage =
                        "[\(timestamp)] [IOBridge] self is nil in playSound completion for muteSystemAudio. ID: \(request.id)\n"
                    FileHandle.standardError.write(logMessage.data(using: .utf8)!)
                    return
                }

                self.logToStderr(
                    "[IOBridge] rec-start.mp3 finished playing successfully. Proceeding to mute system audio. ID: \(request.id)"
                )
                let success = self.accessibilityService.muteSystemAudio()
                let resultPayload = MuteSystemAudioResultSchema(
                    message: success ? "Mute command sent" : "Failed to send mute command",
                    success: success)

                var responseToSend: RPCResponseSchema
                do {
                    let resultData = try self.jsonEncoder.encode(resultPayload)
                    let resultAsJsonAny = try self.jsonDecoder.decode(
                        JSONAny.self, from: resultData)
                    responseToSend = RPCResponseSchema(
                        error: nil, id: request.id, result: resultAsJsonAny)
                } catch {
                    self.logToStderr(
                        "[IOBridge] Error encoding muteSystemAudio result: \(error.localizedDescription) for ID: \(request.id)"
                    )
                    let errPayload = Error(
                        code: -32603, data: nil,
                        message: "Error encoding result: \(error.localizedDescription)")
                    responseToSend = RPCResponseSchema(
                        error: errPayload, id: request.id, result: nil)
                }
                self.sendRpcResponse(responseToSend)
            }
            return

        case .restoreSystemAudio:
            logToStderr("[IOBridge] Handling restoreSystemAudio for ID: \(request.id)")

            let success = accessibilityService.restoreSystemAudio()
            if success {  // Play sound only if restore was successful
                audioService.playSound(named: "rec-stop")
            }
            let resultPayload = RestoreSystemAudioResultSchema(
                message: success ? "Restore command sent" : "Failed to send restore command",
                success: success)

            do {
                let resultData = try jsonEncoder.encode(resultPayload)
                let resultAsJsonAny = try jsonDecoder.decode(JSONAny.self, from: resultData)
                rpcResponse = RPCResponseSchema(error: nil, id: request.id, result: resultAsJsonAny)
            } catch {
                logToStderr(
                    "[IOBridge] Error encoding pauseSystemAudio result: \(error.localizedDescription) for ID: \(request.id)"
                )
                let errPayload = Error(
                    code: -32603, data: nil,
                    message: "Error encoding result: \(error.localizedDescription)")
                rpcResponse = RPCResponseSchema(error: nil, id: request.id, result: nil)
            }

        case .setShortcuts:
            logToStderr("[IOBridge] Handling setShortcuts for ID: \(request.id)")
            guard let paramsAnyCodable = request.params else {
                let errPayload = Error(
                    code: -32602, data: nil, message: "Missing params for setShortcuts")
                rpcResponse = RPCResponseSchema(error: errPayload, id: request.id, result: nil)
                sendRpcResponse(rpcResponse)
                return
            }

            do {
                let paramsData = try jsonEncoder.encode(paramsAnyCodable)
                let shortcutsParams = try jsonDecoder.decode(
                    SetShortcutsParamsSchema.self, from: paramsData)

                // Update the ShortcutManager with the new shortcuts
                ShortcutManager.shared.setShortcuts(
                    pushToTalk: shortcutsParams.pushToTalk,
                    toggleRecording: shortcutsParams.toggleRecording
                )

                let resultPayload = SetShortcutsResultSchema(success: true)
                let resultData = try jsonEncoder.encode(resultPayload)
                let resultAsJsonAny = try jsonDecoder.decode(JSONAny.self, from: resultData)
                rpcResponse = RPCResponseSchema(error: nil, id: request.id, result: resultAsJsonAny)

            } catch {
                logToStderr(
                    "[IOBridge] Error processing setShortcuts params: \(error.localizedDescription) for ID: \(request.id)"
                )
                let errPayload = Error(
                    code: -32602, data: request.params,
                    message: "Invalid params: \(error.localizedDescription)")
                rpcResponse = RPCResponseSchema(error: errPayload, id: request.id, result: nil)
            }

        default:
            logToStderr("[IOBridge] Method not found: \(request.method) for ID: \(request.id)")
            let errPayload = Error(
                code: -32601, data: nil, message: "Method not found: \(request.method)")
            rpcResponse = RPCResponseSchema(error: errPayload, id: request.id, result: nil)
        }
        sendRpcResponse(rpcResponse)
    }

    private func sendRpcResponse(_ response: RPCResponseSchema) {
        do {
            let responseData = try jsonEncoder.encode(response)
            if let responseString = String(data: responseData, encoding: .utf8) {
                logToStderr("[Swift Biz Logic] FINAL JSON RESPONSE to stdout: \(responseString)")
                print(responseString)
                fflush(stdout)
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
                let rpcRequest = try jsonDecoder.decode(RPCRequestSchema.self, from: data)
                logToStderr(
                    "IOBridge: Received RPC Request ID \(rpcRequest.id), Method: \(rpcRequest.method)"
                )
                handleRpcRequest(rpcRequest)
            } catch {
                logToStderr(
                    "Error decoding RpcRequest from stdin: \(error.localizedDescription). Line: \(line)"
                )
                // Consider sending a parse error if ID can be extracted
            }
        }
        logToStderr("IOBridge: RPC request processing loop finished (stdin closed).")
    }

    // MARK: - Async RPC Handlers

    private func handleAccessibilityTreeDetails(_ request: RPCRequestSchema) {
        var accessibilityParams: GetAccessibilityTreeDetailsParamsSchema? = nil
        logToStderr("[IOBridge] Handling getAccessibilityTreeDetails for ID: \(request.id)")

        if let paramsAnyCodable = request.params {
            do {
                let paramsData = try jsonEncoder.encode(paramsAnyCodable)
                accessibilityParams = try jsonDecoder.decode(
                    GetAccessibilityTreeDetailsParamsSchema.self, from: paramsData)
                logToStderr(
                    "[IOBridge] Decoded accessibilityParams.rootID: \(accessibilityParams?.rootID ?? "nil") for ID: \(request.id)"
                )
            } catch {
                logToStderr(
                    "[IOBridge] Error decoding getAccessibilityTreeDetails params: \(error.localizedDescription)"
                )
                let errPayload = Error(
                    code: -32602, data: request.params,
                    message: "Invalid params: \(error.localizedDescription)")
                let rpcResponse = RPCResponseSchema(error: errPayload, id: request.id, result: nil)
                sendRpcResponse(rpcResponse)
                return
            }
        }

        // Fetch REAL accessibility tree data using the service
        switch ExceptionCatcher.try({
            self.accessibilityService.fetchFullAccessibilityTree(rootId: accessibilityParams?.rootID)
        }) {
        case .success(let actualTreeData):
            logToStderr("[IOBridge] Fetched actualTreeData. Is nil? \(actualTreeData == nil). For ID: \(request.id)")

            var treeAsJsonAny: JSONAny? = nil
            if let dataToEncode = actualTreeData {
                do {
                    let encodedData = try jsonEncoder.encode(dataToEncode)
                    treeAsJsonAny = try jsonDecoder.decode(JSONAny.self, from: encodedData)
                } catch {
                    logToStderr("[IOBridge] Error encoding actualTreeData: \(error.localizedDescription)")
                }
            }

            let resultPayload = GetAccessibilityTreeDetailsResultSchema(tree: treeAsJsonAny)
            var resultAsJsonAny: JSONAny? = nil
            do {
                let resultPayloadData = try jsonEncoder.encode(resultPayload)
                resultAsJsonAny = try jsonDecoder.decode(JSONAny.self, from: resultPayloadData)
            } catch {
                logToStderr("Error encoding result: \(error.localizedDescription)")
            }
            let rpcResponse = RPCResponseSchema(error: nil, id: request.id, result: resultAsJsonAny)
            sendRpcResponse(rpcResponse)

        case .exception(let exception):
            logToStderr("[IOBridge] NSException in fetchFullAccessibilityTree: \(exception.name) - \(exception.reason)")
            let exceptionData: [String: Any] = [
                "name": exception.name,
                "reason": exception.reason,
                "callStack": exception.callStack.prefix(10).joined(separator: "\n")
            ]
            var exceptionJsonAny: JSONAny? = nil
            if let jsonData = try? JSONSerialization.data(withJSONObject: exceptionData),
               let decoded = try? jsonDecoder.decode(JSONAny.self, from: jsonData) {
                exceptionJsonAny = decoded
            }
            let errPayload = Error(
                code: -32603,
                data: exceptionJsonAny,
                message: "\(exception.name): \(exception.reason)"
            )
            let rpcResponse = RPCResponseSchema(error: errPayload, id: request.id, result: nil)
            sendRpcResponse(rpcResponse)
        }
    }

    // MARK: - Accessibility Handlers (using consolidated service)

    private func handleGetAccessibilityContext(id: String, params: JSONAny?) {
        logToStderr("[IOBridge] Handling getAccessibilityContext for ID: \(id)")

        // Parse params (default editableOnly = false per spec)
        var editableOnly = false
        if let paramsAnyCodable = params {
            do {
                let paramsData = try jsonEncoder.encode(paramsAnyCodable)
                let contextParams = try jsonDecoder.decode(GetAccessibilityContextParams.self, from: paramsData)
                editableOnly = contextParams.editableOnly ?? false
            } catch {
                logToStderr("[IOBridge] Error decoding params: \(error.localizedDescription)")
            }
        }

        // Call service with exception handling
        switch ExceptionCatcher.try({
            AccessibilityContextService.getAccessibilityContext(editableOnly: editableOnly)
        }) {
        case .success(let context):
            logToStderr("[IOBridge] Retrieved context for ID: \(id)")
            let result = GetAccessibilityContextResult(context: context)
            sendResult(id: id, result: result)

        case .exception(let exception):
            logToStderr("[IOBridge] NSException in getAccessibilityContext: \(exception.name) - \(exception.reason)")
            sendError(id: id, code: -32603, message: "\(exception.name): \(exception.reason)")
        }
    }

    private func handleGetAccessibilityStatus(id: String) {
        logToStderr("[IOBridge] Handling getAccessibilityStatus for ID: \(id)")

        let result = AccessibilityContextService.getAccessibilityStatus()
        sendResult(id: id, result: result)
    }

    private func handleRequestAccessibilityPermission(id: String) {
        logToStderr("[IOBridge] Handling requestAccessibilityPermission for ID: \(id)")

        let result = AccessibilityContextService.requestAccessibilityPermission()
        sendResult(id: id, result: result)
    }

    // MARK: - Response Helpers

    private func sendResult<T: Encodable>(id: String, result: T) {
        do {
            let resultData = try jsonEncoder.encode(result)
            let resultAsJsonAny = try jsonDecoder.decode(JSONAny.self, from: resultData)
            let rpcResponse = RPCResponseSchema(error: nil, id: id, result: resultAsJsonAny)
            sendRpcResponse(rpcResponse)
        } catch {
            logToStderr("[IOBridge] Error encoding result: \(error.localizedDescription)")
            sendError(id: id, code: -32603, message: "Error encoding result: \(error.localizedDescription)")
        }
    }

    private func sendError(id: String, code: Int, message: String) {
        let errPayload = Error(code: code, data: nil, message: message)
        let rpcResponse = RPCResponseSchema(error: errPayload, id: id, result: nil)
        sendRpcResponse(rpcResponse)
    }

}
