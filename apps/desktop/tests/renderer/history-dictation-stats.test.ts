// @vitest-environment jsdom

import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDictationStats } from "../../src/renderer/main/pages/settings/history/use-dictation-stats";

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  statsSubscribe: vi.fn(),
  readStats: vi.fn(),
  requestRefresh: vi.fn(),
}));

vi.mock("@/trpc/react", () => ({
  api: {
    useUtils: () => {
      const client = useQueryClient();
      return {
        transcriptions: {
          getLifetimeStats: {
            cancel: () => client.cancelQueries({ queryKey: ["stats"] }),
            invalidate: () => client.invalidateQueries({ queryKey: ["stats"] }),
          },
        },
      };
    },
    auth: { onAuthStateChange: { useSubscription: mocks.subscribe } },
    transcriptions: {
      getLifetimeStats: {
        useQuery: (input: { accountId: string | null }, options: object) =>
          useQuery({
            queryKey: ["stats", input.accountId],
            queryFn: () => mocks.readStats(input.accountId),
            ...options,
          }),
      },
      requestStatsRefresh: {
        useMutation: (options: object) =>
          useMutation({
            mutationFn: mocks.requestRefresh,
            ...options,
          }),
      },
      onStatsChanged: { useSubscription: mocks.statsSubscribe },
    },
  },
}));

