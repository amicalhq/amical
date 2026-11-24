import { trpcClient } from "@/trpc/react";

// Single source of truth for the widget window's mouse pass-through.
//
// Independent surfaces want the widget to be clickable at different times:
// an active notification toast, a hovered FAB or notification card, an open
// draft review, or the renderer error fallback. Each only reports its own
// reason and we derive ignore from the union: the window stays interactive
// while ANY reason is active, and only goes click-through once they're all gone.
export type PassThroughReason = "toast" | "hover" | "feed" | "draft" | "error";

const activeReasons = new Set<PassThroughReason>();

const hitAreas = new Map<
  HTMLElement,
  { x: number; y: number; width: number; height: number }
>();

const pushHitAreas = () => {
  trpcClient.widget.setHitAreas
    .mutate([...hitAreas.values()])
    .catch((error) => {
      console.error("Failed to report the widget hit areas", error);
    });
};

/**
 * Linux only: while the widget ignores the mouse, main clips the widget window
 * to the reported elements (the pill, a notification card), so clicks
 * elsewhere reach the window below. An element that is visible without a
 * pass-through reason must report itself, or the clip hides it. Reports the
 * element's rectangle now and on every size change, until the returned
 * function is called.
 */
export const reportWidgetHitArea = (element: HTMLElement): (() => void) => {
  if (window.electronAPI?.platform !== "linux") return () => undefined;
  const report = () => {
    const rect = element.getBoundingClientRect();
    hitAreas.set(element, {
      x: Math.floor(rect.x),
      y: Math.floor(rect.y),
      width: Math.ceil(rect.width),
      height: Math.ceil(rect.height),
    });
    pushHitAreas();
  };
  const observer = new ResizeObserver(report);
  observer.observe(element);
  window.addEventListener("resize", report);
  report();
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", report);
    hitAreas.delete(element);
    pushHitAreas();
  };
};

// We push the resolved state on every change rather than diffing against a
// cached last value: the main process also toggles the widget's pass-through
// out-of-band (window creation, opening the notes window), so re-asserting the
// renderer's intent on each reason change keeps it authoritative instead of
// drifting from a stale cache. These events are user-paced, so the redundant
// IPCs are negligible.
export const setPassThroughReason = (
  reason: PassThroughReason,
  active: boolean,
) => {
  if (active) activeReasons.add(reason);
  else activeReasons.delete(reason);
  trpcClient.widget.setIgnoreMouseEvents
    .mutate({ ignore: activeReasons.size === 0 })
    .catch((error) => {
      console.error("Failed to set widget mouse pass-through", error);
    });
};
