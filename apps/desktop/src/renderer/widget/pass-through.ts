import { trpcClient } from "@/trpc/react";

// Single source of truth for the widget window's mouse pass-through.
//
// Independent surfaces want the widget to be clickable at different times:
// an active notification toast, a hovered FAB, an open draft review, or the
// renderer error fallback. Each only reports its own reason and we derive
// ignore from the union: the window stays interactive while ANY reason is
// active, and only goes click-through once they're all gone.
export type PassThroughReason = "toast" | "hover" | "draft" | "error";

const activeReasons = new Set<PassThroughReason>();

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
