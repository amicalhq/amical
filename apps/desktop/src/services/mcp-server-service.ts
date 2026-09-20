import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { Effect, Layer } from "effect";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { logger } from "../main/logger";
import {
  McpServerServiceTag,
  SettingsServiceTag,
  AppScopeTag,
} from "../main/runtime/tags";
import { addRelease, step, up } from "../main/runtime/layer-helpers";
import type { SettingsService } from "./settings-service";
import { getTranscriptionById, getTranscriptions } from "../db/transcriptions";
import { getVocabulary, searchVocabulary } from "../db/vocabulary";
import {
  createProposal,
  findPendingProposal,
  listProposals,
} from "../db/vocabulary-proposals";

const MCP_PATH = "/mcp";

const REVIEW_PROMPT_TEXT = [
  "Review my recent Amical dictations for misrecognized words and propose corrections.",
  "",
  "1. Call list_recent_dictations to read recent transcripts.",
  "2. Call list_vocabulary to see what's already registered, and skip anything already covered there.",
  '3. Call list_vocabulary_proposals with status "rejected" and don\'t re-propose anything already rejected.',
  "4. Look for proper nouns, jargon, or phrases that read as misrecognitions given the surrounding context.",
  "5. Only call propose_vocabulary_entry for corrections you're confident about.",
  "6. A term that looks like a first-time proper noun rather than a misrecognition may still be proposed as a",
  "   hint word — omit replacementWord in that case.",
].join("\n");

// A local MCP server that lets a connected client (e.g. Claude) read
// dictation history and existing vocabulary, and propose corrections for
// misrecognitions. It never writes to the vocabulary table directly —
// proposals sit pending until the user approves them in Amical's settings UI.
export class McpServerService {
  private httpServer: HttpServer | null = null;

  private readonly handleSettingsChanged = () => {
    void this.applySettings();
  };

  // Construction goes through Live: the graph is the only thing that may
  // build this service, which also makes single-construction structural.
  private constructor(private readonly settingsService: SettingsService) {}

  /**
   * The service's layer: dependencies are the yield* lines, initialization
   * is the acquire, teardown registers on the app scope. Composed into
   * AppLive by src/main/runtime/layers.ts.
   */
  static readonly Live: Layer.Layer<
    McpServerServiceTag,
    never,
    SettingsServiceTag | AppScopeTag
  > = Layer.effect(
    McpServerServiceTag,
    Effect.gen(function* () {
      const settingsService = yield* SettingsServiceTag;
      const appScope = yield* AppScopeTag;
      const service = new McpServerService(settingsService);
      yield* addRelease(
        appScope,
        "Stopping local MCP server...",
        "mcpServerService",
        () => service.cleanup(),
      );
      yield* step(() => service.initialize());
      logger.main.info("MCP server service initialized");
      up("mcpServerService");
      return service;
    }),
  );

  private async initialize(): Promise<void> {
    this.settingsService.on("mcp-settings-changed", this.handleSettingsChanged);
    await this.applySettings();
  }

  async cleanup(): Promise<void> {
    this.settingsService.off(
      "mcp-settings-changed",
      this.handleSettingsChanged,
    );
    await this.stop();
  }

  private async applySettings(): Promise<void> {
    const settings = await this.settingsService.getMcpServerSettings();
    await this.stop();
    if (!settings.enabled) return;
    await this.start(settings.port, settings.token);
  }

  private async start(port: number, token: string): Promise<void> {
    const httpServer = createServer((req, res) => {
      void this.handleHttpRequest(req, res, port, token);
    });

    const listening = await new Promise<boolean>((resolve) => {
      const onError = (error: NodeJS.ErrnoException) => {
        httpServer.off("listening", onListening);
        if (error.code === "EADDRINUSE") {
          logger.main.error(
            "MCP server port already in use; leaving server disabled",
            { port },
          );
        } else {
          logger.main.error("MCP server failed to start", { port, error });
        }
        resolve(false);
      };
      const onListening = () => {
        httpServer.off("error", onError);
        resolve(true);
      };
      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      httpServer.listen(port, "127.0.0.1");
    });

    if (!listening) return;

    this.httpServer = httpServer;
    logger.main.info("MCP server listening", { port, path: MCP_PATH });
  }

  private async stop(): Promise<void> {
    const httpServer = this.httpServer;
    this.httpServer = null;

    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  }

