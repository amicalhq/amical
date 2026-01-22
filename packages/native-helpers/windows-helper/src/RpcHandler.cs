using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using WindowsHelper.Models;
using WindowsHelper.Services;

namespace WindowsHelper
{
    public class RpcHandler : IDisposable
    {
        private readonly JsonSerializerOptions jsonOptions;
        private readonly AccessibilityService accessibilityService;
        private readonly AudioService audioService;
        private readonly StaThreadRunner? staRunner;
        private Action<string>? audioCompletionHandler;
        private bool disposed;

        public RpcHandler(StaThreadRunner? staRunner, ClipboardService clipboardService)
        {
            this.staRunner = staRunner;

            // Use the generated converter settings from the models
            jsonOptions = WindowsHelper.Models.Converter.Settings;

            // Create AccessibilityService with ClipboardService
            accessibilityService = new AccessibilityService(clipboardService);

            audioService = new AudioService();
            audioService.SoundPlaybackCompleted += OnSoundPlaybackCompleted;

            if (staRunner != null)
            {
                LogToStderr("RpcHandler: STA thread dispatch enabled via StaThreadRunner");
            }
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
        }

        public void ProcessRpcRequests(CancellationToken cancellationToken)
        {
            LogToStderr("RpcHandler: Starting RPC request processing loop.");

            try
            {
                string? line;
                while (!cancellationToken.IsCancellationRequested && (line = Console.ReadLine()) != null)
                {
                    if (string.IsNullOrWhiteSpace(line))
                    {
                        LogToStderr("Warning: Received empty line on stdin.");
                        continue;
                    }

                    try
                    {
                        var request = JsonSerializer.Deserialize<RpcRequest>(line, jsonOptions);
                        if (request != null)
                        {
                            LogToStderr($"RpcHandler: Received RPC Request ID {request.Id}, Method: {request.Method}");
                            _ = Task.Run(() => HandleRpcRequest(request), cancellationToken);
                        }
                    }
                    catch (JsonException ex)
                    {
                        LogToStderr($"Error decoding RpcRequest from stdin: {ex.Message}. Line: {line}");
                    }
                }
            }
            catch (Exception ex)
            {
                LogToStderr($"Fatal error in RPC processing: {ex.Message}");
            }

            LogToStderr("RpcHandler: RPC request processing loop finished.");
        }

        private async void HandleRpcRequest(RpcRequest request)
        {
            RpcResponse response;

            try
            {
                switch (request.Method)
                {
                    case Method.GetAccessibilityTreeDetails:
                        response = await HandleGetAccessibilityTreeDetails(request);
                        break;

                    case Method.GetAccessibilityContext:
                        response = await HandleGetAccessibilityContext(request);
                        break;

                    case Method.PasteText:
                        response = HandlePasteText(request);
                        break;

                    case Method.MuteSystemAudio:
                        response = await HandleMuteSystemAudio(request);
                        return; // Response sent after audio playback

                    case Method.RestoreSystemAudio:
                        response = HandleRestoreSystemAudio(request);
                        break;

                    case Method.SetShortcuts:
                        response = HandleSetShortcuts(request);
                        break;

                    default:
                        LogToStderr($"Method not found: {request.Method} for ID: {request.Id}");
                        response = new RpcResponse
                        {
                            Id = request.Id.ToString(),
                            Error = new Error
                            {
                                Code = -32601,
                                Message = $"Method not found: {request.Method}"
                            }
                        };
                        break;
                }
            }
            catch (Exception ex)
            {
                LogToStderr($"Error handling request {request.Id}: {ex.Message}");
                response = new RpcResponse
                {
                    Id = request.Id.ToString(),
                    Error = new Error
                    {
                        Code = -32603,
                        Message = $"Internal error: {ex.Message}"
                    }
                };
            }

            SendRpcResponse(response);
        }

        private async Task<RpcResponse> HandleGetAccessibilityTreeDetails(RpcRequest request)
        {
            LogToStderr($"Handling getAccessibilityTreeDetails for ID: {request.Id}");

            GetAccessibilityTreeDetailsParams? parameters = null;
            if (request.Params != null)
            {
                try
                {
                    var json = JsonSerializer.Serialize(request.Params, jsonOptions);
                    parameters = JsonSerializer.Deserialize<GetAccessibilityTreeDetailsParams>(json, jsonOptions);
                }
                catch (Exception ex)
                {
                    LogToStderr($"Error decoding params: {ex.Message}");
                    return new RpcResponse
                    {
                        Id = request.Id.ToString(),
                        Error = new Error
                        {
                            Code = -32602,
                            Message = $"Invalid params: {ex.Message}",
                            Data = request.Params
                        }
                    };
                }
            }

            // Get accessibility tree on UI thread
            var tree = await Task.Run(() => accessibilityService.FetchAccessibilityTree(parameters?.RootId));

            return new RpcResponse
            {
                Id = request.Id.ToString(),
                Result = new GetAccessibilityTreeDetailsResult { Tree = tree }
            };
        }

        private async Task<RpcResponse> HandleGetAccessibilityContext(RpcRequest request)
        {
            LogToStderr($"Handling getAccessibilityContext for ID: {request.Id}");

            GetAccessibilityContextParams? parameters = null;
            if (request.Params != null)
            {
                try
                {
                    var json = JsonSerializer.Serialize(request.Params, jsonOptions);
                    parameters = JsonSerializer.Deserialize<GetAccessibilityContextParams>(json, jsonOptions);
                }
                catch (Exception ex)
                {
                    LogToStderr($"Error decoding params: {ex.Message}");
                    return new RpcResponse
                    {
                        Id = request.Id.ToString(),
                        Error = new Error
                        {
                            Code = -32602,
                            Message = $"Invalid params: {ex.Message}",
                            Data = request.Params
                        }
                    };
                }
            }

            var editableOnly = parameters?.EditableOnly ?? false;
            var context = await Task.Run(() => accessibilityService.GetAccessibilityContext(editableOnly));

            return new RpcResponse
            {
                Id = request.Id.ToString(),
                Result = new GetAccessibilityContextResult { Context = context }
            };
        }

