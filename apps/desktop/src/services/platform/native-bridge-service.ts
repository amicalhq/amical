import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import path from "node:path";
import fs from "node:fs";
import { app as electronApp } from "electron";
import split2 from "split2";
import { v4 as uuid } from "uuid";
import type { ZodTypeAny } from "zod";
import { getNativeHelperName, getNativeHelperDir } from "../../utils/platform";

import { EventEmitter } from "events";
import { createScopedLogger } from "../../main/logger";
import type { TelemetryService } from "../telemetry-service";
import {
  RpcRequestSchema,
  RpcRequest,
  RpcResponseSchema,
  RpcResponse,
  HelperEventSchema,
  HelperEvent,
  GetAccessibilityTreeDetailsParams,
  GetAccessibilityTreeDetailsResult,
  GetAccessibilityTreeDetailsResultSchema,
  GetAccessibilityContextParams,
  GetAccessibilityContextResult,
  GetAccessibilityContextResultSchema,
  GetAccessibilityStatusParams,
  GetAccessibilityStatusResult,
  GetAccessibilityStatusResultSchema,
  RequestAccessibilityPermissionParams,
  RequestAccessibilityPermissionResult,
  RequestAccessibilityPermissionResultSchema,
  PasteTextParams,
  PasteTextResult,
  PasteTextResultSchema,
  MuteSystemAudioParams,
  MuteSystemAudioResult,
  MuteSystemAudioResultSchema,
  RestoreSystemAudioParams,
  RestoreSystemAudioResult,
  RestoreSystemAudioResultSchema,
  SetShortcutsParams,
  SetShortcutsResult,
  SetShortcutsResultSchema,
  RecheckPressedKeysParams,
  RecheckPressedKeysResult,
  RecheckPressedKeysResultSchema,
  AppContext,
} from "@amical/types";

// Define the interface for RPC methods
interface RPCMethods {
  getAccessibilityTreeDetails: {
    params: GetAccessibilityTreeDetailsParams;
    result: GetAccessibilityTreeDetailsResult;
  };
  getAccessibilityContext: {
    params: GetAccessibilityContextParams;
    result: GetAccessibilityContextResult;
  };
  getAccessibilityStatus: {
    params: GetAccessibilityStatusParams;
    result: GetAccessibilityStatusResult;
  };
  requestAccessibilityPermission: {
    params: RequestAccessibilityPermissionParams;
    result: RequestAccessibilityPermissionResult;
  };
  pasteText: {
    params: PasteTextParams;
    result: PasteTextResult;
  };
  muteSystemAudio: {
    params: MuteSystemAudioParams;
    result: MuteSystemAudioResult;
  };
  restoreSystemAudio: {
    params: RestoreSystemAudioParams;
    result: RestoreSystemAudioResult;
  };
  setShortcuts: {
    params: SetShortcutsParams;
    result: SetShortcutsResult;
  };
  recheckPressedKeys: {
    params: RecheckPressedKeysParams;
    result: RecheckPressedKeysResult;
  };
}

