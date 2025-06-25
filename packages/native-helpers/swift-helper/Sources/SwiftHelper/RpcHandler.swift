import Foundation
import AVFoundation // ADDED

class IOBridge: NSObject, AVAudioPlayerDelegate {
    private let jsonEncoder: JSONEncoder
    private let jsonDecoder: JSONDecoder
    private let accessibilityService: AccessibilityService
    private var audioPlayer: AVAudioPlayer?
    private var audioCompletionHandler: (() -> Void)?
    private let dateFormatter: DateFormatter

    init(jsonEncoder: JSONEncoder, jsonDecoder: JSONDecoder) {
        self.jsonEncoder = jsonEncoder
        self.jsonDecoder = jsonDecoder
        self.accessibilityService = AccessibilityService()
        self.dateFormatter = DateFormatter()
        self.dateFormatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        super.init()
    }
    
    private func logToStderr(_ message: String) {
        let timestamp = dateFormatter.string(from: Date())
        let logMessage = "[\(timestamp)] \(message)\n"
        FileHandle.standardError.write(logMessage.data(using: .utf8)!)
    }

    private func playSound(named soundName: String, completion: (() -> Void)? = nil) {
        logToStderr("[IOBridge] playSound called with soundName: \(soundName)")
        
        if audioPlayer?.isPlaying == true {
            logToStderr("[IOBridge] Sound '\(audioPlayer?.url?.lastPathComponent ?? "previous")' is playing. Stopping it before playing \(soundName).")
            audioPlayer?.delegate = nil
            audioPlayer?.stop()
        }
        audioPlayer = nil
        self.audioCompletionHandler = nil

        self.audioCompletionHandler = completion

        // Get the embedded audio data
        let audioData: [UInt8]
        do {
            switch soundName {
            case "rec-start":
                logToStderr("[IOBridge] Attempting to load rec-start.mp3 from PackageResources")
                audioData = PackageResources.rec_start_mp3
                logToStderr("[IOBridge] Successfully loaded rec-start.mp3, data size: \(audioData.count) bytes")
            case "rec-stop":
                logToStderr("[IOBridge] Attempting to load rec-stop.mp3 from PackageResources")
                audioData = PackageResources.rec_stop_mp3
                logToStderr("[IOBridge] Successfully loaded rec-stop.mp3, data size: \(audioData.count) bytes")
            default:
                logToStderr("[IOBridge] Error: Unknown sound name '\(soundName)'. Completion will not be called.")
                self.audioCompletionHandler = nil
                return
            }
        } catch {
            logToStderr("[IOBridge] Error loading embedded audio data for '\(soundName)': \(error.localizedDescription). Completion will not be called.")
            self.audioCompletionHandler = nil
            return
        }

        do {
            // Convert embedded data to Data object
            let soundData = Data(audioData)
            
            // Initialize the audio player with the embedded data
            audioPlayer = try AVAudioPlayer(data: soundData)
            audioPlayer?.delegate = self

            if audioPlayer?.play() == true {
                logToStderr("[IOBridge] Playing embedded sound: \(soundName).mp3. Delegate will handle completion.")
            } else {
                logToStderr("[IOBridge] Failed to start playing embedded sound: \(soundName).mp3 (audioPlayer.play() returned false or player is nil). Completion will not be called.")
                self.audioCompletionHandler = nil
            }
        } catch {
            logToStderr("[IOBridge] Error initializing AVAudioPlayer for embedded \(soundName).mp3: \(error.localizedDescription). Completion will not be called.")
            self.audioCompletionHandler = nil
        }
    }

