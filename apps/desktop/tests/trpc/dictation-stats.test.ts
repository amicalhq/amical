import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../../src/trpc/context";
import { dictationStatsEvents } from "../../src/db/dictation-stats-events";

const readStats = vi.hoisted(() => vi.fn());
vi.mock("../../src/db/dictation-stats", () => ({
  getLifetimeStats: readStats,
}));

import { transcriptionsRouter } from "../../src/trpc/routers/transcriptions";

afterEach(() => dictationStatsEvents.removeAllListeners());

describe("dictation stats routes", () => {
  function createCaller() {
    const stopWatching = vi.fn();
    const requestSummaryRefresh = vi.fn();
    const watchSummary = vi.fn(() => stopWatching);
    const caller = transcriptionsRouter.createCaller({
      services: {
        activityReportingService: { watchSummary, requestSummaryRefresh },
      },
    } as unknown as Context);
    return { caller, watchSummary, stopWatching, requestSummaryRefresh };
  }

  it("reads current stats without caller input", async () => {
    const { caller } = createCaller();
    readStats.mockReturnValue({ totalWords: 42, totalTranscriptions: 2 });
    await expect(caller.getLifetimeStats()).resolves.toMatchObject({
      totalWords: 42,
    });
    expect(readStats).toHaveBeenCalledExactlyOnceWith();
  });

  it("schedules a refresh without caller input or an auth lookup", async () => {
    const { caller, requestSummaryRefresh, watchSummary } = createCaller();
    await expect(caller.requestStatsRefresh()).resolves.toBeUndefined();
    expect(requestSummaryRefresh).toHaveBeenCalledExactlyOnceWith();
    expect(watchSummary).not.toHaveBeenCalled();
    expect(readStats).not.toHaveBeenCalled();
  });

  it("watches visible History without an account and removes interest on unsubscribe", async () => {
    const { caller, watchSummary, stopWatching, requestSummaryRefresh } =
      createCaller();
    const next = vi.fn();
    const subscription = (
      await caller.onStatsChanged({ visible: true })
    ).subscribe({ next });
    expect(watchSummary).toHaveBeenCalledExactlyOnceWith();
    expect(requestSummaryRefresh).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledExactlyOnceWith({ changed: true });
    expect(readStats).not.toHaveBeenCalled();
    dictationStatsEvents.emit("changed");
    expect(next).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
    expect(stopWatching).toHaveBeenCalledOnce();
    dictationStatsEvents.emit("changed");
    expect(next).toHaveBeenCalledTimes(2);
    expect(dictationStatsEvents.listenerCount("changed")).toBe(0);
  });

  it("keeps local invalidations while hidden without watching or requesting refresh", async () => {
    const { caller, watchSummary, stopWatching, requestSummaryRefresh } =
      createCaller();
    const next = vi.fn();
    const subscription = (
      await caller.onStatsChanged({ visible: false })
    ).subscribe({ next });
    expect(watchSummary).not.toHaveBeenCalled();
    expect(requestSummaryRefresh).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledExactlyOnceWith({ changed: true });
    dictationStatsEvents.emit("changed");
    expect(next).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
    expect(stopWatching).not.toHaveBeenCalled();
    expect(dictationStatsEvents.listenerCount("changed")).toBe(0);
  });
});