type PendingRpc = {
  method: keyof RPCMethods;
  startTime: number;
  timeoutMs: number;
  timeoutHandle: NodeJS.Timeout;
  // These come from the Promise constructor and are intentionally widened so we can
  // store them in a non-generic map (method is the real source of typing here).
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

const RPC_RESULT_SCHEMAS: Record<keyof RPCMethods, ZodTypeAny> = {
  getAccessibilityTreeDetails: GetAccessibilityTreeDetailsResultSchema,
  getAccessibilityContext: GetAccessibilityContextResultSchema,
  getAccessibilityStatus: GetAccessibilityStatusResultSchema,
  requestAccessibilityPermission: RequestAccessibilityPermissionResultSchema,
  pasteText: PasteTextResultSchema,
  muteSystemAudio: MuteSystemAudioResultSchema,
  restoreSystemAudio: RestoreSystemAudioResultSchema,
  setShortcuts: SetShortcutsResultSchema,
  recheckPressedKeys: RecheckPressedKeysResultSchema,
};

class NativeBridgeTimeoutError extends Error {
  constructor(
    message: string,
    public readonly method: string,
    public readonly requestId: string,
    public readonly timeoutMs: number,
    public readonly durationMs: number,
  ) {
    super(message);
    this.name = "NativeBridgeTimeoutError";
  }
}

class NativeBridgeHelperUnavailableError extends Error {
  constructor(
    message: string,
    public readonly method: string,
  ) {
    super(message);
    this.name = "NativeBridgeHelperUnavailableError";
  }
}

class NativeBridgeWriteError extends Error {
  constructor(
    message: string,
    public readonly method: string,
    public readonly requestId: string,
    public readonly originalError: unknown,
  ) {
    super(message);
    this.name = "NativeBridgeWriteError";
  }
}

class NativeBridgeRpcResponseError extends Error {
  constructor(
    message: string,
    public readonly method: string,
    public readonly requestId: string,
    public readonly rpcCode: number,
    public readonly rpcData: unknown,
  ) {
    super(message);
    this.name = "NativeBridgeRpcResponseError";
  }
}

class NativeBridgeInvalidResponseError extends Error {
  constructor(
    message: string,
    public readonly method: string,
    public readonly requestId: string,
    public readonly validationError: string,
  ) {
    super(message);
    this.name = "NativeBridgeInvalidResponseError";
  }
}

class NativeBridgeHelperCrashedError extends Error {
  constructor(
    message: string,
    public readonly helperName: string,
    public readonly method: string,
    public readonly requestId: string,
    public readonly exitCode: number | null,
    public readonly signal: NodeJS.Signals | null,
  ) {
    super(message);
    this.name = "NativeBridgeHelperCrashedError";
  }
}

// Define event types for the client
interface NativeBridgeEvents {
  helperEvent: (event: HelperEvent) => void;
  error: (error: Error) => void;
  close: (code: number | null, signal: NodeJS.Signals | null) => void;
  ready: () => void; // Emitted when the helper process is successfully spawned
}

export class NativeBridge extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingRpc>();
  private helperPath: string;
  private logger = createScopedLogger("native-bridge");
  private accessibilityContext: AppContext | null = null;

  // Auto-restart configuration
  private static readonly MAX_RESTARTS = 3;
  private static readonly RESTART_DELAY_MS = 1000;
  private static readonly RESTART_COUNT_RESET_MS = 30000; // Reset count after 30s of stability
  // Keep a rolling buffer of stderr lines so crashes can include some native context,
  // but cap what we send in telemetry to bound payload size and PII exposure.
  private static readonly HELPER_STDERR_BUFFER_LINES_LIMIT = 80;
  private static readonly HELPER_STDERR_TAIL_LINES = 20;
  private static readonly HELPER_STDERR_TAIL_CHAR_LIMIT = 4000;
  private restartCount = 0;
  private lastRestartTime = 0;
  private lastCrashInfo: { code: number | null; signal: string | null } | null =
    null;
  private helperStderrLines: string[] = [];
  private telemetryService: TelemetryService | null = null;

  constructor(telemetryService?: TelemetryService) {
    super();
    this.telemetryService = telemetryService ?? null;
    this.helperPath = this.determineHelperPath();
    this.startHelperProcess();
  }

  private popPending(id: string): PendingRpc | null {
    const pending = this.pending.get(id);
    if (!pending) {
      return null;
    }

    clearTimeout(pending.timeoutHandle);
    this.pending.delete(id);
    return pending;
  }

  private rejectAllPendingOnCrash(
    helperName: string,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.pending.size === 0) {
      return;
    }

    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(
        new NativeBridgeHelperCrashedError(
          `${helperName} process crashed (code: ${code}, signal: ${signal})`,
          helperName,
          pending.method,
          id,
          code,
          signal,
        ),
      );
    }
    this.pending.clear();
  }

  private determineHelperPath(): string {
    const helperName = getNativeHelperName();
    const helperDir = getNativeHelperDir();

    return electronApp.isPackaged
      ? path.join(process.resourcesPath, "bin", helperName)
      : path.join(
          electronApp.getAppPath(),
          "..",
          "..",
          "packages",
          "native-helpers",
          helperDir,
          "bin",
          helperName,
        );
  }

  private startHelperProcess(): void {
    try {
      fs.accessSync(this.helperPath, fs.constants.X_OK);
    } catch (err) {
      const helperName = getNativeHelperName();
      this.logger.error(
        `${helperName} executable not found or not executable`,
        {
          helperPath: this.helperPath,
        },
      );
      // In production, provide a more user-friendly error message
      const errorMessage = electronApp.isPackaged
        ? `${helperName} is not available. Some features may not work correctly.`
        : `Helper executable not found at ${this.helperPath}. Please build it first.`;

      const startupError = new Error(errorMessage);
      this.emit("error", startupError);
      this.telemetryService?.captureException(startupError, {
        source: "native_helper",
        stage: "startup",
        helper_name: helperName,
        helper_path: this.helperPath,
        is_packaged: electronApp.isPackaged,
      });

      // Log detailed error for debugging
      this.logger.error("Helper initialization failed", {
        helperPath: this.helperPath,
        isPackaged: electronApp.isPackaged,
        platform: process.platform,
        error: err,
      });

      return;
    }

    const helperName = getNativeHelperName();
    this.logger.info(`Spawning ${helperName}`, { helperPath: this.helperPath });
    this.helperStderrLines = [];
    this.proc = spawn(this.helperPath, [], { stdio: ["pipe", "pipe", "pipe"] });

    this.proc.stdout.pipe(split2()).on("data", (line: string) => {
      if (!line.trim()) return; // Ignore empty lines
      try {
        const message = JSON.parse(line);
        this.logger.debug("Received message from helper", { message });

        // Try to parse as RpcResponse first
        const responseValidation = RpcResponseSchema.safeParse(message);
        if (responseValidation.success) {
          const rpcResponse = responseValidation.data;
          const pendingItem = this.popPending(rpcResponse.id);
          if (pendingItem) {
            const completedAt = Date.now();
            const duration = completedAt - pendingItem.startTime;

            if (rpcResponse.error) {
              const error = new NativeBridgeRpcResponseError(
                `NativeBridge: RPC call "${pendingItem.method}" (id: ${rpcResponse.id}) failed with code ${rpcResponse.error.code}: ${rpcResponse.error.message}`,
                pendingItem.method,
                rpcResponse.id,
                rpcResponse.error.code,
                rpcResponse.error.data,
              );
              this.telemetryService?.captureException(error, {
                source: "native_helper",
                stage: "rpc_response_error",
                method: pendingItem.method,
                request_id: rpcResponse.id,
                rpc_code: rpcResponse.error.code,
              });
              pendingItem.reject(error);
              return;
            }

            // Log at INFO level for critical audio operations, DEBUG for others
            const logLevel =
              pendingItem.method === "muteSystemAudio" ||
              pendingItem.method === "restoreSystemAudio"
                ? "info"
                : "debug";

            // Log the raw resp.result with timing information
            const logData = {
              method: pendingItem.method,
              id: rpcResponse.id,
              result: rpcResponse.result,
              startedAt: new Date(pendingItem.startTime).toISOString(),
              completedAt: new Date(completedAt).toISOString(),
              durationMs: duration,
            };

            if (logLevel === "info") {
              this.logger.info("RPC response received", logData);
            } else {
              this.logger.debug("Raw RPC response result received", logData);
            }

            const resultSchema = RPC_RESULT_SCHEMAS[pendingItem.method];
            const resultValidation = resultSchema.safeParse(rpcResponse.result);
            if (!resultValidation.success) {
              const error = new NativeBridgeInvalidResponseError(
                `NativeBridge: Invalid RPC result for "${pendingItem.method}" (id: ${rpcResponse.id})`,
                pendingItem.method,
                rpcResponse.id,
                resultValidation.error.message,
              );
              this.telemetryService?.captureException(error, {
                source: "native_helper",
                stage: "rpc_invalid_response",
                method: pendingItem.method,
                request_id: rpcResponse.id,
                validation_error: resultValidation.error.message,
              });
              pendingItem.reject(error);
              return;
            }

            pendingItem.resolve(resultValidation.data);
            return; // Handled as an RPC response
          }
        }

        // If not a pending RpcResponse, try to parse as HelperEvent
        const eventValidation = HelperEventSchema.safeParse(message);
        if (eventValidation.success) {
          const helperEvent = eventValidation.data;
          this.emit("helperEvent", helperEvent);
          return; // Handled as a helper event
        }

        // If it's neither a recognized RPC response nor a helper event
        this.logger.warn("Received unknown message from helper", { message });
      } catch (e) {
        this.logger.error("Error parsing JSON from helper", { error: e, line });
        this.telemetryService?.captureException(e, {
          source: "native_helper",
          stage: "stdout_parse",
          helper_name: getNativeHelperName(),
          raw_line: line.slice(0, 2000),
        });
        this.emit(
          "error",
          new Error(`Error parsing JSON from helper: ${line}`),
        );
      }
    });

    this.proc.stderr.on("data", (data: Buffer) => {
      const errorMsg = data.toString();
      const helperName = getNativeHelperName();
      this.logger.warn(`${helperName} stderr output`, { message: errorMsg });

      const stderrLines = errorMsg
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (stderrLines.length > 0) {
        this.helperStderrLines.push(...stderrLines);
        if (
          this.helperStderrLines.length >
          NativeBridge.HELPER_STDERR_BUFFER_LINES_LIMIT
        ) {
          this.helperStderrLines.splice(
            0,
            this.helperStderrLines.length -
              NativeBridge.HELPER_STDERR_BUFFER_LINES_LIMIT,
          );
        }
      }
      // Don't emit as error since stderr is often just debug info
      // this.emit('error', new Error(`Helper stderr: ${errorMsg}`));
    });

    this.proc.on("error", (err) => {
      const helperName = getNativeHelperName();
      this.logger.error(`Failed to start ${helperName} process`, {
        error: err,
      });
      this.telemetryService?.captureException(err, {
        source: "native_helper",
        stage: "spawn",
        helper_name: helperName,
        helper_path: this.helperPath,
      });
      this.emit("error", err);
      this.proc = null;
    });

    this.proc.on("close", (code, signal) => {
      const helperName = getNativeHelperName();
      const isNormalExit = code === 0 && signal === null;
      const isIntentionalKill = signal === "SIGTERM";

      if (isNormalExit || isIntentionalKill) {
        this.logger.info(`${helperName} process exited normally`);
      } else {
        this.logger.error(`${helperName} process crashed`, { code, signal });
        const helperStderrTail = this.helperStderrLines
          .slice(-NativeBridge.HELPER_STDERR_TAIL_LINES)
          .join("\n")
          .slice(-NativeBridge.HELPER_STDERR_TAIL_CHAR_LIMIT);
        this.telemetryService?.captureException(
          new Error(
            `${helperName} process crashed (code: ${code}, signal: ${signal})`,
          ),
          {
            source: "native_helper",
            stage: "process_close",
            helper_name: helperName,
            exit_code: code,
            signal,
            helper_stderr_tail: helperStderrTail || undefined,
          },
        );
        this.lastCrashInfo = { code, signal };
        this.rejectAllPendingOnCrash(helperName, code, signal);
      }

      this.emit("close", code, signal);
      this.proc = null;

      // Auto-restart on crash
      if (!isNormalExit && !isIntentionalKill) {
        this.attemptRestart();
      }
    });

    process.nextTick(() => {
      this.emit("ready"); // Emit ready on next tick
    });
    this.logger.info("Helper process started and listeners attached");
  }

  private attemptRestart(): void {
    const helperName = getNativeHelperName();
    const now = Date.now();

    // Reset restart count if enough time has passed since last restart
    if (now - this.lastRestartTime > NativeBridge.RESTART_COUNT_RESET_MS) {
      this.restartCount = 0;
    }

    const willRestart = this.restartCount < NativeBridge.MAX_RESTARTS;

    // Track crash telemetry
    this.telemetryService?.trackNativeHelperCrashed({
      helper_name: helperName,
      platform: process.platform,
      exit_code: this.lastCrashInfo?.code ?? null,
      signal: this.lastCrashInfo?.signal ?? null,
      restart_attempt: this.restartCount + 1,
      max_restarts: NativeBridge.MAX_RESTARTS,
      will_restart: willRestart,
    });

    if (!willRestart) {
      this.logger.error(
        `${helperName} crashed too many times, not restarting`,
        {
          restartCount: this.restartCount,
          maxRestarts: NativeBridge.MAX_RESTARTS,
        },
      );
      return;
    }

    this.restartCount++;
    this.lastRestartTime = now;

    this.logger.info(
      `Restarting ${helperName} in ${NativeBridge.RESTART_DELAY_MS}ms`,
      {
        attempt: this.restartCount,
        maxRestarts: NativeBridge.MAX_RESTARTS,
      },
    );

    setTimeout(() => {
      this.startHelperProcess();
    }, NativeBridge.RESTART_DELAY_MS);
  }

  public call<M extends keyof RPCMethods>(
    method: M,
    params: RPCMethods[M]["params"],
    timeoutMs = 5000,
  ): Promise<RPCMethods[M]["result"]> {
    const proc = this.proc;
    if (!proc || !proc.stdin || !proc.stdin.writable) {
      const helperName = getNativeHelperName();
      const errorMessage = electronApp.isPackaged
        ? `${helperName} is not available for this operation.`
        : "Native helper process is not running or stdin is not writable.";

      this.logger.warn(`Cannot call ${method}: helper not available`, {
        method,
        isPackaged: electronApp.isPackaged,
        platform: process.platform,
      });

      const error = new NativeBridgeHelperUnavailableError(
        errorMessage,
        method,
      );
      this.telemetryService?.captureException(error, {
        source: "native_helper",
        stage: "rpc_helper_unavailable",
        method: method,
      });
      return Promise.reject(error);
    }

    const id = uuid();
    const startTime = Date.now();
    const requestPayload: RpcRequest = { id, method, params };

    // Validate request payload before sending
    const validationResult = RpcRequestSchema.safeParse(requestPayload);
    if (!validationResult.success) {
      this.logger.error("Invalid RPC request payload", {
        method,
        error: validationResult.error.flatten(),
      });
      this.telemetryService?.captureException(
        new Error(`Invalid RPC request payload for method: ${method}`),
        {
          source: "native_helper",
          stage: "rpc_validation",
          method: method,
          validation_error: validationResult.error.message,
        },
      );
      return Promise.reject(
        new Error(
          `Invalid RPC request payload: ${validationResult.error.message}`,
        ),
      );
    }

    // Log at INFO level for critical audio operations, DEBUG for others
    const logLevel =
      method === "muteSystemAudio" || method === "restoreSystemAudio"
        ? "info"
        : "debug";
    const logMessage = `Sending RPC request: ${method}`;

    if (logLevel === "info") {
      this.logger.info(logMessage, {
        method,
        id,
        startedAt: new Date(startTime).toISOString(),
      });
    } else {
      this.logger.debug(logMessage, {
        method,
        id,
        startedAt: new Date(startTime).toISOString(),
      });
    }

    return new Promise<RPCMethods[M]["result"]>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        const pendingItem = this.popPending(id);
        if (!pendingItem) {
          return;
        }

        const timedOutAt = Date.now();
        const duration = timedOutAt - pendingItem.startTime;
        const error = new NativeBridgeTimeoutError(
          `NativeBridge: RPC call "${method}" (id: ${id}) timed out after ${timeoutMs}ms (duration: ${duration}ms, started: ${new Date(startTime).toISOString()})`,
          method,
          id,
          timeoutMs,
          duration,
        );
        this.telemetryService?.captureException(error, {
          source: "native_helper",
          stage: "rpc_timeout",
          method: method,
          request_id: id,
          timeout_ms: timeoutMs,
          duration_ms: duration,
        });
        pendingItem.reject(error);
      }, timeoutMs);

      this.pending.set(id, {
        method,
        startTime,
        timeoutMs,
        timeoutHandle,
        resolve: resolve as unknown as (result: unknown) => void,
        reject: reject as unknown as (error: Error) => void,
      });

      try {
        proc.stdin.write(JSON.stringify(requestPayload) + "\n", (err) => {
          if (err) {
            this.logger.error("Error writing to helper stdin", {
              method,
              id,
              error: err,
            });
            this.telemetryService?.captureException(err, {
              source: "native_helper",
              stage: "rpc_write",
              method: method,
              request_id: id,
            });

            const pendingItem = this.popPending(id);
            if (!pendingItem) {
              return;
            }

            pendingItem.reject(
              new NativeBridgeWriteError(
                `NativeBridge: Failed to write RPC call "${method}" (id: ${id}) to helper stdin`,
                method,
                id,
                err,
              ),
            );
            return;
          }

          if (logLevel === "info") {
            this.logger.info("Successfully sent RPC request", { method, id });
          } else {
            this.logger.debug("Successfully sent RPC request", { method, id });
          }
        });
      } catch (err) {
        this.logger.error("Error writing to helper stdin (threw)", {
          method,
          id,
          error: err,
        });
        this.telemetryService?.captureException(err, {
          source: "native_helper",
          stage: "rpc_write_throw",
          method: method,
          request_id: id,
        });

        const pendingItem = this.popPending(id);
        if (!pendingItem) {
          return;
        }

        pendingItem.reject(
          new NativeBridgeWriteError(
            `NativeBridge: Failed to write RPC call "${method}" (id: ${id}) to helper stdin (threw)`,
            method,
            id,
            err,
          ),
        );
      }
    });
  }

  public isHelperRunning(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  public stopHelper(): void {
    if (this.proc) {
      const helperName = getNativeHelperName();
      this.logger.info(`Stopping ${helperName} process`);
      this.proc.kill();
      this.proc = null;
    }
  }

  /**
   * Refresh the cached accessibility context from the native helper.
   * This is called asynchronously when recording starts.
   */
  async refreshAccessibilityContext(): Promise<void> {
    try {
      const result = await this.call("getAccessibilityContext", {
        editableOnly: false,
      });
      this.accessibilityContext = result.context;
      this.logger.debug("Accessibility context refreshed", {
        hasApplication: !!result.context?.application?.name,
        hasFocusedElement: !!result.context?.focusedElement?.role,
        hasTextSelection: !!result.context?.textSelection?.selectedText,
        extractionMethod: result.context?.textSelection?.extractionMethod,
        metricsMs: result.context?.metrics?.totalTimeMs,
      });
    } catch (error) {
      this.logger.error("Failed to refresh accessibility context", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get the cached accessibility context.
   * Returns in the result wrapper format for API consistency.
   */
  getAccessibilityContext(): GetAccessibilityContextResult | null {
    if (this.accessibilityContext === null) {
      return null;
    }
    return { context: this.accessibilityContext };
  }

  /**
   * Send the configured shortcuts to the native helper for key consumption.
   * When these shortcuts are pressed, the native helper will consume the key events
   * to prevent default behavior (e.g., cursor movement for arrow keys).
   */
  async setShortcuts(shortcuts: SetShortcutsParams): Promise<boolean> {
    try {
      const result = await this.call("setShortcuts", shortcuts);
      this.logger.info("Shortcuts synced to native helper", {
        pushToTalk: shortcuts.pushToTalk,
        toggleRecording: shortcuts.toggleRecording,
        pasteLastTranscript: shortcuts.pasteLastTranscript,
        newNote: shortcuts.newNote,
        success: result.success,
      });
      return result.success;
    } catch (error) {
      this.logger.error("Failed to sync shortcuts to native helper", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Recheck pressed keys against OS truth. Returns stale keys.
   */
  async recheckPressedKeys(
    params: RecheckPressedKeysParams,
  ): Promise<RecheckPressedKeysResult> {
    return this.call("recheckPressedKeys", params);
  }

  /**
   * Get accessibility permission status.
   */
  async getAccessibilityStatus(): Promise<GetAccessibilityStatusResult> {
    return this.call("getAccessibilityStatus", {});
  }

  /**
   * Request accessibility permission.
   */
  async requestAccessibilityPermission(): Promise<RequestAccessibilityPermissionResult> {
    return this.call("requestAccessibilityPermission", {});
  }

  // Typed event emitter methods
  on<E extends keyof NativeBridgeEvents>(
    event: E,
    listener: NativeBridgeEvents[E],
  ): this {
    super.on(event, listener);
    return this;
  }

  emit<E extends keyof NativeBridgeEvents>(
    event: E,
    ...args: Parameters<NativeBridgeEvents[E]>
  ): boolean {
    return super.emit(event, ...args);
  }
}