describe("History dictation stats", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
    mocks.readStats
      .mockReset()
      .mockImplementation(async (id: string | null) => ({
        totalWords: id === null ? 100 : 12000,
        totalTranscriptions: 1,
      }));
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    onlineManager.setOnline(true);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function renderStats() {
    return renderHook(useDictationStats, {
      wrapper: ({ children }) =>
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          children,
        ),
    });
  }

  function authenticate(accountId: string | null) {
    act(() =>
      mocks.subscribe.mock.lastCall![1].onData({
        eventType: accountId ? "authenticated" : "signed-out",
        isAuthenticated: accountId !== null,
        userId: accountId,
      }),
    );
  }

  it("waits for auth, reads the account cache, and requests background refresh", async () => {
    const { result } = renderStats();
    expect(result.current).toBeUndefined();
    expect(mocks.readStats).not.toHaveBeenCalled();
    expect(mocks.requestRefresh).not.toHaveBeenCalled();
    authenticate("account-a");
    await waitFor(() => expect(result.current).toBe(12000));
    expect(mocks.readStats).toHaveBeenCalledWith("account-a");
    expect(mocks.requestRefresh).toHaveBeenCalledExactlyOnceWith({
      accountId: "account-a",
    });
  });

  it("reads device totals through the same cache query without remote refresh", async () => {
    const { result } = renderStats();
    authenticate(null);
    await waitFor(() => expect(result.current).toBe(100));
    expect(mocks.readStats).toHaveBeenCalledWith(null);
    expect(mocks.requestRefresh).not.toHaveBeenCalled();
  });

  it.each([null, "account-a"])(
    "updates immediately on a committed cache change (%s)",
    async (accountId) => {
      const { result } = renderStats();
      authenticate(accountId);
      await waitFor(() => expect(result.current).toBe(accountId ? 12000 : 100));
      mocks.readStats.mockResolvedValue({
        totalWords: 12020,
        totalTranscriptions: 2,
      });
      await act(async () =>
        mocks.statsSubscribe.mock.lastCall![1].onData({ changed: true }),
      );
      await waitFor(() => expect(result.current).toBe(12020));
      expect(mocks.requestRefresh).toHaveBeenCalledTimes(accountId ? 1 : 0);
    },
  );

  it.each([null, "account-a"])(
    "reads and updates cached totals while offline (%s)",
    async (accountId) => {
      onlineManager.setOnline(false);
      const { result, unmount } = renderStats();
      authenticate(accountId);
      await waitFor(() => expect(result.current).toBe(accountId ? 12000 : 100));
      expect(mocks.requestRefresh).toHaveBeenCalledTimes(accountId ? 1 : 0);
      mocks.readStats.mockResolvedValue({ totalWords: 12020 });
      await act(async () =>
        mocks.statsSubscribe.mock.lastCall![1].onData({ changed: true }),
      );
      await waitFor(() => expect(result.current).toBe(12020));
      unmount();
      await act(async () => onlineManager.setOnline(true));
      expect(mocks.requestRefresh).toHaveBeenCalledTimes(accountId ? 1 : 0);
    },
  );

  it("restarts a pending first read when stats change and ignores its late result", async () => {
    let resolvePrevious!: (value: unknown) => void;
    mocks.readStats.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePrevious = resolve;
        }),
    );
    const { result } = renderStats();
    authenticate("account-a");
    await waitFor(() => expect(mocks.readStats).toHaveBeenCalledTimes(1));
    mocks.readStats.mockResolvedValue({ totalWords: 12020 });
    await act(async () =>
      mocks.statsSubscribe.mock.lastCall![1].onData({ changed: true }),
    );
    await waitFor(() => expect(result.current).toBe(12020));
    expect(mocks.readStats).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolvePrevious({ totalWords: 12000 });
    });
    expect(result.current).toBe(12020);
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(1);
  });

  it("requests refresh at five minutes plus fresh jitter and stops on closing", async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const { unmount, rerender } = renderStats();
    authenticate("account-a");
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(300_000));
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(1);
    random.mockReturnValue(0.999);
    rerender();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(359_999));
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(3);
    // Local reads are event driven, not polled with the refresh requests.
    expect(mocks.readStats).toHaveBeenCalledTimes(1);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(600_000));
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(3);
  });

  it("requests refresh immediately when History reopens before the next tick", async () => {
    vi.useFakeTimers();
    const first = renderStats();
    authenticate("account-a");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(1);
    first.unmount();
    renderStats();
    authenticate("account-a");
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(2);
  });

  it("skips hidden ticks and does not refresh merely on becoming visible", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    renderStats();
    authenticate("account-a");
    await act(() => vi.advanceTimersByTimeAsync(0));
    visibility.mockReturnValue("hidden");
    act(() => window.dispatchEvent(new Event("visibilitychange")));
    await act(() => vi.advanceTimersByTimeAsync(602_000));
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("visible");
    act(() => window.dispatchEvent(new Event("visibilitychange")));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.readStats).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(301_000));
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(2);
  });

  it.each([
    { eventType: "authenticated", isAuthenticated: true, userId: null },
    { eventType: "auth-error", isAuthenticated: false, userId: null },
  ])("hides totals on uncertain auth ($eventType)", async (state) => {
    const { result } = renderStats();
    authenticate("account-a");
    await waitFor(() => expect(result.current).toBe(12000));
    act(() => mocks.subscribe.mock.lastCall![1].onData(state));
    expect(result.current).toBeUndefined();
    expect(mocks.readStats).not.toHaveBeenCalledWith(null);
  });

  it("does not substitute device totals when an account has no cache", async () => {
    mocks.readStats.mockResolvedValue(null);
    const { result } = renderStats();
    authenticate("account-a");
    await waitFor(() =>
      expect(mocks.readStats).toHaveBeenCalledWith("account-a"),
    );
    expect(result.current).toBeUndefined();
    expect(mocks.readStats).not.toHaveBeenCalledWith(null);
  });

  it("ignores an old account's late local read and clears refresh timers on signout", async () => {
    let resolvePrevious!: (value: unknown) => void;
    mocks.readStats.mockImplementation((id: string | null) =>
      id === "account-a"
        ? new Promise((resolve) => {
            resolvePrevious = resolve;
          })
        : Promise.resolve({ totalWords: id === null ? 100 : 250 }),
    );
    const { result } = renderStats();
    authenticate("account-a");
    await waitFor(() =>
      expect(mocks.readStats).toHaveBeenCalledWith("account-a"),
    );
    authenticate("account-b");
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe(250));
    await act(async () => {
      resolvePrevious({ totalWords: 12000 });
    });
    expect(result.current).toBe(250);
    expect(mocks.requestRefresh).toHaveBeenLastCalledWith({
      accountId: "account-b",
    });
    authenticate(null);
    await waitFor(() => expect(result.current).toBe(100));
    vi.useFakeTimers();
    await act(() => vi.advanceTimersByTimeAsync(600_000));
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(2);
  });
});
