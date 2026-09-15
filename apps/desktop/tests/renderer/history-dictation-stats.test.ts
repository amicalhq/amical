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
      return React.useMemo(
        () => ({
          transcriptions: {
            getLifetimeStats: {
              cancel: () => client.cancelQueries({ queryKey: ["stats"] }),
              invalidate: () =>
                client.invalidateQueries({ queryKey: ["stats"] }),
            },
          },
        }),
        [client],
      );
    },
    auth: { onAuthStateChange: { useSubscription: mocks.subscribe } },
    transcriptions: {
      getLifetimeStats: {
        useQuery: (_input: undefined, options: object) =>
          useQuery({
            queryKey: ["stats"],
            queryFn: () => mocks.readStats(),
            ...options,
          }),
      },
      requestStatsRefresh: {
        useMutation: (options: object) =>
          useMutation({ mutationFn: mocks.requestRefresh, ...options }),
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
    mocks.requestRefresh.mockReset().mockResolvedValue(undefined);
    mocks.readStats
      .mockReset()
      .mockResolvedValue({ totalWords: 12000, totalTranscriptions: 1 });
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

  function expectSubscription(visible = true) {
    expect(mocks.statsSubscribe).toHaveBeenLastCalledWith(
      { visible },
      expect.any(Object),
    );
  }

  it("reads immediately without renderer auth and sends no account in stats IPC", async () => {
    const { result } = renderStats();
    await waitFor(() => expect(result.current).toBe(12000));
    expect(mocks.readStats).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.requestRefresh).not.toHaveBeenCalled();
    expectSubscription();
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([["stats"]]);
  });

  it("rereads the same query on login, account switch, and signout", async () => {
    mocks.readStats.mockResolvedValue({ totalWords: 100 });
    const { result } = renderStats();
    await waitFor(() => expect(result.current).toBe(100));
    mocks.readStats.mockResolvedValue({ totalWords: 12000 });
    authenticate("account-a");
    await waitFor(() => expect(result.current).toBe(12000));
    expect(mocks.requestRefresh).toHaveBeenCalledExactlyOnceWith(undefined);
    mocks.readStats.mockResolvedValue({ totalWords: 250 });
    authenticate("account-b");
    await waitFor(() => expect(result.current).toBe(250));
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(2);
    mocks.readStats.mockResolvedValue({ totalWords: 100 });
    authenticate(null);
    await waitFor(() => expect(result.current).toBe(100));
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(2);
    expect(mocks.readStats).toHaveBeenCalledTimes(4);
    expect(mocks.readStats.mock.calls.every((args) => args.length === 0)).toBe(
      true,
    );
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([["stats"]]);
    expect(
      mocks.statsSubscribe.mock.calls.every(
        ([input]) => Object.keys(input).length === 1 && input.visible === true,
      ),
    ).toBe(true);
  });

  it.each([null, "account-a"])(
    "updates immediately on a committed cache change (%s)",
    async (accountId) => {
      const { result } = renderStats();
      authenticate(accountId);
      await waitFor(() => expect(result.current).toBe(12000));
      mocks.readStats.mockResolvedValue({ totalWords: 12020 });
      await act(async () =>
        mocks.statsSubscribe.mock.lastCall![1].onData({ changed: true }),
      );
      await waitFor(() => expect(result.current).toBe(12020));
      expectSubscription();
      expect(mocks.requestRefresh).toHaveBeenCalledTimes(accountId ? 1 : 0);
    },
  );

  it.each([null, "account-a"])(
    "reads and updates cached totals while offline (%s)",
    async (accountId) => {
      onlineManager.setOnline(false);
      const { result, unmount } = renderStats();
      authenticate(accountId);
      await waitFor(() => expect(result.current).toBe(12000));
      expectSubscription();
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
  });

  it("requests once on a hidden mount, but only changes cadence when hidden or restored", async () => {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    const removeListener = vi.spyOn(document, "removeEventListener");
    const { result, unmount } = renderStats();
    authenticate("account-a");
    await waitFor(() => expect(result.current).toBe(12000));
    expectSubscription(false);
    expect(mocks.requestRefresh).toHaveBeenCalledExactlyOnceWith(undefined);
    mocks.readStats.mockResolvedValue({ totalWords: 12020 });
    await act(async () =>
      mocks.statsSubscribe.mock.lastCall![1].onData({ changed: true }),
    );
    await waitFor(() => expect(result.current).toBe(12020));
    expectSubscription(false);
    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expectSubscription(true);
    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expectSubscription(false);
    await act(async () => {});
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(1);
    unmount();
    expect(removeListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    const subscriptionCalls = mocks.statsSubscribe.mock.calls.length;
    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(mocks.statsSubscribe).toHaveBeenCalledTimes(subscriptionCalls);
  });

  it("does not schedule periodic renderer work or refetch local stats on focus", async () => {
    vi.useFakeTimers();
    renderStats();
    authenticate("account-a");
    await act(() => vi.advanceTimersByTimeAsync(0));
    const subscriptionCalls = mocks.statsSubscribe.mock.calls.length;
    const readCalls = mocks.readStats.mock.calls.length;
    act(() => window.dispatchEvent(new Event("focus")));
    await act(() => vi.advanceTimersByTimeAsync(2 * 60 * 60_000));
    expect(mocks.readStats).toHaveBeenCalledTimes(readCalls);
    expect(mocks.statsSubscribe).toHaveBeenCalledTimes(subscriptionCalls);
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(1);
  });

  it("requests immediately on reopening but not on ordinary rerenders", async () => {
    const first = renderStats();
    authenticate("account-a");
    await waitFor(() => expect(mocks.requestRefresh).toHaveBeenCalledTimes(1));
    first.rerender();
    authenticate("account-a");
    await act(async () => {});
    expect(mocks.requestRefresh).toHaveBeenCalledTimes(1);
    first.unmount();
    renderStats();
    authenticate("account-a");
    await waitFor(() => expect(mocks.requestRefresh).toHaveBeenCalledTimes(2));
  });

  it.each([
    { eventType: "authenticated", isAuthenticated: true, userId: null },
    { eventType: "auth-error", isAuthenticated: false, userId: null },
  ])(
    "keeps displaying DB totals when renderer auth is uncertain ($eventType)",
    async (state) => {
      const { result } = renderStats();
      await waitFor(() => expect(result.current).toBe(12000));
      act(() => mocks.subscribe.mock.lastCall![1].onData(state));
      expect(result.current).toBe(12000);
      expect(mocks.requestRefresh).not.toHaveBeenCalled();
      expectSubscription();
    },
  );

  it("displays an unavailable result when the DB has no current cache", async () => {
    mocks.readStats.mockResolvedValue(null);
    const { result } = renderStats();
    await waitFor(() => expect(mocks.readStats).toHaveBeenCalledOnce());
    expect(result.current).toBeUndefined();
  });
});
