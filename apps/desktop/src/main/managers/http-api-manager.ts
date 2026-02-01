import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import * as http from "node:http";
import type { Server } from "node:http";
import { logger } from "../logger";
import { router } from "../../trpc/router";
import { createContext } from "../../trpc/context";
import type { ServiceManager } from "./service-manager";

const DEFAULT_PORT = 21417;

/**
 * Manages the localhost HTTP API server for external integrations
 * Exposes the tRPC router over HTTP on localhost only
 */
export class HttpApiManager {
  private server: Server | null = null;
  private serviceManager: ServiceManager;
  private port: number;

  constructor(serviceManager: ServiceManager, port: number = DEFAULT_PORT) {
    this.serviceManager = serviceManager;
    this.port = port;
  }

  async start(): Promise<void> {
    if (this.server) {
      logger.main.warn("HTTP API server is already running");
      return;
    }

    try {
      const trpcHandler = createHTTPHandler({
        router,
        createContext: async () => createContext(this.serviceManager),
      });

      this.server = http.createServer((req, res) => {
        // CORS headers for local development
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, OPTIONS"
        );
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization"
        );

        // Handle preflight requests
        if (req.method === "OPTIONS") {
          res.writeHead(200);
          res.end();
          return;
        }

        trpcHandler(req, res);
      });

      // Listen only on localhost for security
      await new Promise<void>((resolve, reject) => {
        this.server!.listen(this.port, "127.0.0.1", () => {
          logger.main.info(`HTTP API server started on http://127.0.0.1:${this.port}`);
          resolve();
        });

        this.server!.on("error", (error: NodeJS.ErrnoException) => {
          if (error.code === "EADDRINUSE") {
            logger.main.warn(`Port ${this.port} is already in use, HTTP API server not started`);
            this.server = null;
            resolve(); // Don't fail, just skip
          } else {
            reject(error);
          }
        });
      });
    } catch (error) {
      logger.main.error("Failed to start HTTP API server:", error);
      throw error;
    }
  }

  stop(): void {
    if (this.server) {
      this.server.close(() => {
        logger.main.info("HTTP API server stopped");
      });
      this.server = null;
    }
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  getPort(): number {
    return this.port;
  }
}