        private RpcResponse HandlePasteText(RpcRequest request)
        {
            LogToStderr($"Handling pasteText for ID: {request.Id}");

            if (request.Params == null)
            {
                return new RpcResponse
                {
                    Id = request.Id.ToString(),
                    Error = new Error
                    {
                        Code = -32602,
                        Message = "Missing params for pasteText"
                    }
                };
            }

            try
            {
                var json = JsonSerializer.Serialize(request.Params, jsonOptions);
                var parameters = JsonSerializer.Deserialize<PasteTextParams>(json, jsonOptions);

                if (parameters != null)
                {
                    var success = accessibilityService.PasteText(parameters.Transcript, out var errorMessage);
                    return new RpcResponse
                    {
                        Id = request.Id.ToString(),
                        Result = new PasteTextResult
                        {
                            Success = success,
                            Message = success ? "Pasted successfully" : (errorMessage ?? "Paste failed")
                        }
                    };
                }
            }
            catch (Exception ex)
            {
                LogToStderr($"Error processing pasteText: {ex}");
                return new RpcResponse
                {
                    Id = request.Id.ToString(),
                    Error = new Error
                    {
                        Code = -32603,
                        Message = $"Error during paste operation: {ex.Message}",
                        Data = ex.ToString()
                    }
                };
            }

            return new RpcResponse
            {
                Id = request.Id.ToString(),
                Error = new Error
                {
                    Code = -32603,
                    Message = "Error during paste operation"
                }
            };
        }

        private async Task<RpcResponse> HandleMuteSystemAudio(RpcRequest request)
        {
            LogToStderr($"Handling muteSystemAudio for ID: {request.Id}");

            // Store the request ID for the completion handler
            var requestId = request.Id.ToString();

            audioCompletionHandler = (id) =>
            {
                LogToStderr($"rec-start.mp3 finished playing. Proceeding to mute system audio. ID: {id}");
                var success = audioService.MuteSystemAudio();
                var response = new RpcResponse
                {
                    Id = id,
                    Result = new MuteSystemAudioResult
                    {
                        Success = success,
                        Message = success ? "Mute command sent" : "Failed to send mute command"
                    }
                };
                SendRpcResponse(response);
                audioCompletionHandler = null;
            };

            // Play sound on thread pool - NAudio handles its own threading internally
            await audioService.PlaySound("rec-start", requestId);

            // Return dummy response (real response sent after audio completion)
            return new RpcResponse { Id = request.Id.ToString() };
        }

        private RpcResponse HandleRestoreSystemAudio(RpcRequest request)
        {
            LogToStderr($"Handling restoreSystemAudio for ID: {request.Id}");

            var success = audioService.RestoreSystemAudio();
            if (success)
            {
                // Play sound asynchronously - NAudio handles its own threading, don't wait
                _ = audioService.PlaySound("rec-stop", request.Id.ToString());
            }

            return new RpcResponse
            {
                Id = request.Id.ToString(),
                Result = new RestoreSystemAudioResult
                {
                    Success = success,
                    Message = success ? "Restore command sent" : "Failed to send restore command"
                }
            };
        }

        private void OnSoundPlaybackCompleted(object? sender, string requestId)
        {
            audioCompletionHandler?.Invoke(requestId);
        }

        private RpcResponse HandleSetShortcuts(RpcRequest request)
        {
            LogToStderr($"[RpcHandler] Handling setShortcuts for ID: {request.Id}");

            try
            {
                var paramsJson = JsonSerializer.Serialize(request.Params, jsonOptions);
                var setShortcutsParams = JsonSerializer.Deserialize<SetShortcutsParams>(paramsJson, jsonOptions);

                if (setShortcutsParams == null)
                {
                    return new RpcResponse
                    {
                        Id = request.Id.ToString(),
                        Error = new Error
                        {
                            Code = -32602,
                            Message = "Invalid params: could not deserialize SetShortcutsParams"
                        }
                    };
                }

                ShortcutManager.Instance.SetShortcuts(
                    setShortcutsParams.PushToTalk?.ToArray() ?? Array.Empty<string>(),
                    setShortcutsParams.ToggleRecording?.ToArray() ?? Array.Empty<string>()
                );

                return new RpcResponse
                {
                    Id = request.Id.ToString(),
                    Result = new SetShortcutsResult { Success = true }
                };
            }
            catch (Exception ex)
            {
                LogToStderr($"[RpcHandler] Error in setShortcuts: {ex.Message}");
                return new RpcResponse
                {
                    Id = request.Id.ToString(),
                    Error = new Error
                    {
                        Code = -32603,
                        Message = $"Internal error: {ex.Message}"
                    }
                };
            }
        }

        private void SendRpcResponse(RpcResponse response)
        {
            try
            {
                var json = JsonSerializer.Serialize(response, jsonOptions);
                LogToStderr($"[RpcHandler] Sending response to stdout: {json}");
                Console.WriteLine(json);
                Console.Out.Flush();
            }
            catch (Exception ex)
            {
                LogToStderr($"Error encoding RpcResponse: {ex.Message}");
            }
        }

        private void LogToStderr(string message)
        {
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            Console.Error.WriteLine($"[{timestamp}] {message}");
            Console.Error.Flush();
        }
    }
}
