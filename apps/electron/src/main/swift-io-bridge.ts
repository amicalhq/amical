import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process'; // Added import for process
import { app, app as electronApp } from 'electron'; // electronApp for app.getAppPath() consistency
import split2 from 'split2';
import { v4 as uuid } from 'uuid';

import { RpcRequestSchema, RpcRequest } from '../schemas/helper-envelopes/request';
import { RpcResponseSchema, RpcResponse } from '../schemas/helper-envelopes/response';
import { HelperEventSchema, HelperEvent } from '../schemas/helper-events/key-event';

import {
  GetAccessibilityTreeDetailsParamsSchema,
  GetAccessibilityTreeDetailsParams,
} from '../schemas/helper-requests/get-accessibility-tree-details';
import {
  PasteTextParams,
  PasteTextParamsSchema, // Assuming you might use this for validation if needed client-side
} from '../schemas/helper-requests/paste-text';
import { EventEmitter } from 'events';
import {
  GetAccessibilityTreeDetailsResult,
  GetAccessibilityTreeDetailsResultSchema,
} from '../schemas/helper-responses/get-accessibility-tree-details';
import { PasteTextResult } from '../schemas/helper-responses/paste-text';
import { MuteSystemAudioResult } from '../schemas/helper-responses/mute-system-audio';
import { MuteSystemAudioParams } from '../schemas/helper-requests/mute-system-audio';
import { RestoreSystemAudioResult } from '../schemas/helper-responses/restore-system-audio';
import { RestoreSystemAudioParams } from '../schemas/helper-requests/restore-system-audio';

// Define the interface for RPC methods
interface RPCMethods {
  getAccessibilityTreeDetails: {
    params: GetAccessibilityTreeDetailsParams;
    result: GetAccessibilityTreeDetailsResult;
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
  private pending = new Map<string, (resp: RpcResponse) => void>();
  private helperPath: string;

  constructor() {
    super();
    this.helperPath = this.determineHelperPath();
    this.startHelperProcess();
  }

  private determineHelperPath(): string {
    const helperName = 'KeyTapHelper'; // Or your Swift executable name
    return electronApp.isPackaged
      ? path.join(process.resourcesPath, 'bin', helperName)
      : path.join(electronApp.getAppPath(), 'src', 'helper', 'bin', helperName);
  }

  private startHelperProcess(): void {
    try {
      fs.accessSync(this.helperPath, fs.constants.X_OK);
    } catch (err) {
      console.error(
        `SwiftIOBridge: KeyTapHelper executable not found or not executable at ${this.helperPath}.`
      );
      this.emit(
        'error',
        new Error(
          `Helper executable not found at ${this.helperPath}. Attempt to build it if in dev mode.`
        )
      );
      // In a real app, you might try to build it here or provide more robust error handling.
      return;
    }

    console.log(`SwiftIOBridge: Spawning KeyTapHelper from: ${this.helperPath}`);
    this.proc = spawn(this.helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.proc.stdout.pipe(split2()).on('data', (line: string) => {
      if (!line.trim()) return; // Ignore empty lines
      try {
        const message = JSON.parse(line);
        console.log('SwiftIOBridge: Received message from helper:', message);

        // Try to parse as RpcResponse first
        const responseValidation = RpcResponseSchema.safeParse(message);
        if (responseValidation.success) {
          const rpcResponse = responseValidation.data;
          if (this.pending.has(rpcResponse.id)) {
            const handler = this.pending.get(rpcResponse.id);
            handler!(rpcResponse); // Non-null assertion as we checked with has()
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
        console.warn('SwiftRpcClient: Received unknown message from helper:', message);
      } catch (e) {
        console.error('SwiftIOBridge: Error parsing JSON from helper:', e, 'Received line:', line);
        this.emit('error', new Error(`Error parsing JSON from helper: ${line}`));
      }
    });

    this.proc.stderr.on('data', (data: Buffer) => {
      const errorMsg = data.toString();
      console.error(`SwiftIOBridge: KeyTapHelper stderr: ${errorMsg}`);
      this.emit('error', new Error(`Helper stderr: ${errorMsg}`));
    });

    this.proc.on('error', (err) => {
      console.error('SwiftIOBridge: Failed to start KeyTapHelper process:', err);
      this.emit('error', err);
      this.proc = null;
    });

    this.proc.on('close', (code, signal) => {
      console.log(
        `SwiftIOBridge: KeyTapHelper process exited with code ${code} and signal ${signal}`
      );
      this.emit('close', code, signal);
      this.proc = null;
      // Optionally, implement retry logic or notify further
    });

    process.nextTick(() => {
      this.emit('ready'); // Emit ready on next tick
    });
    console.log('SwiftIOBridge: Helper process started and listeners attached.');
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
    const requestPayload: RpcRequest = { id, method, params };

    // Validate request payload before sending
    const validationResult = RpcRequestSchema.safeParse(requestPayload);
    if (!validationResult.success) {
      console.error(
        'SwiftRpcClient: Invalid RPC request payload:',
        validationResult.error.flatten()
      );
      return Promise.reject(
        new Error(`Invalid RPC request payload: ${validationResult.error.message}`)
      );
    }

    this.proc.stdin.write(JSON.stringify(requestPayload) + '\n', (err) => {
      if (err) {
        console.error('SwiftIOBridge: Error writing to helper stdin:', err);
        // Note: The promise might have already been set up, consider how to reject it.
        // For now, this error will be logged. The timeout will eventually reject.
      }
    });

    const responsePromise = new Promise<RPCMethods[M]['result']>((resolve, reject) => {
      this.pending.set(id, (resp: RpcResponse) => {
        this.pending.delete(id); // Clean up immediately
        if (resp.error) {
          const error = new Error(resp.error.message);
          (error as any).code = resp.error.code;
          (error as any).data = resp.error.data;
          reject(error);
        } else {
          // Log the raw resp.result before resolving
          console.log(
            'SwiftIOBridge: Raw resp.result received:',
            JSON.stringify(resp.result, null, 2)
          );
          // Here, we might need to validate resp.result against the specific method's result schema
          // For now, casting as any, but for type safety, validation is better.
          // Example: const resultValidation = RPCMethods[method].resultSchema.safeParse(resp.result);
          resolve(resp.result as any);
        }
      });
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        if (this.pending.has(id)) {
          // Check if still pending before rejecting
          this.pending.delete(id);
          reject(
            new Error(
              `SwiftIOBridge: RPC call "${method}" (id: ${id}) timed out after ${timeoutMs}ms`
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
      console.log('SwiftIOBridge: Stopping KeyTapHelper process...');
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
