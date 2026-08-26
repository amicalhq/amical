using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using WindowsHelper.Models;
using WindowsHelper.Services;

namespace WindowsHelper
{
    internal sealed class RpcDispatchException : Exception
    {
        internal long RpcCode { get; }
        internal object? RpcData { get; }

        internal RpcDispatchException(long code, string message, object? data = null)
            : base(message)
        {
            RpcCode = code;
            RpcData = data;
        }
    }

    internal static class RpcResponseExecutor
    {
        internal static async Task<string> ExecuteAsync(
            string id,
            Func<Task<object?>> operation,
            JsonSerializerOptions jsonOptions)
        {
            RpcResponse response;
            try
            {
                response = new RpcResponse
                {
                    Id = id,
                    Result = await operation()
                };
            }
            catch (RpcDispatchException ex)
            {
                response = new RpcResponse
                {
                    Id = id,
                    Error = new Error
                    {
                        Code = ex.RpcCode,
                        Message = ex.Message,
                        Data = ex.RpcData
                    }
                };
            }
            catch (Exception ex)
            {
                response = InternalError(id, ex);
            }

            try
            {
                return JsonSerializer.Serialize(response, jsonOptions);
            }
            catch (Exception ex)
            {
                return JsonSerializer.Serialize(InternalError(id, ex), jsonOptions);
            }
        }

        private static RpcResponse InternalError(string id, Exception exception)
        {
            return new RpcResponse
            {
                Id = id,
                Error = new Error
                {
                    Code = -32603,
                    Message = $"Internal error: {exception.Message}"
                }
            };
        }
    }

    public class RpcHandler : IDisposable
    {
        private readonly JsonSerializerOptions jsonOptions;
        private readonly AccessibilityService accessibilityService;
        private readonly AudioService audioService;
        private readonly StaThreadRunner? staRunner;
        private bool disposed;

