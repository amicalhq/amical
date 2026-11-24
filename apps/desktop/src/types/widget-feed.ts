import { z } from "zod";
import { isAppPageRoute } from "@/shared/app-routes";

// A notification card in the widget, filled from the Sequenzy placement
// `desktop_widget`. Authors set the copy and buttons in Sequenzy; the app
// draws them with its own card and ignores the item's style, layout and eyebrow.

export type WidgetFeedButton =
  // Opens an https link in the browser.
  | { label: string; action: "open_url"; url: string }
  // Opens a page of the app, from an `amical://` link to a known page.
  | { label: string; action: "open_route"; route: string }
  | { label: string; action: "dismiss" };

export interface WidgetFeedItem {
  id: string;
  title: string;
  body: string;
  // A square image left of the copy, https only; null = the indigo bar.
  imageUrl: string | null;
  buttons: WidgetFeedButton[];
  // Time on screen before the card closes; 0 = until the user closes it.
  timeoutMs: number;
}

export const DEFAULT_WIDGET_FEED_TIMEOUT_MS = 10_000;

const ButtonSchema = z.object({
  label: z.string().min(1),
  action: z.string(),
  url: z.string().nullish(),
});

const ItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  body: z.string().catch(""),
  imageUrl: z.string().nullish().catch(null),
  buttons: z.array(z.unknown()).catch([]),
  data: z.record(z.string(), z.unknown()).catch({}),
});

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

// `amical://settings/dictation` (or `amical:///settings/dictation`) is the
// app route `/settings/dictation`.
function appRoute(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "amical:") return null;
    const route = `/${url.host}${url.pathname}`
      .replace(/\/{2,}/g, "/")
      .replace(/\/$/, "");
    return route || null;
  } catch {
    return null;
  }
}

function parseButton(raw: unknown): WidgetFeedButton | null {
  const button = ButtonSchema.safeParse(raw);
  if (!button.success) return null;
  const { label, action, url } = button.data;
  if (action === "dismiss") return { label, action };
  if (action !== "open_url" || !url) return null;
  if (isHttpsUrl(url)) return { label, action, url };
  const route = appRoute(url);
  return route && isAppPageRoute(route)
    ? { label, action: "open_route", route }
    : null;
}

// `data.timeout` is whole seconds, as a string ("0" = until closed). Any other
// value uses the default.
function parseTimeoutMs(value: unknown): number {
  const seconds = typeof value === "string" ? value.trim() : "";
  return /^\d{1,4}$/.test(seconds)
    ? Number(seconds) * 1000
    : DEFAULT_WIDGET_FEED_TIMEOUT_MS;
}

/** A served placement item, or null when the card cannot draw it. */
export function parseWidgetFeedItem(raw: unknown): WidgetFeedItem | null {
  const item = ItemSchema.safeParse(raw);
  if (!item.success) return null;
  const { id, title, body, imageUrl, buttons, data } = item.data;
  return {
    id,
    title,
    body,
    imageUrl: imageUrl && isHttpsUrl(imageUrl) ? imageUrl : null,
    buttons: buttons
      .map(parseButton)
      .filter((button) => button !== null)
      .slice(0, 2),
    timeoutMs: parseTimeoutMs(data.timeout),
  };
}
