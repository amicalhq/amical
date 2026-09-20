import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@db/schema";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";

let activeDb: TestDatabase["db"] | null = null;

vi.mock("../../src/db/index.ts", () => ({
  get db() {
    if (!activeDb) {
      throw new Error("Test database not set");
    }
    return activeDb;
  },
  dbPath: "/test/db/path",
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
  closeDatabase: vi.fn().mockResolvedValue(undefined),
}));

import { createServer, type Server as HttpServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { McpServerService } from "../../src/services/mcp-server-service";
import {
  McpServerServiceTag,
  SettingsServiceTag,
  AppScopeTag,
} from "../../src/main/runtime/tags";
import type { McpServerSettings } from "../../src/services/settings-service";

const TEST_PORT = 18765;
const TEST_TOKEN = "test-token-1234";

describe("McpServerService", () => {
  let testDb: TestDatabase;
  let closeScope: (() => Promise<void>) | null = null;

  // The service is only constructible through its Live layer; build it with
  // fakes via Layer.succeed (see tests/README.md convention, mirrored from
  // history-cleanup.test.ts). Closing the scope runs the registered release —
  // the same path the app's cleanup() takes.
  async function buildMcpServerService(
    settings: McpServerSettings,
  ): Promise<McpServerService> {
    const settingsService = {
      getMcpServerSettings: vi.fn().mockResolvedValue(settings),
      on: vi.fn(),
      off: vi.fn(),
    };
    const scope = Effect.runSync(Scope.make());
    const ctx = await Effect.runPromise(
      Layer.build(
        McpServerService.Live.pipe(
          Layer.provide(
            Layer.succeed(SettingsServiceTag, settingsService as never),
          ),
          Layer.provide(Layer.succeed(AppScopeTag, scope)),
        ),
      ).pipe(Scope.provide(scope)),
    );
    closeScope = () => Effect.runPromise(Scope.close(scope, Exit.void));
    return Context.get(ctx, McpServerServiceTag);
  }

  async function connectClient(token = TEST_TOKEN): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${TEST_PORT}/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
    return client;
  }

  beforeEach(async () => {
    testDb = await createTestDatabase();
    activeDb = testDb.db;
  });

  afterEach(async () => {
    if (closeScope) {
      await closeScope();
      closeScope = null;
    }
    activeDb = null;
    if (testDb) {
      await testDb.close();
    }
  });

  it("rejects a request with no Authorization header (401)", async () => {
    await buildMcpServerService({
      enabled: true,
      port: TEST_PORT,
      token: TEST_TOKEN,
    });

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });

    expect(res.status).toBe(401);
  });

  it("rejects a request with an incorrect bearer token (401)", async () => {
    await buildMcpServerService({
      enabled: true,
      port: TEST_PORT,
      token: TEST_TOKEN,
    });

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });

    expect(res.status).toBe(401);
  });

  it("exposes exactly the five read/propose tools, no direct-write tool", async () => {
    await buildMcpServerService({
      enabled: true,
      port: TEST_PORT,
      token: TEST_TOKEN,
    });

    const client = await connectClient();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    expect(names).toEqual(
      [
        "get_dictation",
        "list_recent_dictations",
        "list_vocabulary",
        "list_vocabulary_proposals",
        "propose_vocabulary_entry",
      ].sort(),
    );

    await client.close();
  });

  it("propose_vocabulary_entry creates a pending proposal and does not write to vocabulary", async () => {
    await buildMcpServerService({
      enabled: true,
      port: TEST_PORT,
      token: TEST_TOKEN,
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: "propose_vocabulary_entry",
      arguments: {
        word: "Amikal",
        replacementWord: "Amical",
        rationale: "Misheard product name in context",
      },
    });

    expect(result.isError).not.toBe(true);

    const proposals = await testDb.db.select().from(schema.vocabularyProposals);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].status).toBe("pending");
    expect(proposals[0].word).toBe("Amikal");

    const vocabularyRows = await testDb.db.select().from(schema.vocabulary);
    expect(vocabularyRows).toHaveLength(0);

    await client.close();
  });

  it("propose_vocabulary_entry returns duplicateOf instead of creating a second pending row", async () => {
    await buildMcpServerService({
      enabled: true,
      port: TEST_PORT,
      token: TEST_TOKEN,
    });

    const client = await connectClient();
    const args = {
      word: "Wisper",
      replacementWord: "Whisper",
      rationale: "Homophone typo",
    };
    await client.callTool(
      { name: "propose_vocabulary_entry", arguments: args },
      CallToolResultSchema,
    );
    const second = await client.callTool(
      { name: "propose_vocabulary_entry", arguments: args },
      CallToolResultSchema,
    );

    const content = second.content as Array<{ type: string; text?: string }>;
    const text = content?.[0]?.type === "text" ? content[0].text! : "";
    expect(JSON.parse(text)).toHaveProperty("duplicateOf");

    const proposals = await testDb.db.select().from(schema.vocabularyProposals);
    expect(proposals).toHaveLength(1);

    await client.close();
  });

  it("stays alive without throwing when the port is already in use (EADDRINUSE)", async () => {
    const occupier: HttpServer = createServer((_req, res) => res.end("busy"));
    await new Promise<void>((resolve) =>
      occupier.listen(TEST_PORT, "127.0.0.1", resolve),
    );

    try {
      await expect(
        buildMcpServerService({
          enabled: true,
          port: TEST_PORT,
          token: TEST_TOKEN,
        }),
      ).resolves.toBeInstanceOf(McpServerService);

      // The occupying server should still be the one answering — the MCP
      // service must not have torn it down or crashed the app.
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
      expect(await res.text()).toBe("busy");
    } finally {
      await new Promise<void>((resolve) => occupier.close(() => resolve()));
    }
  });
});
