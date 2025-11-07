import { fork, ChildProcess } from "child_process";
import { app } from "electron";
import * as path from "path";
import { logger } from "../../../main/logger";

interface WorkerMessage {
  id: number;
  method: string;
  args: any[];
}

interface WorkerResponse {
  id: number;
  result?: any;
  error?: string;
}

export class SimpleForkWrapper {
  private worker: ChildProcess | null = null;
  private messageId = 0;
  private pendingCalls = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: any) => void;
    }
  >();

  constructor(
    private workerPath: string,
    private nodeBinaryPath: string,
  ) {}

  async initialize(): Promise<void> {
    if (this.worker) return;

    logger.transcription.info(`Starting worker process: ${this.workerPath}`);

    // When packaged, we need to extract the worker to a temp file
    // because fork needs an actual file path, not an asar path
    let actualWorkerPath = this.workerPath;

    // Set up environment for the worker
    const workerEnv: any = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_OPTIONS: "--max-old-space-size=8192",
    };

    if (app.isPackaged && this.workerPath.includes(".asar")) {
      // For packaged app, use the unpacked worker
      actualWorkerPath = this.workerPath.replace(
        "app.asar",
        "app.asar.unpacked",
      );
      workerEnv.APP_ASAR_PATH = path.join(process.resourcesPath, "app.asar");
      logger.transcription.info(`Using unpacked worker: ${actualWorkerPath}`);
    }

    this.worker = fork(actualWorkerPath, [], {
      execPath: this.nodeBinaryPath,
      env: workerEnv,
      silent: true,
      cwd: app.isPackaged ? process.resourcesPath : process.cwd(),
    });

    this.worker.on("message", (message: WorkerResponse) => {
      if (message.id !== undefined && this.pendingCalls.has(message.id)) {
        const { resolve, reject } = this.pendingCalls.get(message.id)!;
        this.pendingCalls.delete(message.id);

        if (message.error) {
          reject(new Error(message.error));
        } else {
          resolve(message.result);
        }
      }
    });

    this.worker.on("error", (error) => {
      logger.transcription.error("Worker process error:", error);
      this.rejectAllPending(error);
    });

    this.worker.on("exit", (code, signal) => {
      logger.transcription.info(
        `Worker process exited: code=${code}, signal=${signal}`,
      );
      this.worker = null;
      this.rejectAllPending(new Error(`Worker exited with code ${code}`));
    });
  }

  private rejectAllPending(error: Error): void {
    for (const { reject } of this.pendingCalls.values()) {
      reject(error);
    }
    this.pendingCalls.clear();
  }

  async exec<T>(method: string, args: unknown[]): Promise<T> {
    if (!this.worker) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      const id = this.messageId++;
      this.pendingCalls.set(id, { resolve, reject });

      // Convert Float32Array to regular array for IPC
      const serializedArgs = args.map((arg) => {
        if (arg instanceof Float32Array) {
          return {
            __type: "Float32Array",
            data: Array.from(arg),
          };
        }
        return arg;
      });

      this.worker!.send({
        id,
        method,
        args: serializedArgs,
      } as WorkerMessage);
    });
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      this.worker.kill();
      this.worker = null;
      this.pendingCalls.clear();
    }
  }
}
