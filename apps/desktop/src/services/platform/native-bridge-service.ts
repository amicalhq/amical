import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import path from "node:path";
import fs from "node:fs";
import { app as electronApp } from "electron";
import split2 from "split2";
import { v4 as uuid } from "uuid";
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
  GetAccessibilityContextParams,
  GetAccessibilityContextResult,
  GetAccessibilityStatusParams,
  GetAccessibilityStatusResult,
  RequestAccessibilityPermissionParams,
  RequestAccessibilityPermissionResult,
  PasteTextParams,
  PasteTextResult,
  MuteSystemAudioParams,
  MuteSystemAudioResult,
  RestoreSystemAudioParams,
  RestoreSystemAudioResult,
  SetShortcutsParams,
  SetShortcutsResult,
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
  private pending = new Map<
    string,
    { callback: (resp: RpcResponse) => void; startTime: number }
  >();
  private helperPath: string;
  private logger = createScopedLogger("native-bridge");
  private accessibilityContext: AppContext | null = null;

  // Auto-restart configuration
  private static readonly MAX_RESTARTS = 3;
  private static readonly RESTART_DELAY_MS = 1000;
  private static readonly RESTART_COUNT_RESET_MS = 30000; // Reset count after 30s of stability
  private restartCount = 0;
  private lastRestartTime = 0;
  private lastCrashInfo: { code: number | null; signal: string | null } | null =
    null;
  private telemetryService: TelemetryService | null = null;

  constructor(telemetryService?: TelemetryService) {
    super();
    this.telemetryService = telemetryService ?? null;
    this.helperPath = this.determineHelperPath();
    this.startHelperProcess();
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

      this.emit("error", new Error(errorMessage));

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
          if (this.pending.has(rpcResponse.id)) {
            const pendingItem = this.pending.get(rpcResponse.id);
            pendingItem!.callback(rpcResponse); // Non-null assertion as we checked with has()
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
      // Don't emit as error since stderr is often just debug info
      // this.emit('error', new Error(`Helper stderr: ${errorMsg}`));
    });

    this.proc.on("error", (err) => {
      const helperName = getNativeHelperName();
      this.logger.error(`Failed to start ${helperName} process`, {
        error: err,
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
        this.lastCrashInfo = { code, signal };
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
    if (!this.proc || !this.proc.stdin || !this.proc.stdin.writable) {
      const helperName = getNativeHelperName();
      const errorMessage = electronApp.isPackaged
        ? `${helperName} is not available for this operation.`
        : "Native helper process is not running or stdin is not writable.";

      this.logger.warn(`Cannot call ${method}: helper not available`, {
        method,
        isPackaged: electronApp.isPackaged,
        platform: process.platform,
      });

      return Promise.reject(new Error(errorMessage));
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

    this.proc.stdin.write(JSON.stringify(requestPayload) + "\n", (err) => {
      if (err) {
        this.logger.error("Error writing to helper stdin", {
          method,
          id,
          error: err,
        });
        // Note: The promise might have already been set up, consider how to reject it.
        // For now, this error will be logged. The timeout will eventually reject.
      } else {
        if (logLevel === "info") {
          this.logger.info("Successfully sent RPC request", { method, id });
        } else {
          this.logger.debug("Successfully sent RPC request", { method, id });
        }
      }
    });

    const responsePromise = new Promise<RPCMethods[M]["result"]>(
      (resolve, reject) => {
        this.pending.set(id, {
          callback: (resp: RpcResponse) => {
            this.pending.delete(id); // Clean up immediately
            const completedAt = Date.now();
            const duration = completedAt - startTime;

            if (resp.error) {
              const error = new Error(resp.error.message);
              (error as any).code = resp.error.code;
              (error as any).data = resp.error.data;
              reject(error);
            } else {
              // Log at INFO level for critical audio operations, DEBUG for others
              const logLevel =
                method === "muteSystemAudio" || method === "restoreSystemAudio"
                  ? "info"
                  : "debug";

              // Log the raw resp.result with timing information
              const logData = {
                method,
                id,
                result: resp.result,
                startedAt: new Date(startTime).toISOString(),
                completedAt: new Date(completedAt).toISOString(),
                durationMs: duration,
              };

              if (logLevel === "info") {
                this.logger.info("RPC response received", logData);
              } else {
                this.logger.debug("Raw RPC response result received", logData);
              }

              // Here, we might need to validate resp.result against the specific method's result schema
              // For now, casting as any, but for type safety, validation is better.
              // Example: const resultValidation = RPCMethods[method].resultSchema.safeParse(resp.result);
              resolve(resp.result as any);
            }
          },
          startTime,
        });
      },
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        if (this.pending.has(id)) {
          // Check if still pending before rejecting
          this.pending.delete(id);
          const timedOutAt = Date.now();
          const duration = timedOutAt - startTime;
          reject(
            new Error(
              `NativeBridge: RPC call "${method}" (id: ${id}) timed out after ${timeoutMs}ms (duration: ${duration}ms, started: ${new Date(startTime).toISOString()})`,
            ),
          );
        }
      }, timeoutMs);
    });

    return Promise.race([responsePromise, timeoutPromise]);
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
