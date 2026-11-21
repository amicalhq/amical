// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingState } from "@/types/recording";
import type { WidgetFeedItem } from "@/types/widget-feed";

const mocks = vi.hoisted(() => ({
  // What the hook asked main to do, in order.
  calls: [] as string[],
  openExternal: vi.fn(),
  onData: undefined as
    | ((data: { item: WidgetFeedItem | null }) => void)
    | undefined,
}));

vi.mock("@/trpc/react", () => ({
  api: {
    widget: {
      feedItem: {
        useSubscription: (
          _input: undefined,
          options: { onData: typeof mocks.onData },
        ) => {
          mocks.onData = options.onData;
        },
      },
    },
  },
  trpcClient: {
    widget: {
      markFeedDisplayed: {
        mutate: async ({ itemId }: { itemId: string }) => {
          mocks.calls.push(`displayed:${itemId}`);
        },
      },
      navigateMainWindow: {
        mutate: async ({ route }: { route: string }) => {
          mocks.calls.push(`navigate:${route}`);
        },
      },
      closeFeedItem: {
        mutate: async (input: { itemId: string; clicked: boolean }) => {
          mocks.calls.push(
            `close:${input.itemId}${input.clicked ? ":clicked" : ""}`,
          );
          // Main removes the closed item.
          mocks.onData?.({ item: null });
        },
      },
    },
  },
}));

import {
  FEED_SHOW_DELAY_MS,
  useWidgetFeed,
} from "@/renderer/widget/hooks/useWidgetFeed";

const item = (overrides: Partial<WidgetFeedItem> = {}): WidgetFeedItem => ({
  id: "item-a",
  title: "Draft mode",
  body: "",
  imageUrl: null,
  buttons: [{ label: "Try", action: "open_url", url: "https://amical.ai/x" }],
  timeoutMs: 10_000,
  ...overrides,
});

