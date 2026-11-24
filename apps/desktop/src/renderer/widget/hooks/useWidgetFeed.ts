import { useEffect, useRef, useState } from "react";
import { api, trpcClient } from "@/trpc/react";
import type { RecordingState } from "@/types/recording";
import type { WidgetFeedItem } from "@/types/widget-feed";
import type { WidgetFeedCardProps } from "../components/WidgetFeedCard";

// The card shows this long after a dictation ends: the user is at the computer,
// and the dictation's own result and toasts come first.
export const FEED_SHOW_DELAY_MS = 12_000;
// A recording that starts after the card was on screen this long counts as a
// show. Before that, the card waits for the next dictation.
const FEED_MIN_SHOWN_MS = 3_000;

// Counts time only while it runs, on the monotonic clock: a clock change or
// sleep does not count as time on screen.
class Stopwatch {
  private total = 0;
  private since: number | null = null;

  start(): void {
    this.since ??= performance.now();
  }

  stop(): void {
    if (this.since === null) return;
    this.total += performance.now() - this.since;
    this.since = null;
  }

  elapsed(): number {
    return (
      this.total + (this.since === null ? 0 : performance.now() - this.since)
    );
  }

  reset(): void {
    this.total = 0;
    if (this.since !== null) this.since = performance.now();
  }
}

const logFailure = (action: string) => (error: unknown) => {
  console.error(`Widget feed ${action} failed:`, error);
};

/**
 * When the widget shows the Sequenzy notification card. The card shows once
 * per item, after a dictation; a card with no timeout stays until the user
 * closes it.
 */
export function useWidgetFeed({
  recordingState,
  hasVisibleToast,
  hasPendingDraft,
}: {
  recordingState: RecordingState;
  hasVisibleToast: boolean;
  hasPendingDraft: boolean;
}) {
  const [item, setItem] = useState<WidgetFeedItem | null>(null);
  // The item on show; null while the card waits for a dictation to end.
  const [showingId, setShowingId] = useState<string | null>(null);
  // The wait after a dictation is over: the next item to arrive shows.
  const [due, setDue] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [showSequence, setShowSequence] = useState(0);
  // On-screen time decides whether a recording counts as a show; the timer
  // also stops while the pointer is on the card.
  const [shown] = useState(() => new Stopwatch());
  const [timer] = useState(() => new Stopwatch());
  // A card with no timeout that a recording hid: back when the dictation ends.
  const returningId = useRef<string | null>(null);
  const previousState = useRef(recordingState);

  api.widget.feedItem.useSubscription(undefined, {
    onData: (data) => setItem(data.item),
    onError: (error) => {
      console.error("Widget feed subscription error:", error);
    },
  });

  // Fetch the image now, so it is ready when the card shows.
  const imageUrl = item?.imageUrl;
  useEffect(() => {
    if (imageUrl) new Image().src = imageUrl;
  }, [imageUrl]);

  const visible =
    item !== null &&
    item.id === showingId &&
    recordingState === "idle" &&
    !hasVisibleToast &&
    !hasPendingDraft;

  // Main reports `clicked`, then `dismissed`, and removes the item.
  const close = (target: WidgetFeedItem, clicked: boolean) => {
    setShowingId(null);
    if (returningId.current === target.id) returningId.current = null;
    trpcClient.widget.closeFeedItem
      .mutate({ itemId: target.id, clicked })
      .catch(logFailure("close"));
  };

  useEffect(() => {
    const previous = previousState.current;
    previousState.current = recordingState;

    if (previous === "idle" && recordingState !== "idle") {
      setDue(false);
      if (item && item.id === showingId) {
        if (item.timeoutMs === 0) returningId.current = item.id;
        else if (shown.elapsed() >= FEED_MIN_SHOWN_MS) close(item, false);
      }
      // Also when the item went away while on show: a card shows only after
      // the wait that follows a dictation.
      setShowingId(null);
      return;
    }

    if (previous !== "idle" && recordingState === "idle") {
      const returning = item?.id === returningId.current;
      // Leaving idle again, or unmounting, cancels a wait that is not over.
      const timeout = setTimeout(
        () => setDue(true),
        returning ? 0 : FEED_SHOW_DELAY_MS,
      );
      return () => clearTimeout(timeout);
    }
    // Runs on recording edges only.
  }, [recordingState]);

  // Once the wait is over, an item that arrives later shows at once.
  useEffect(() => {
    if (!due || !item) return;
    shown.reset();
    timer.reset();
    setShowingId(item.id);
    setDue(false);
  }, [due, item, shown, timer]);

  const visibleId = visible ? item.id : null;
  // Counted while rendering, so a show costs one render and one window update.
  const [lastVisibleId, setLastVisibleId] = useState<string | null>(null);
  if (visibleId !== lastVisibleId) {
    setLastVisibleId(visibleId);
    if (visibleId) setShowSequence((sequence) => sequence + 1);
  }
  useEffect(() => {
    if (!visibleId) return;
    shown.start();
    trpcClient.widget.markFeedDisplayed
      .mutate({ itemId: visibleId })
      .catch(logFailure("display report"));
    return () => {
      shown.stop();
      setHovered(false);
    };
  }, [visibleId, shown]);

  const timedItem = visible && !hovered && item.timeoutMs > 0 ? item : null;
  useEffect(() => {
    if (!timedItem) return;
    timer.start();
    const timeout = setTimeout(
      () => close(timedItem, false),
      Math.max(0, timedItem.timeoutMs - timer.elapsed()),
    );
    return () => {
      clearTimeout(timeout);
      timer.stop();
    };
    // Restarts only when the timer starts or stops, or the item changes.
  }, [timedItem?.id]);

  const card: WidgetFeedCardProps | null = visible
    ? {
        item,
        timerElapsedMs: timer.elapsed(),
        hovered,
        onHoverChange: setHovered,
        onButton: (button) => {
          if (button.action === "open_url") {
            void window.electronAPI.openExternal(button.url);
          } else if (button.action === "open_route") {
            trpcClient.widget.navigateMainWindow
              .mutate({ route: button.route })
              .catch(logFailure("navigation"));
          }
          close(item, button.action !== "dismiss");
        },
        onClose: () => close(item, false),
      }
    : null;

  return { card, showSequence };
}
