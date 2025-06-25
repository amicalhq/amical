import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process'; // Added import for process
import { app, app as electronApp } from 'electron'; // electronApp for app.getAppPath() consistency
import split2 from 'split2';
import { v4 as uuid } from 'uuid';

import { EventEmitter } from 'events';
import { createScopedLogger } from './logger';
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
  PasteTextParams,
  PasteTextResult,
  MuteSystemAudioParams,
  MuteSystemAudioResult,
  RestoreSystemAudioParams,
  RestoreSystemAudioResult,
} from '@amical/types';

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
  // Add other methods here, e.g.:
  // setLogLevel: { params: SetLogLevelParams; result: SetLogLevelResult };
}

// Define event types for the client
interface SwiftIOBridgeEvents {
  helperEvent: (event: HelperEvent) => void;
  error: (error: Error) => void;
  close: (code: number | null, signal: NodeJS.Signals | null) => void;
  ready: () => void; // Emitted when the helper process is successfully spawned
}

export class SwiftIOBridge extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, { callback: (resp: RpcResponse) => void; startTime: number }>();
  private helperPath: string;
  private logger = createScopedLogger('swift-bridge');

  constructor() {
    super();
    this.helperPath = this.determineHelperPath();
    this.startHelperProcess();
  }

  private determineHelperPath(): string {
    const helperName = 'SwiftHelper'; // Swift native helper executable
    return electronApp.isPackaged
      ? path.join(process.resourcesPath, 'bin', helperName)
      : path.join(
          electronApp.getAppPath(),
          '..',
          '..',
          'packages',
          'native-helpers',
          'swift-helper',
          'bin',
          helperName
        );
  }

  private startHelperProcess(): void {
    try {
      fs.accessSync(this.helperPath, fs.constants.X_OK);
    } catch (err) {
      this.logger.error('SwiftHelper executable not found or not executable', {
        helperPath: this.helperPath,
      });
      this.emit(
        'error',
        new Error(
          `Helper executable not found at ${this.helperPath}. Attempt to build it if in dev mode.`
        )
      );
      // In a real app, you might try to build it here or provide more robust error handling.
      return;
    }

    this.logger.info('Spawning SwiftHelper', { helperPath: this.helperPath });
    this.proc = spawn(this.helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.proc.stdout.pipe(split2()).on('data', (line: string) => {
      if (!line.trim()) return; // Ignore empty lines
      try {
        const message = JSON.parse(line);
        this.logger.debug('Received message from helper', { message });

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
          this.emit('helperEvent', helperEvent);
          return; // Handled as a helper event
        }

        // If it's neither a recognized RPC response nor a helper event
        this.logger.warn('Received unknown message from helper', { message });
      } catch (e) {
        this.logger.error('Error parsing JSON from helper', { error: e, line });
        this.emit('error', new Error(`Error parsing JSON from helper: ${line}`));
      }
    });

    this.proc.stderr.on('data', (data: Buffer) => {
      const errorMsg = data.toString();
      this.logger.warn('SwiftHelper stderr output', { message: errorMsg });
      // Don't emit as error since stderr is often just debug info
      // this.emit('error', new Error(`Helper stderr: ${errorMsg}`));
    });

    this.proc.on('error', (err) => {
      this.logger.error('Failed to start SwiftHelper process', { error: err });
      this.emit('error', err);
      this.proc = null;
    });

    this.proc.on('close', (code, signal) => {
      this.logger.info('SwiftHelper process exited', { code, signal });
      this.emit('close', code, signal);
      this.proc = null;
      // Optionally, implement retry logic or notify further
    });

    process.nextTick(() => {
      this.emit('ready'); // Emit ready on next tick
    });
    this.logger.info('Helper process started and listeners attached');
  }

  public call<M extends keyof RPCMethods>(
    method: M,
    params: RPCMethods[M]['params'],
    timeoutMs = 5000
  ): Promise<RPCMethods[M]['result']> {
    if (!this.proc || !this.proc.stdin || !this.proc.stdin.writable) {
      return Promise.reject(
        new Error('Swift helper process is not running or stdin is not writable.')
      );
    }

    const id = uuid();
    const startTime = Date.now();
    const requestPayload: RpcRequest = { id, method, params };

    // Validate request payload before sending
    const validationResult = RpcRequestSchema.safeParse(requestPayload);
    if (!validationResult.success) {
      this.logger.error('Invalid RPC request payload', {
        method,
        error: validationResult.error.flatten(),
      });
      return Promise.reject(
        new Error(`Invalid RPC request payload: ${validationResult.error.message}`)
      );
    }

    this.logger.debug('Sending RPC request', {
      method,
      id,
      startedAt: new Date(startTime).toISOString(),
    });
    this.proc.stdin.write(JSON.stringify(requestPayload) + '\n', (err) => {
      if (err) {
        this.logger.error('Error writing to helper stdin', { method, id, error: err });
        // Note: The promise might have already been set up, consider how to reject it.
        // For now, this error will be logged. The timeout will eventually reject.
      } else {
        this.logger.debug('Successfully sent RPC request', { method, id });
      }
    });

    const responsePromise = new Promise<RPCMethods[M]['result']>((resolve, reject) => {
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
            // Log the raw resp.result with timing information
            this.logger.debug('Raw RPC response result received', {
              method,
              id,
              result: resp.result,
              startedAt: new Date(startTime).toISOString(),
              completedAt: new Date(completedAt).toISOString(),
              durationMs: duration,
            });
            // Here, we might need to validate resp.result against the specific method's result schema
            // For now, casting as any, but for type safety, validation is better.
            // Example: const resultValidation = RPCMethods[method].resultSchema.safeParse(resp.result);
            resolve(resp.result as any);
          }
        },
        startTime,
      });
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        if (this.pending.has(id)) {
          // Check if still pending before rejecting
          this.pending.delete(id);
          const timedOutAt = Date.now();
          const duration = timedOutAt - startTime;
          reject(
            new Error(
              `SwiftIOBridge: RPC call "${method}" (id: ${id}) timed out after ${timeoutMs}ms (duration: ${duration}ms, started: ${new Date(startTime).toISOString()})`
            )
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
      this.logger.info('Stopping SwiftHelper process');
      this.proc.kill();
      this.proc = null;
    }
  }

  // Typed event emitter methods
  on<E extends keyof SwiftIOBridgeEvents>(event: E, listener: SwiftIOBridgeEvents[E]): this {
    super.on(event, listener);
    return this;
  }

  emit<E extends keyof SwiftIOBridgeEvents>(
    event: E,
    ...args: Parameters<SwiftIOBridgeEvents[E]>
  ): boolean {
    return super.emit(event, ...args);
  }
}
