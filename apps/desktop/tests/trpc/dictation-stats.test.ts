import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import type { Context } from "../../src/trpc/context";
import { dictationStatsEvents } from "../../src/db/dictation-stats-events";

const readStats = vi.hoisted(() => vi.fn());
vi.mock("../../src/db/dictation-stats", () => ({
  getLifetimeStats: readStats,
}));

import { transcriptionsRouter } from "../../src/trpc/routers/transcriptions";

afterEach(() => dictationStatsEvents.removeAllListeners());

describe("dictation stats routes", () => {
  it("uses the same local reader for device and account scopes", async () => {
    const caller = transcriptionsRouter.createCaller({} as Context);
    readStats.mockReturnValue({ totalWords: 42, totalTranscriptions: 2 });

    await expect(caller.getLifetimeStats()).resolves.toMatchObject({
      totalWords: 42,
    });
    expect(readStats).toHaveBeenLastCalledWith(null);
    await caller.getLifetimeStats({ accountId: "account-a" });
    expect(readStats).toHaveBeenLastCalledWith("account-a");
  });

  it("requests worker refresh without fetching a summary in the router", async () => {
    const requestSummaryRefresh = vi.fn();
    const caller = transcriptionsRouter.createCaller({
      services: {
        activityReportingService: { requestSummaryRefresh },
        authService: {
          getAuthState: () =>
            Effect.succeed({
              isAuthenticated: true,
              userInfo: { sub: "account-a" },
            }),
        },
      },
    } as unknown as Context);

    await expect(
      caller.requestStatsRefresh({ accountId: "account-a" }),
    ).resolves.toEqual({ requested: true });
    expect(requestSummaryRefresh).toHaveBeenCalledExactlyOnceWith("account-a");
    expect(readStats).not.toHaveBeenCalled();
  });

  it("rejects a refresh for a stale account before waking the worker", async () => {
    const requestSummaryRefresh = vi.fn();
    const caller = transcriptionsRouter.createCaller({
      services: {
        activityReportingService: { requestSummaryRefresh },
        authService: {
          getAuthState: () =>
            Effect.succeed({
              isAuthenticated: true,
              userInfo: { sub: "account-b" },
            }),
        },
      },
    } as unknown as Context);

    await expect(
      caller.requestStatsRefresh({ accountId: "account-a" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(requestSummaryRefresh).not.toHaveBeenCalled();
  });

  it("invalidates on attachment and cache changes, and detaches on cleanup", async () => {
    const caller = transcriptionsRouter.createCaller({} as Context);
    const next = vi.fn();
    const subscription = (await caller.onStatsChanged()).subscribe({ next });
    expect(next).toHaveBeenCalledExactlyOnceWith({ changed: true });
    dictationStatsEvents.emit("changed");
    expect(next).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
    dictationStatsEvents.emit("changed");
    expect(next).toHaveBeenCalledTimes(2);
    expect(dictationStatsEvents.listenerCount("changed")).toBe(0);
  });
});
