import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Fiber } from "effect";

import type { AuthService } from "../../src/services/auth-service";
import { ActivityReportingClient } from "../../src/services/activity-reporting-client";
import { AMICAL_PLATFORM_HEADER } from "../../src/utils/http-client";
import type { DictationActivity } from "../../src/types/activity";
import {
  AuthenticationRequired,
  CloudNetworkFailure,
  settleExit,
} from "../../src/types/errors";

const activity: DictationActivity = {
  activityId: "11111111-1111-4111-8111-111111111111",
  occurredAt: "2026-08-28T08:30:00.000Z",
  wordCount: 3,
  audioDurationMs: 2_000,
  appType: "email",
  skills: null,
  transcription: {
    provider: "whisper-cpp",
    model: "whisper-tiny",
    execution: "local",
  },
  formatting: null,
};

const runClient = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromiseExit(effect).then(settleExit);

describe("ActivityReportingClient", () => {
  let client: ActivityReportingClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.CORE_API_URL = "https://core.test";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    client = new ActivityReportingClient({
      getIdToken: vi.fn(() => Effect.succeed("id-token")),
    } as unknown as AuthService);
  });

  afterEach(() => {
    delete process.env.CORE_API_URL;
    vi.unstubAllGlobals();
  });

  it("posts through Apps V1 with auth and platform headers and accepts empty 200", async () => {
    fetchMock.mockResolvedValue({ status: 200 });

    await expect(runClient(client.submit([activity]))).resolves.toBe("success");

    const [url, init] = fetchMock.mock.calls[0] as [
      URL,
      { headers: Record<string, string>; body: string },
    ];
    expect(url.toString()).toBe("https://core.test/apps/v1/me/activities");
    expect(init.headers.Authorization).toBe("Bearer id-token");
    expect(init.headers[AMICAL_PLATFORM_HEADER]).toBe(process.platform);
    expect(JSON.parse(init.body)).toEqual({ activities: [activity] });
    expect(JSON.parse(init.body)).not.toHaveProperty("platform");
  });

  it("returns terminal invalid only for 400 and surfaces retryable statuses", async () => {
    fetchMock.mockResolvedValueOnce({ status: 400 });
    await expect(runClient(client.submit([activity]))).resolves.toBe("invalid");

    for (const [status, tag] of [
      [401, "AuthenticationRequired"],
      [403, "AccessForbidden"],
      [429, "RateLimited"],
      [500, "CloudHttpFailure"],
      [503, "CloudHttpFailure"],
      [204, "CloudHttpFailure"],
    ] as const) {
      fetchMock.mockResolvedValueOnce({ status });
      await expect(runClient(client.submit([activity]))).rejects.toMatchObject({
        _tag: tag,
        meta: { httpStatus: status },
      });
    }
  });

  it("uses the cloud error envelope for authentication failures", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "AUTH_REQUIRED",
            message: "Token expired",
            traceId: "trace-1",
          },
        }),
        { status: 403 },
      ),
    );

    await expect(runClient(client.submit([activity]))).rejects.toMatchObject({
      _tag: "AuthenticationRequired",
      message: "Token expired",
      meta: {
        httpStatus: 403,
        traceId: "trace-1",
      },
    } satisfies Partial<AuthenticationRequired>);
  });

  it("classifies rejected fetches as cloud network failures", async () => {
    const cause = new TypeError("offline");
    fetchMock.mockRejectedValue(cause);

    await expect(runClient(client.submit([activity]))).rejects.toEqual(
      new CloudNetworkFailure({ message: "offline", cause }),
    );
  });

  it("requires a local authentication token before sending", async () => {
    const tokenlessClient = new ActivityReportingClient({
      getIdToken: vi.fn(() => Effect.succeed(null)),
    } as unknown as AuthService);

    await expect(
      runClient(tokenlessClient.submit([activity])),
    ).rejects.toBeInstanceOf(AuthenticationRequired);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts an in-flight request when interrupted", async () => {
    let requestSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          requestSignal = init.signal as AbortSignal;
          requestSignal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const fiber = Effect.runFork(client.submit([activity]));
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(requestSignal?.aborted).toBe(true);
  });
});