        public RpcHandler(StaThreadRunner? staRunner, ClipboardService clipboardService)
        {
            this.staRunner = staRunner;
            jsonOptions = WindowsHelper.Models.Converter.Settings;
            accessibilityService = new AccessibilityService(clipboardService);
            audioService = new AudioService();

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
                        if (request == null)
                        {
                            LogToStderr($"Error decoding RpcRequest from stdin: decoded request was null. Line: {line}");
                            continue;
                        }

                        LogToStderr($"RpcHandler: Received RPC Request ID {request.Id}, Method: {request.Method}");
                        _ = Task.Run(
                            () => ProcessAndRespondAsync(request),
                            cancellationToken
                        );
                    }
                    catch (Exception ex)
                    {
                        // Generated converters can throw exceptions other than JsonException.
                        // Keep every decode failure inside this iteration so the reader survives.
                        LogToStderr($"Error decoding RpcRequest from stdin: {ex.Message}. Line: {line}");
                    }
                }
            }
            catch (Exception ex)
            {
                LogToStderr($"Fatal error reading RPC stdin: {ex.Message}");
            }

            LogToStderr("RpcHandler: RPC request processing loop finished.");
        }

        private async Task ProcessAndRespondAsync(RpcRequest request)
        {
            var responseJson = await RpcResponseExecutor.ExecuteAsync(
                request.Id.ToString(),
                () => DispatchRpcRequestAsync(request),
                jsonOptions
            );
            SendRpcResponse(responseJson);
        }

        private async Task<object?> DispatchRpcRequestAsync(RpcRequest request)
        {
            switch (request.Method)
            {
                case Method.GetAccessibilityTreeDetails:
                    return await HandleGetAccessibilityTreeDetails(request);

                case Method.GetAccessibilityContext:
                    return await HandleGetAccessibilityContext(request);

                case Method.PasteText:
                    return HandlePasteText(request);

                case Method.StartRecording:
                    return await HandleStartRecording(request);

                case Method.StopRecording:
                    return HandleStopRecording(request);

                case Method.SetShortcuts:
                    return HandleSetShortcuts(request);

                case Method.SetDraftEnterCapture:
                    return HandleSetDraftEnterCapture(request);

                case Method.SetAllowInjectedKeys:
                    return HandleSetAllowInjectedKeys(request);

                case Method.RecheckPressedKeys:
                    return HandleRecheckPressedKeys(request);

                case Method.GetSelectedTextViaCopy:
                    return HandleGetSelectedTextViaCopy(request);

                case Method.GetAccessibilityStatus:
                case Method.RequestAccessibilityPermission:
                    throw new RpcDispatchException(
                        -32601,
                        $"Method not found: {request.Method}"
                    );

                default:
                    throw new RpcDispatchException(
                        -32601,
                        $"Method not found: {request.Method}"
                    );
            }
        }

        private async Task<object?> HandleGetAccessibilityTreeDetails(RpcRequest request)
        {
            LogToStderr($"Handling getAccessibilityTreeDetails for ID: {request.Id}");
            var parameters = DecodeOptionalParams<GetAccessibilityTreeDetailsParams>(
                request,
                "getAccessibilityTreeDetails"
            );
            var tree = await Task.Run(
                () => accessibilityService.FetchAccessibilityTree(parameters?.RootId)
            );
            return new GetAccessibilityTreeDetailsResult { Tree = tree };
        }

        private async Task<object?> HandleGetAccessibilityContext(RpcRequest request)
        {
            LogToStderr($"Handling getAccessibilityContext for ID: {request.Id}");
            var parameters = DecodeOptionalParams<GetAccessibilityContextParams>(
                request,
                "getAccessibilityContext"
            );
            var context = await Task.Run(
                () => accessibilityService.GetAccessibilityContext(parameters?.EditableOnly ?? false)
            );
            return new GetAccessibilityContextResult { Context = context };
        }

        private object HandleGetSelectedTextViaCopy(RpcRequest request)
        {
            LogToStderr($"Handling getSelectedTextViaCopy for ID: {request.Id}");
            return accessibilityService.GetSelectedTextViaCopy();
        }

        private object HandlePasteText(RpcRequest request)
        {
            LogToStderr($"Handling pasteText for ID: {request.Id}");
            var parameters = DecodeRequiredParams<PasteTextParams>(
                request,
                "pasteText",
                "transcript"
            );
            var preserveClipboard = parameters.PreserveClipboard ?? true;
            var success = accessibilityService.PasteText(
                parameters.Transcript,
                preserveClipboard,
                out var errorMessage
            );
            return new PasteTextResult
            {
                Success = success,
                Message = success
                    ? (errorMessage ?? "Pasted successfully")
                    : (errorMessage ?? "Paste failed")
            };
        }

        private async Task<object?> HandleStartRecording(RpcRequest request)
        {
            LogToStderr($"Handling startRecording for ID: {request.Id}");
            var parameters = DecodeRequiredParams<StartRecordingParams>(
                request,
                "startRecording",
                "muteSystemAudio"
            );

            if (parameters.MuteSounds != true)
            {
                await audioService.PlaySound("rec-start");
            }

            var success = true;
            if (parameters.MuteSystemAudio)
            {
                success = audioService.MuteSystemAudio();
            }

            return new StartRecordingResult
            {
                Success = success,
                Message = success ? "Recording started" : "Failed to mute system audio"
            };
        }

        private object HandleStopRecording(RpcRequest request)
        {
            LogToStderr($"Handling stopRecording for ID: {request.Id}");
            var parameters = DecodeRequiredParams<StopRecordingParams>(
                request,
                "stopRecording",
                "wasMuted"
            );

            var success = true;
            if (parameters.WasMuted)
            {
                success = audioService.RestoreSystemAudio();
            }

            if (parameters.MuteSounds != true)
            {
                _ = PlayStopSoundAsync();
            }

            return new StopRecordingResult
            {
                Success = success,
                Message = success ? "Recording stopped" : "Failed to restore system audio"
            };
        }

        private async Task PlayStopSoundAsync()
        {
            try
            {
                await audioService.PlaySound("rec-stop");
            }
            catch (Exception ex)
            {
                LogToStderr($"Error playing rec-stop: {ex.Message}");
            }
        }

        private object HandleSetShortcuts(RpcRequest request)
        {
            LogToStderr($"[RpcHandler] Handling setShortcuts for ID: {request.Id}");
            var parameters = DecodeRequiredParams<SetShortcutsParams>(
                request,
                "setShortcuts",
                "subsetChords",
                "exactChords"
            );
            ShortcutManager.Instance.SetShortcuts(
                ConvertChords(parameters.SubsetChords),
                ConvertChords(parameters.ExactChords)
            );
            return new SetShortcutsResult { Success = true };
        }

        private object HandleSetDraftEnterCapture(RpcRequest request)
        {
            LogToStderr($"[RpcHandler] Handling setDraftEnterCapture for ID: {request.Id}");
            var parameters = DecodeRequiredParams<SetDraftEnterCaptureParams>(
                request,
                "setDraftEnterCapture",
                "enabled"
            );
            ShortcutManager.Instance.SetDraftEnterCapture(parameters.Enabled);
            return new SetDraftEnterCaptureResult { Success = true };
        }

        private object HandleSetAllowInjectedKeys(RpcRequest request)
        {
            LogToStderr($"[RpcHandler] Handling setAllowInjectedKeys for ID: {request.Id}");
            var parameters = DecodeRequiredParams<SetAllowInjectedKeysParams>(
                request,
                "setAllowInjectedKeys",
                "enabled"
            );
            ShortcutManager.Instance.SetAllowInjectedKeys(parameters.Enabled);
            return new SetAllowInjectedKeysResult { Success = true };
        }

        private object HandleRecheckPressedKeys(RpcRequest request)
        {
            LogToStderr($"Handling recheckPressedKeys for ID: {request.Id}");
            var parameters = DecodeRequiredParams<RecheckPressedKeysParams>(
                request,
                "recheckPressedKeys",
                "pressedKeyCodes"
            );
            var staleKeyCodes = ShortcutManager.Instance.GetStalePressedKeyCodes(
                (parameters.PressedKeyCodes ?? new List<long>()).Select(keyCode => (int)keyCode)
            );
            return new RecheckPressedKeysResult
            {
                StaleKeyCodes = staleKeyCodes.Select(keyCode => (long)keyCode).ToList()
            };
        }

        private T DecodeRequiredParams<T>(
            RpcRequest request,
            string method,
            params string[] requiredProperties)
        {
            if (request.Params == null)
            {
                throw InvalidParams(request, $"Missing params for {method}");
            }

            try
            {
                var json = JsonSerializer.Serialize(request.Params, jsonOptions);
                using var document = JsonDocument.Parse(json);
                if (document.RootElement.ValueKind != JsonValueKind.Object)
                {
                    throw InvalidParams(request, $"Invalid params for {method}: expected an object");
                }

                foreach (var propertyName in requiredProperties)
                {
                    if (!document.RootElement.TryGetProperty(propertyName, out var property)
                        || property.ValueKind == JsonValueKind.Null)
                    {
                        throw InvalidParams(
                            request,
                            $"Invalid params for {method}: missing {propertyName}"
                        );
                    }
                }

                return JsonSerializer.Deserialize<T>(json, jsonOptions)
                    ?? throw InvalidParams(request, $"Invalid params for {method}");
            }
            catch (RpcDispatchException)
            {
                throw;
            }
            catch (Exception ex)
            {
                throw InvalidParams(request, $"Invalid params for {method}: {ex.Message}");
            }
        }

        private T? DecodeOptionalParams<T>(RpcRequest request, string method)
        {
            if (request.Params == null) return default;

            try
            {
                var json = JsonSerializer.Serialize(request.Params, jsonOptions);
                return JsonSerializer.Deserialize<T>(json, jsonOptions);
            }
            catch (Exception ex)
            {
                throw InvalidParams(request, $"Invalid params for {method}: {ex.Message}");
            }
        }

        private static RpcDispatchException InvalidParams(RpcRequest request, string message)
        {
            return new RpcDispatchException(-32602, message, request.Params);
        }

        private void SendRpcResponse(string responseJson)
        {
            try
            {
                LogToStderr($"[RpcHandler] Sending response to stdout: {responseJson}");
                StdoutWriter.WriteLine(responseJson);
            }
            catch (Exception ex)
            {
                LogToStderr($"Error writing RpcResponse: {ex.Message}");
            }
        }

        private void LogToStderr(string message)
        {
            HelperLogger.LogToStderr(message);
        }

        private static int[] ConvertKeycodes(List<long>? keycodes)
        {
            if (keycodes == null || keycodes.Count == 0) return Array.Empty<int>();
            return keycodes.Select(keycode => (int)keycode).ToArray();
        }

        private static int[][] ConvertChords(List<List<long>>? chords)
        {
            if (chords == null) return Array.Empty<int[]>();
            return chords.Select(ConvertKeycodes).ToArray();
        }
    }
}
