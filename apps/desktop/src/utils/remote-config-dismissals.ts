// Local, per-device dismissal store for remote-config surfaces. Lives in a
// neutral module so both the surfaces component and the dev menu use it without
// one renderer component importing another.
//
// We store `id → dismissedUntil` (the absolute time the dismissal lapses),
// computed from the surface's `reshowAfterDays` at dismiss time. So the reader
// only compares against `now`, and lapsed entries prune themselves on write —
// no config needed to interpret the store.
import { DEFAULT_RESHOW_AFTER_DAYS } from "@/types/remote-config";

const DISMISSED_STORAGE_KEY = "amical.remoteConfig.dismissed.v3";
export const DISMISSED_CHANGED_EVENT = "amical.remoteConfig.dismissedChanged";
const DAY_MS = 24 * 60 * 60 * 1000;

// id → dismissedUntil (epoch ms).
export function readDismissedUntil(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

export function recordDismissal(id: string, reshowAfterDays?: number): void {
  const now = Date.now();
  // Carry over entries still in effect (lapsed ones drop out), then set this
  // one last so a re-dismissal's fresh window always wins.
  const next: Record<string, number> = {};
  for (const [key, exp] of Object.entries(readDismissedUntil())) {
    if (exp > now) next[key] = exp;
  }
  next[id] = now + (reshowAfterDays ?? DEFAULT_RESHOW_AFTER_DAYS) * DAY_MS;
  window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(DISMISSED_CHANGED_EVENT));
}

// Dev helper (dev menu): forget all local dismissals so surfaces show again.
export function clearRemoteConfigDismissals(): void {
  window.localStorage.removeItem(DISMISSED_STORAGE_KEY);
  window.dispatchEvent(new Event(DISMISSED_CHANGED_EVENT));
}
