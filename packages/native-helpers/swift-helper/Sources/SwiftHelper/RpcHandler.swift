import Foundation
import AVFoundation // ADDED

class IOBridge: NSObject, AVAudioPlayerDelegate {
    private let jsonEncoder: JSONEncoder
    private let jsonDecoder: JSONDecoder
    private let accessibilityService: AccessibilityService
    private var audioPlayer: AVAudioPlayer?
    private var audioCompletionHandler: (() -> Void)?

    init(jsonEncoder: JSONEncoder, jsonDecoder: JSONDecoder) {
        self.jsonEncoder = jsonEncoder
        self.jsonDecoder = jsonDecoder
        self.accessibilityService = AccessibilityService()
    }

    private func playSound(named soundName: String, completion: (() -> Void)? = nil) {
        if audioPlayer?.isPlaying == true {
            FileHandle.standardError.write("[IOBridge] Sound '\(audioPlayer?.url?.lastPathComponent ?? "previous")' is playing. Stopping it before playing \(soundName).\n".data(using: .utf8)!)
            audioPlayer?.delegate = nil
            audioPlayer?.stop()
        }
        audioPlayer = nil
        self.audioCompletionHandler = nil

        self.audioCompletionHandler = completion

        // Get the embedded audio data
        let audioData: [UInt8]
        switch soundName {
        case "rec-start":
            audioData = PackageResources.rec_start_mp3
        case "rec-stop":
            audioData = PackageResources.rec_stop_mp3
        default:
            FileHandle.standardError.write("[IOBridge] Error: Unknown sound name '\(soundName)'. Completion will not be called.\n".data(using: .utf8)!)
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
                FileHandle.standardError.write("[IOBridge] Playing embedded sound: \(soundName).mp3. Delegate will handle completion.\n".data(using: .utf8)!)
            } else {
                FileHandle.standardError.write("[IOBridge] Failed to start playing embedded sound: \(soundName).mp3 (audioPlayer.play() returned false or player is nil). Completion will not be called.\n".data(using: .utf8)!)
                self.audioCompletionHandler = nil
            }
        } catch {
            FileHandle.standardError.write("[IOBridge] Error initializing AVAudioPlayer for embedded \(soundName).mp3: \(error.localizedDescription). Completion will not be called.\n".data(using: .utf8)!)
            self.audioCompletionHandler = nil
        }
    }

    // Handles a single RPC Request
    func handleRpcRequest(_ request: RPCRequestSchema) {
        var rpcResponse: RPCResponseSchema

        switch request.method {
        case .getAccessibilityTreeDetails:
            var accessibilityParams: GetAccessibilityTreeDetailsParamsSchema? = nil
            FileHandle.standardError.write("[IOBridge] Handling getAccessibilityTreeDetails for ID: \(request.id)\n".data(using: .utf8)!)
            if let paramsAnyCodable = request.params {
                do {
                    let paramsData = try jsonEncoder.encode(paramsAnyCodable)
                    accessibilityParams = try jsonDecoder.decode(GetAccessibilityTreeDetailsParamsSchema.self, from: paramsData)
                    FileHandle.standardError.write("[IOBridge] Decoded accessibilityParams.rootID: \(accessibilityParams?.rootID ?? "nil") for ID: \(request.id)\n".data(using: .utf8)!)
                } catch {
                    FileHandle.standardError.write("[IOBridge] Error decoding getAccessibilityTreeDetails params: \(error.localizedDescription)\n".data(using: .utf8)!)
                    let errPayload = Error(code: -32602, data: request.params, message: "Invalid params: \(error.localizedDescription)")
                    rpcResponse = RPCResponseSchema(error: errPayload, id: request.id, result: nil)
                    sendRpcResponse(rpcResponse)
                    return
                }
            }
            
            // Fetch REAL accessibility tree data using the service
            let actualTreeData: AccessibilityElementNode? = accessibilityService.fetchFullAccessibilityTree(rootId: accessibilityParams?.rootID)

            FileHandle.standardError.write("[IOBridge] Fetched actualTreeData from AccessibilityService. Is nil? \(actualTreeData == nil). For ID: \(request.id)\n".data(using: .utf8)!)

            var treeAsJsonAny: JSONAny? = nil
            if let dataToEncode = actualTreeData { // dataToEncode is AccessibilityElementNode?
                do {
                    let encodedData = try jsonEncoder.encode(dataToEncode) // Encodes AccessibilityElementNode
                    treeAsJsonAny = try jsonDecoder.decode(JSONAny.self, from: encodedData)
                    if let treeDataForLog = try? jsonEncoder.encode(treeAsJsonAny), let treeStringForLog = String(data: treeDataForLog, encoding: .utf8) {
                        FileHandle.standardError.write("[IOBridge] treeAsJsonAny (after encoding actualTreeData): \(treeStringForLog) for ID: \(request.id)\n".data(using: .utf8)!)
                    }
                } catch {
                    FileHandle.standardError.write("[IOBridge] Error encoding actualTreeData to JSONAny: \(error.localizedDescription) for ID: \(request.id)\n".data(using: .utf8)!)
                }
            }
            
            let resultPayload = GetAccessibilityTreeDetailsResultSchema(tree: treeAsJsonAny)
            do {
                let resultPayloadForLogData = try jsonEncoder.encode(resultPayload)
                if let resultPayloadStringForLog = String(data: resultPayloadForLogData, encoding: .utf8) {
                    FileHandle.standardError.write("[IOBridge] GetAccessibilityTreeDetailsResultSchema (resultPayload) before final encoding: \(resultPayloadStringForLog) for ID: \(request.id)\n".data(using: .utf8)!)
                }
            } catch {
                 FileHandle.standardError.write("[IOBridge] Error encoding resultPayload for logging: \(error.localizedDescription) for ID: \(request.id)\n".data(using: .utf8)!)
            }
            
            var resultAsJsonAny: JSONAny? = nil
            do {
                let resultPayloadData = try jsonEncoder.encode(resultPayload)
                resultAsJsonAny = try jsonDecoder.decode(JSONAny.self, from: resultPayloadData)
            } catch {
                 FileHandle.standardError.write("Error encoding GetAccessibilityTreeDetailsResultSchema to JSONAny: \(error.localizedDescription)\n".data(using: .utf8)!)
            }
            rpcResponse = RPCResponseSchema(error: nil, id: request.id, result: resultAsJsonAny)
        
        case .pasteText: // Corrected to use enum case
            FileHandle.standardError.write("[IOBridge] Handling pasteText for ID: \(request.id)\n".data(using: .utf8)!)
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
                FileHandle.standardError.write("[IOBridge] Decoded pasteParams.transcript for ID: \(request.id)\n".data(using: .utf8)!)
                
                // Call the actual paste function (to be implemented in AccessibilityService or similar)
                let success = accessibilityService.pasteText(transcript: pasteParams.transcript)
                
                // Corrected to use generated Swift model name from models.swift
                let resultPayload = PasteTextResultSchema(message: success ? "Pasted successfully" : "Paste failed", success: success) 
                let resultData = try jsonEncoder.encode(resultPayload)
                let resultAsJsonAny = try jsonDecoder.decode(JSONAny.self, from: resultData)
                rpcResponse = RPCResponseSchema(error: nil, id: request.id, result: resultAsJsonAny)

            } catch {
                FileHandle.standardError.write("[IOBridge] Error processing pasteText params or operation: \(error.localizedDescription) for ID: \(request.id)\n".data(using: .utf8)!)
                let errPayload = Error(code: -32602, data: request.params, message: "Invalid params or error during paste: \(error.localizedDescription)")
                rpcResponse = RPCResponseSchema(error: errPayload, id: request.id, result: nil)
            }
        
        case .muteSystemAudio:
            FileHandle.standardError.write("[IOBridge] Handling muteSystemAudio for ID: \(request.id)\n".data(using: .utf8)!)
            
            playSound(named: "rec-start") { [weak self] in
                guard let self = self else {
                    FileHandle.standardError.write("[IOBridge] self is nil in playSound completion for muteSystemAudio. ID: \(request.id)\n".data(using: .utf8)!)
                    return
                }

                FileHandle.standardError.write("[IOBridge] rec-start.mp3 finished playing successfully. Proceeding to mute system audio. ID: \(request.id)\n".data(using: .utf8)!)
                let success = self.accessibilityService.muteSystemAudio()
                let resultPayload = MuteSystemAudioResultSchema(message: success ? "Mute command sent" : "Failed to send mute command", success: success)
                
                var responseToSend: RPCResponseSchema
                do {
                    let resultData = try self.jsonEncoder.encode(resultPayload)
                    let resultAsJsonAny = try self.jsonDecoder.decode(JSONAny.self, from: resultData)
                    responseToSend = RPCResponseSchema(error: nil, id: request.id, result: resultAsJsonAny)
                } catch {
                    FileHandle.standardError.write("[IOBridge] Error encoding muteSystemAudio result: \(error.localizedDescription) for ID: \(request.id)\n".data(using: .utf8)!)
                    let errPayload = Error(code: -32603, data: nil, message: "Error encoding result: \(error.localizedDescription)")
                    responseToSend = RPCResponseSchema(error: errPayload, id: request.id, result: nil)
                }
                self.sendRpcResponse(responseToSend)
            }
            return

        case .restoreSystemAudio:
            FileHandle.standardError.write("[IOBridge] Handling restoreSystemAudio for ID: \(request.id)\n".data(using: .utf8)!)
            
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
                FileHandle.standardError.write("[IOBridge] Error encoding pauseSystemAudio result: \(error.localizedDescription) for ID: \(request.id)\n".data(using: .utf8)!)
                let errPayload = Error(code: -32603, data: nil, message: "Error encoding result: \(error.localizedDescription)")
                rpcResponse = RPCResponseSchema(error: nil, id: request.id, result: nil)
            }

        default:
            FileHandle.standardError.write("[IOBridge] Method not found: \(request.method) for ID: \(request.id)\n".data(using: .utf8)!)
            let errPayload = Error(code: -32601, data: nil, message: "Method not found: \(request.method)")
            rpcResponse = RPCResponseSchema(error: errPayload, id: request.id, result: nil)
        }
        sendRpcResponse(rpcResponse)
    }

    private func sendRpcResponse(_ response: RPCResponseSchema) {
        do {
            let responseData = try jsonEncoder.encode(response)
            if let responseString = String(data: responseData, encoding: .utf8) {
                FileHandle.standardError.write("[Swift Biz Logic] FINAL JSON RESPONSE to stdout: \(responseString)\n".data(using: .utf8)!)
                print(responseString)
                fflush(stdout)
            }
        } catch {
            FileHandle.standardError.write("Error encoding RpcResponse: \(error.localizedDescription)\n".data(using: .utf8)!)
        }
    }

    // Main loop for processing RPC requests from stdin
    func processRpcRequests() {
        FileHandle.standardError.write("IOBridge: Starting RPC request processing loop.\n".data(using: .utf8)!)
        while let line = readLine(strippingNewline: true) {
            guard !line.isEmpty, let data = line.data(using: .utf8) else {
                FileHandle.standardError.write("Warning: Received empty or non-UTF8 line on stdin.\n".data(using: .utf8)!)
                continue
            }

            do {
                let rpcRequest = try jsonDecoder.decode(RPCRequestSchema.self, from: data)
                FileHandle.standardError.write("IOBridge: Received RPC Request ID \(rpcRequest.id), Method: \(rpcRequest.method)\n".data(using: .utf8)!)
                handleRpcRequest(rpcRequest)
            } catch {
                FileHandle.standardError.write("Error decoding RpcRequest from stdin: \(error.localizedDescription). Line: \(line)\n".data(using: .utf8)!)
                // Consider sending a parse error if ID can be extracted
            }
        }
        FileHandle.standardError.write("IOBridge: RPC request processing loop finished (stdin closed).\n".data(using: .utf8)!)
    }

    // MARK: - AVAudioPlayerDelegate
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        FileHandle.standardError.write("[IOBridge] Sound playback finished (player URL: \(player.url?.lastPathComponent ?? "unknown"), successfully: \(flag)).\n".data(using: .utf8)!)
        
        let handlerToCall = audioCompletionHandler
        audioCompletionHandler = nil

        if flag {
            FileHandle.standardError.write("[IOBridge] Sound finished successfully. Executing completion handler.\n".data(using: .utf8)!)
            handlerToCall?()
        } else {
            FileHandle.standardError.write("[IOBridge] Sound did not finish successfully (e.g., stopped or error). Not executing completion handler.\n".data(using: .utf8)!)
        }
    }
}