    // Handles a single RPC Request
    func handleRpcRequest(_ request: RPCRequestSchema) {
        var rpcResponse: RPCResponseSchema

        switch request.method {
        case .getAccessibilityTreeDetails:
            var accessibilityParams: GetAccessibilityTreeDetailsParamsSchema? = nil
            logToStderr("[IOBridge] Handling getAccessibilityTreeDetails for ID: \(request.id)")
            if let paramsAnyCodable = request.params {
                do {
                    let paramsData = try jsonEncoder.encode(paramsAnyCodable)
                    accessibilityParams = try jsonDecoder.decode(GetAccessibilityTreeDetailsParamsSchema.self, from: paramsData)
                    logToStderr("[IOBridge] Decoded accessibilityParams.rootID: \(accessibilityParams?.rootID ?? "nil") for ID: \(request.id)")
                } catch {
                    logToStderr("[IOBridge] Error decoding getAccessibilityTreeDetails params: \(error.localizedDescription)")
                    let errPayload = Error(code: -32602, data: request.params, message: "Invalid params: \(error.localizedDescription)")
                    rpcResponse = RPCResponseSchema(error: errPayload, id: request.id, result: nil)
                    sendRpcResponse(rpcResponse)
                    return
                }
            }
            
            // Fetch REAL accessibility tree data using the service
            let actualTreeData: AccessibilityElementNode? = accessibilityService.fetchFullAccessibilityTree(rootId: accessibilityParams?.rootID)

            logToStderr("[IOBridge] Fetched actualTreeData from AccessibilityService. Is nil? \(actualTreeData == nil). For ID: \(request.id)")

            var treeAsJsonAny: JSONAny? = nil
            if let dataToEncode = actualTreeData { // dataToEncode is AccessibilityElementNode?
                do {
                    let encodedData = try jsonEncoder.encode(dataToEncode) // Encodes AccessibilityElementNode
                    treeAsJsonAny = try jsonDecoder.decode(JSONAny.self, from: encodedData)
                    if let treeDataForLog = try? jsonEncoder.encode(treeAsJsonAny), let treeStringForLog = String(data: treeDataForLog, encoding: .utf8) {
                        logToStderr("[IOBridge] treeAsJsonAny (after encoding actualTreeData): \(treeStringForLog) for ID: \(request.id)")
                    }
                } catch {
                    logToStderr("[IOBridge] Error encoding actualTreeData to JSONAny: \(error.localizedDescription) for ID: \(request.id)")
                }
            }
            
            let resultPayload = GetAccessibilityTreeDetailsResultSchema(tree: treeAsJsonAny)
            do {
                let resultPayloadForLogData = try jsonEncoder.encode(resultPayload)
                if let resultPayloadStringForLog = String(data: resultPayloadForLogData, encoding: .utf8) {
                    logToStderr("[IOBridge] GetAccessibilityTreeDetailsResultSchema (resultPayload) before final encoding: \(resultPayloadStringForLog) for ID: \(request.id)")
                }
            } catch {
                 logToStderr("[IOBridge] Error encoding resultPayload for logging: \(error.localizedDescription) for ID: \(request.id)")
            }
            
            var resultAsJsonAny: JSONAny? = nil
            do {
                let resultPayloadData = try jsonEncoder.encode(resultPayload)
                resultAsJsonAny = try jsonDecoder.decode(JSONAny.self, from: resultPayloadData)
            } catch {
                 logToStderr("Error encoding GetAccessibilityTreeDetailsResultSchema to JSONAny: \(error.localizedDescription)")
            }
            rpcResponse = RPCResponseSchema(error: nil, id: request.id, result: resultAsJsonAny)
        
        case .getAccessibilityContext:
            var contextParams: GetAccessibilityContextParamsSchema? = nil
            logToStderr("[IOBridge] Handling getAccessibilityContext for ID: \(request.id)")
            if let paramsAnyCodable = request.params {
                do {
                    let paramsData = try jsonEncoder.encode(paramsAnyCodable)
                    contextParams = try jsonDecoder.decode(GetAccessibilityContextParamsSchema.self, from: paramsData)
                    logToStderr("[IOBridge] Decoded contextParams.editableOnly: \(contextParams?.editableOnly ?? false) for ID: \(request.id)")
                } catch {
                    logToStderr("[IOBridge] Error decoding getAccessibilityContext params: \(error.localizedDescription)")
                    let errPayload = Error(code: -32602, data: request.params, message: "Invalid params: \(error.localizedDescription)")
                    rpcResponse = RPCResponseSchema(error: errPayload, id: request.id, result: nil)
                    sendRpcResponse(rpcResponse)
                    return
                }
            }
            
            // Get accessibility context using the new service
            let editableOnly = contextParams?.editableOnly ?? false
            let contextData = AccessibilityContextService.getAccessibilityContext(editableOnly: editableOnly)
            
            logToStderr("[IOBridge] Fetched contextData from AccessibilityContextService. Is nil? \(contextData == nil). For ID: \(request.id)")
            
            var contextAsJsonAny: JSONAny? = nil
            if let dataToEncode = contextData {
                do {
                    let encodedData = try jsonEncoder.encode(dataToEncode)
                    contextAsJsonAny = try jsonDecoder.decode(JSONAny.self, from: encodedData)
                    if let contextDataForLog = try? jsonEncoder.encode(contextAsJsonAny), let contextStringForLog = String(data: contextDataForLog, encoding: .utf8) {
                        logToStderr("[IOBridge] contextAsJsonAny (after encoding contextData): \(contextStringForLog) for ID: \(request.id)")
                    }
                } catch {
                    logToStderr("[IOBridge] Error encoding contextData to JSONAny: \(error.localizedDescription) for ID: \(request.id)")
                }
            }
            
            let resultPayload = GetAccessibilityContextResultSchema(context: contextData)
            var resultAsJsonAny: JSONAny? = nil
            do {
                let resultPayloadData = try jsonEncoder.encode(resultPayload)
                resultAsJsonAny = try jsonDecoder.decode(JSONAny.self, from: resultPayloadData)
            } catch {
                logToStderr("Error encoding GetAccessibilityContextResultSchema to JSONAny: \(error.localizedDescription)")
            }
            rpcResponse = RPCResponseSchema(error: nil, id: request.id, result: resultAsJsonAny)
        
        case .pasteText: // Corrected to use enum case
            logToStderr("[IOBridge] Handling pasteText for ID: \(request.id)")
            guard let paramsAnyCodable = request.params else {
                let errPayload = Error(code: -32602, data: nil, message: "Missing params for pasteText")
                rpcResponse = RPCResponseSchema(error: errPayload, id: request.id, result: nil)
                sendRpcResponse(rpcResponse)
                return
            }

            do {
                let paramsData = try jsonEncoder.encode(paramsAnyCodable)
                // Corrected to use generated Swift model name from models.swift
                let pasteParams = try jsonDecoder.decode(PasteTextParamsSchema.self, from: paramsData) 
                logToStderr("[IOBridge] Decoded pasteParams.transcript for ID: \(request.id)")
                
                // Call the actual paste function (to be implemented in AccessibilityService or similar)
                let success = accessibilityService.pasteText(transcript: pasteParams.transcript)
                
                // Corrected to use generated Swift model name from models.swift
                let resultPayload = PasteTextResultSchema(message: success ? "Pasted successfully" : "Paste failed", success: success) 
                let resultData = try jsonEncoder.encode(resultPayload)
                let resultAsJsonAny = try jsonDecoder.decode(JSONAny.self, from: resultData)
                rpcResponse = RPCResponseSchema(error: nil, id: request.id, result: resultAsJsonAny)

            } catch {
                logToStderr("[IOBridge] Error processing pasteText params or operation: \(error.localizedDescription) for ID: \(request.id)")
                let errPayload = Error(code: -32602, data: request.params, message: "Invalid params or error during paste: \(error.localizedDescription)")
                rpcResponse = RPCResponseSchema(error: errPayload, id: request.id, result: nil)
            }
        
        case .muteSystemAudio:
            logToStderr("[IOBridge] Handling muteSystemAudio for ID: \(request.id)")
            
            playSound(named: "rec-start") { [weak self] in
                guard let self = self else {
                    let timestamp = DateFormatter().string(from: Date())
                    let logMessage = "[\(timestamp)] [IOBridge] self is nil in playSound completion for muteSystemAudio. ID: \(request.id)\n"
                    FileHandle.standardError.write(logMessage.data(using: .utf8)!)
                    return
                }

                self.logToStderr("[IOBridge] rec-start.mp3 finished playing successfully. Proceeding to mute system audio. ID: \(request.id)")
                let success = self.accessibilityService.muteSystemAudio()
                let resultPayload = MuteSystemAudioResultSchema(message: success ? "Mute command sent" : "Failed to send mute command", success: success)
                
                var responseToSend: RPCResponseSchema
                do {
                    let resultData = try self.jsonEncoder.encode(resultPayload)
                    let resultAsJsonAny = try self.jsonDecoder.decode(JSONAny.self, from: resultData)
                    responseToSend = RPCResponseSchema(error: nil, id: request.id, result: resultAsJsonAny)
                } catch {
                    self.logToStderr("[IOBridge] Error encoding muteSystemAudio result: \(error.localizedDescription) for ID: \(request.id)")
                    let errPayload = Error(code: -32603, data: nil, message: "Error encoding result: \(error.localizedDescription)")
                    responseToSend = RPCResponseSchema(error: errPayload, id: request.id, result: nil)
                }
                self.sendRpcResponse(responseToSend)
            }
            return

        case .restoreSystemAudio:
            logToStderr("[IOBridge] Handling restoreSystemAudio for ID: \(request.id)")
            
            let success = accessibilityService.restoreSystemAudio()
            if success { // Play sound only if restore was successful
                playSound(named: "rec-stop")
            }
            let resultPayload = RestoreSystemAudioResultSchema(message: success ? "Restore command sent" : "Failed to send restore command", success: success)
            
            do {
                let resultData = try jsonEncoder.encode(resultPayload)
                let resultAsJsonAny = try jsonDecoder.decode(JSONAny.self, from: resultData)
                rpcResponse = RPCResponseSchema(error: nil, id: request.id, result: resultAsJsonAny)
            } catch {
                logToStderr("[IOBridge] Error encoding pauseSystemAudio result: \(error.localizedDescription) for ID: \(request.id)")
                let errPayload = Error(code: -32603, data: nil, message: "Error encoding result: \(error.localizedDescription)")
                rpcResponse = RPCResponseSchema(error: nil, id: request.id, result: nil)
            }

        default:
            logToStderr("[IOBridge] Method not found: \(request.method) for ID: \(request.id)")
            let errPayload = Error(code: -32601, data: nil, message: "Method not found: \(request.method)")
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
                logToStderr("IOBridge: Received RPC Request ID \(rpcRequest.id), Method: \(rpcRequest.method)")
                handleRpcRequest(rpcRequest)
            } catch {
                logToStderr("Error decoding RpcRequest from stdin: \(error.localizedDescription). Line: \(line)")
                // Consider sending a parse error if ID can be extracted
            }
        }
        logToStderr("IOBridge: RPC request processing loop finished (stdin closed).")
    }

    // MARK: - AVAudioPlayerDelegate
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        logToStderr("[IOBridge] Sound playback finished (player URL: \(player.url?.lastPathComponent ?? "unknown"), successfully: \(flag)).")
        
        let handlerToCall = audioCompletionHandler
        audioCompletionHandler = nil

        if flag {
            logToStderr("[IOBridge] Sound finished successfully. Executing completion handler.")
            handlerToCall?()
        } else {
            logToStderr("[IOBridge] Sound did not finish successfully (e.g., stopped or error). Not executing completion handler.")
        }
    }
}
