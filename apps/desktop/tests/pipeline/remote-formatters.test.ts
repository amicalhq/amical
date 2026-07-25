import { asSchema } from "ai";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAICompatibleFormatter } from "../../src/pipeline/providers/formatting/openai-compatible-formatter";
import { OpenRouterProvider } from "../../src/pipeline/providers/formatting/openrouter-formatter";

const completionResponse = () =>
  new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1,
      model: "test-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "<formatted_text>formatted</formatted_text>",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("remote formatters", () => {
  const formatParams = { text: "raw", context: {} };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(completionResponse);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses Chat Completions for OpenAI-compatible endpoints", async () => {
    const formatter = new OpenAICompatibleFormatter(
      "test-key",
      "https://compatible.test/v1",
      "test-model",
    );

    await expect(formatter.format(formatParams)).resolves.toBe("formatted");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://compatible.test/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual(
      expect.objectContaining({ model: "test-model", max_tokens: 5000 }),
    );
    expect(body.messages.map(({ role }: { role: string }) => role)).toEqual([
      "system",
      "user",
    ]);
  });

  it("keeps OpenRouter formatting on its Chat Completions endpoint", async () => {
    const formatter = new OpenRouterProvider("test-key", "test-model");

    await expect(formatter.format(formatParams)).resolves.toBe("formatted");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual(
      expect.objectContaining({ model: "test-model", max_tokens: 5000 }),
    );
    expect(body.messages.map(({ role }: { role: string }) => role)).toEqual([
      "system",
      "user",
    ]);
  });

  it("converts Zod 4 object schemas without degrading them to strings", () => {
    expect(asSchema(z.object({ value: z.string() })).jsonSchema).toEqual(
      expect.objectContaining({ type: "object" }),
    );
  });
});