function setup(served: WidgetFeedItem) {
  const hook = renderHook(
    (props: { recordingState: RecordingState; hasVisibleToast: boolean }) =>
      useWidgetFeed({ ...props, hasPendingDraft: false }),
    { initialProps: { recordingState: "idle", hasVisibleToast: false } },
  );
  act(() => mocks.onData?.({ item: served }));
  const set = (recordingState: RecordingState, hasVisibleToast = false) =>
    hook.rerender({ recordingState, hasVisibleToast });
  const dictate = () => {
    set("recording");
    set("idle");
  };
  return { hook, set, dictate };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.calls.length = 0;
  mocks.openExternal.mockClear();
  mocks.onData = undefined;
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { openExternal: mocks.openExternal },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useWidgetFeed", () => {
  it("shows the item 12 s after a dictation ends, not over a toast", () => {
    const { hook, set, dictate } = setup(item());
    expect(hook.result.current.card).toBeNull();
    expect(mocks.calls).toEqual([]);

    dictate();
    act(() => vi.advanceTimersByTime(FEED_SHOW_DELAY_MS - 1));
    expect(hook.result.current.card).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(hook.result.current.card?.item.id).toBe("item-a");
    expect(mocks.calls).toEqual(["displayed:item-a"]);

    set("idle", true);
    expect(hook.result.current.card).toBeNull();
    set("idle", false);
    expect(hook.result.current.card?.item.id).toBe("item-a");
  });

  it("closes a timed card when its time ends, paused while the pointer is on it", () => {
    const { hook, dictate } = setup(item());
    dictate();
    act(() => vi.advanceTimersByTime(FEED_SHOW_DELAY_MS));
    act(() => vi.advanceTimersByTime(4_000));

    act(() => hook.result.current.card?.onHoverChange(true));
    act(() => vi.advanceTimersByTime(20_000));
    expect(hook.result.current.card).not.toBeNull();

    act(() => hook.result.current.card?.onHoverChange(false));
    act(() => vi.advanceTimersByTime(6_000));
    expect(hook.result.current.card).toBeNull();
    expect(mocks.calls).toEqual(["displayed:item-a", "close:item-a"]);
  });

  it("counts a recording as a show only after 3 s on screen", () => {
    const { hook, set, dictate } = setup(item());
    dictate();
    act(() => vi.advanceTimersByTime(FEED_SHOW_DELAY_MS));
    act(() => vi.advanceTimersByTime(1_000));

    // Too short to be read: it comes back after the next dictation.
    set("recording");
    expect(hook.result.current.card).toBeNull();
    expect(mocks.calls).not.toContain("close:item-a");
    set("idle");
    act(() => vi.advanceTimersByTime(FEED_SHOW_DELAY_MS));
    act(() => vi.advanceTimersByTime(3_000));
    expect(hook.result.current.card?.item.id).toBe("item-a");

    set("recording");
    expect(mocks.calls).toContain("close:item-a");
    set("idle");
    act(() => vi.advanceTimersByTime(FEED_SHOW_DELAY_MS));
    expect(hook.result.current.card).toBeNull();
  });

  it("keeps a card with no timeout until closed, and brings it back after a recording", () => {
    const { hook, set, dictate } = setup(item({ timeoutMs: 0 }));
    dictate();
    act(() => vi.advanceTimersByTime(FEED_SHOW_DELAY_MS + 60_000));
    expect(hook.result.current.card).not.toBeNull();

    set("recording");
    expect(hook.result.current.card).toBeNull();
    set("idle");
    act(() => vi.advanceTimersByTime(0));
    expect(hook.result.current.card?.item.id).toBe("item-a");

    act(() => hook.result.current.card?.onClose());
    expect(hook.result.current.card).toBeNull();
    expect(mocks.calls.filter((call) => call.startsWith("close"))).toEqual([
      "close:item-a",
    ]);
  });

  it("shows an item that arrives after the wait, until the next recording", () => {
    const { hook, set, dictate } = setup(item());
    act(() => mocks.onData?.({ item: null }));
    dictate();
    act(() => vi.advanceTimersByTime(FEED_SHOW_DELAY_MS + 5_000));
    expect(hook.result.current.card).toBeNull();

    act(() => mocks.onData?.({ item: item() }));
    expect(hook.result.current.card?.item.id).toBe("item-a");

    // A recording ends the wait: a later item waits for the next dictation.
    set("recording");
    act(() => mocks.onData?.({ item: item({ id: "item-b" }) }));
    set("idle");
    expect(hook.result.current.card).toBeNull();
  });

  it("waits for a dictation again when the item went away while on show", () => {
    const { hook, set, dictate } = setup(item());
    dictate();
    act(() => vi.advanceTimersByTime(FEED_SHOW_DELAY_MS));
    expect(hook.result.current.card).not.toBeNull();

    // Sign-out (or the flag turning off) removes the item while on show.
    act(() => mocks.onData?.({ item: null }));
    set("recording");
    set("idle");
    // The same item comes back right after the dictation: not on screen yet.
    act(() => mocks.onData?.({ item: item() }));
    expect(hook.result.current.card).toBeNull();
    act(() => vi.advanceTimersByTime(FEED_SHOW_DELAY_MS));
    expect(hook.result.current.card?.item.id).toBe("item-a");
  });

  it("opens an app page for an app link", () => {
    const { hook, dictate } = setup(
      item({
        buttons: [
          { label: "Open", action: "open_route", route: "/settings/dictation" },
        ],
      }),
    );
    dictate();
    act(() => vi.advanceTimersByTime(FEED_SHOW_DELAY_MS));

    const card = hook.result.current.card!;
    act(() => card.onButton(card.item.buttons[0]));

    expect(mocks.calls.slice(-2)).toEqual([
      "navigate:/settings/dictation",
      "close:item-a:clicked",
    ]);
  });

  it("opens the link and closes the card as clicked", () => {
    const { hook, dictate } = setup(item());
    dictate();
    act(() => vi.advanceTimersByTime(FEED_SHOW_DELAY_MS));

    const card = hook.result.current.card!;
    act(() => card.onButton(card.item.buttons[0]));

    expect(mocks.openExternal).toHaveBeenCalledWith("https://amical.ai/x");
    expect(hook.result.current.card).toBeNull();
    expect(mocks.calls).toEqual(["displayed:item-a", "close:item-a:clicked"]);
  });
});