  private async handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    port: number,
    token: string,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== MCP_PATH) {
      res.writeHead(404).end();
      return;
    }

    const authHeader = req.headers.authorization;
    const presented = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (!token || presented !== `Bearer ${token}`) {
      res
        .writeHead(401, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    // Stateless mode requires a fresh McpServer + transport per request: the
    // SDK throws if a stateless transport is reused across requests (see
    // the official examples/server/simpleStatelessStreamableHttp.js).
    const mcpServer = this.buildMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableDnsRebindingProtection: true,
      allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
    });

    res.on("close", () => {
      void transport.close();
      void mcpServer.close();
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      logger.main.error("MCP request handling failed", { error });
      if (!res.headersSent) {
        res.writeHead(500).end();
      }
    }
  }

  private buildMcpServer(): McpServer {
    const server = new McpServer(
      { name: "amical", version: "1.0.0" },
      {
        instructions:
          "Tools for reviewing Amical dictation history against its custom vocabulary and proposing " +
          "corrections for misrecognized words. Call list_vocabulary before proposing anything to avoid " +
          "duplicates. propose_vocabulary_entry never writes to the dictionary directly — it creates a " +
          "pending proposal that the user must approve in Amical's settings UI before it takes effect.",
      },
    );

    server.registerTool(
      "list_recent_dictations",
      {
        title: "List recent dictations",
        description: "List recent Amical dictation history, most recent first.",
        inputSchema: {
          limit: z.number().int().min(1).max(100).optional(),
          sinceHours: z.number().positive().optional(),
          search: z.string().optional(),
        },
      },
      async ({ limit, sinceHours, search }) => {
        const rows = await getTranscriptions({
          limit: limit ?? 20,
          search,
        });
        const sinceMs = sinceHours ? Date.now() - sinceHours * 3_600_000 : 0;
        const filtered = sinceHours
          ? rows.filter((row) => row.timestamp.getTime() >= sinceMs)
          : rows;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                filtered.map((row) => ({
                  id: row.id,
                  text: row.text,
                  timestamp: row.timestamp,
                  language: row.language,
                  detectedLanguage: row.detectedLanguage,
                  confidence: row.confidence,
                  speechModel: row.speechModel,
                })),
              ),
            },
          ],
        };
      },
    );

    server.registerTool(
      "get_dictation",
      {
        title: "Get a dictation",
        description: "Fetch a single dictation transcript by id.",
        inputSchema: { id: z.number().int() },
      },
      async ({ id }) => {
        const row = await getTranscriptionById(id);
        if (!row) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "not_found" }),
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                id: row.id,
                text: row.text,
                timestamp: row.timestamp,
                language: row.language,
                detectedLanguage: row.detectedLanguage,
                confidence: row.confidence,
                speechModel: row.speechModel,
              }),
            },
          ],
        };
      },
    );

    server.registerTool(
      "list_vocabulary",
      {
        title: "List custom vocabulary",
        description:
          "List existing custom vocabulary entries (hint words and replacement rules). Call this before " +
          "proposing a new entry to avoid duplicates.",
        inputSchema: {
          search: z.string().optional(),
          limit: z.number().int().min(1).max(500).optional(),
        },
      },
      async ({ search, limit }) => {
        const rows = search
          ? await searchVocabulary(search, limit ?? 50)
          : await getVocabulary({ limit: limit ?? 50 });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                rows.map((row) => ({
                  word: row.word,
                  replacementWord: row.replacementWord,
                })),
              ),
            },
          ],
        };
      },
    );

    server.registerTool(
      "propose_vocabulary_entry",
      {
        title: "Propose a vocabulary correction",
        description:
          "Propose that `word` was misrecognized and should map to `replacementWord`. Does not write to " +
          "the dictionary directly — creates a pending proposal for the user to approve in Amical's " +
          "settings UI. Call list_vocabulary first to avoid proposing an entry that already exists.",
        inputSchema: {
          word: z.string().min(1),
          replacementWord: z.string().min(1).optional(),
          rationale: z.string().min(1),
          transcriptionId: z.number().int().optional(),
          contextSnippet: z.string().optional(),
        },
      },
      async ({
        word,
        replacementWord,
        rationale,
        transcriptionId,
        contextSnippet,
      }) => {
        const normalizedReplacement = replacementWord ?? null;
        const duplicate = await findPendingProposal(
          word,
          normalizedReplacement,
        );
        if (duplicate) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ duplicateOf: duplicate.id }),
              },
            ],
          };
        }

        const created = await createProposal({
          word,
          replacementWord: normalizedReplacement,
          rationale,
          transcriptionId: transcriptionId ?? null,
          contextSnippet: contextSnippet ?? null,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id: created.id, status: created.status }),
            },
          ],
        };
      },
    );

    server.registerTool(
      "list_vocabulary_proposals",
      {
        title: "List vocabulary proposals",
        description:
          "List past proposals and their approve/reject outcome, so rejected suggestions aren't repeated.",
        inputSchema: {
          status: z.enum(["pending", "approved", "rejected"]).optional(),
        },
      },
      async ({ status }) => {
        const rows = await listProposals({ status, limit: 100 });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(rows) }],
        };
      },
    );

    server.registerPrompt(
      "review_dictations_for_misrecognitions",
      {
        title: "Review recent dictations for misrecognitions",
        description:
          "Reviews recent Amical dictation history against the existing custom vocabulary and proposes " +
          "corrections for confident misrecognitions.",
        argsSchema: {},
      },
      async () => ({
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: REVIEW_PROMPT_TEXT },
          },
        ],
      }),
    );

    return server;
  }
}
