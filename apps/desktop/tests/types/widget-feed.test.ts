import { describe, expect, it } from "vitest";
import {
  DEFAULT_WIDGET_FEED_TIMEOUT_MS,
  parseWidgetFeedItem,
} from "../../src/types/widget-feed";

const served = (overrides: Record<string, unknown> = {}) => ({
  id: "item-1",
  placement: "desktop_widget",
  layout: "banner",
  eyebrow: "New",
  title: "Draft mode",
  body: "Rewrite text by voice",
  imageUrl: null,
  buttons: [{ label: "Try", action: "open_url", url: "https://amical.ai/x" }],
  data: {},
  style: {},
  ...overrides,
});

describe("parseWidgetFeedItem", () => {
  it("keeps only buttons the card can run", () => {
    const item = parseWidgetFeedItem(
      served({
        buttons: [
          { label: "Gone", action: "open_url", url: "amical://settings/gone" },
          { label: "Plain http", action: "open_url", url: "http://amical.ai" },
          { label: "Script", action: "open_url", url: "javascript:alert(1)" },
          { label: "Push", action: "request_push_permission", url: null },
          { label: "Later", action: "dismiss", url: null },
          { label: "Try", action: "open_url", url: "https://amical.ai/x" },
          { label: "More", action: "open_url", url: "https://amical.ai/y" },
        ],
      }),
    );

    expect(item?.buttons).toEqual([
      { label: "Later", action: "dismiss" },
      { label: "Try", action: "open_url", url: "https://amical.ai/x" },
    ]);
  });

  it("turns amical:// links to known pages into app routes", () => {
    const button = (url: string) =>
      parseWidgetFeedItem(
        served({ buttons: [{ label: "Open", action: "open_url", url }] }),
      )?.buttons[0];

    expect(button("amical://settings/dictation")).toEqual({
      label: "Open",
      action: "open_route",
      route: "/settings/dictation",
    });
    expect(button("amical:///history/")).toMatchObject({ route: "/history" });
    expect(button("amical://settings/gone")).toBeUndefined();
    expect(button("amical://")).toBeUndefined();
    expect(button("slack://open")).toBeUndefined();
  });

  it("reads the timeout in seconds from data, with 0 for no timeout", () => {
    const timeout = (value: unknown) =>
      parseWidgetFeedItem(served({ data: { timeout: value } }))?.timeoutMs;

    expect(timeout("0")).toBe(0);
    expect(timeout("25")).toBe(25_000);
    expect(timeout(undefined)).toBe(DEFAULT_WIDGET_FEED_TIMEOUT_MS);
    expect(timeout("-5")).toBe(DEFAULT_WIDGET_FEED_TIMEOUT_MS);
    expect(timeout("ten")).toBe(DEFAULT_WIDGET_FEED_TIMEOUT_MS);
  });

  it("keeps only an https image", () => {
    const image = (value: unknown) =>
      parseWidgetFeedItem(served({ imageUrl: value }))?.imageUrl;

    expect(image("https://cdn.example.com/a.png")).toBe(
      "https://cdn.example.com/a.png",
    );
    expect(image("http://cdn.example.com/a.png")).toBeNull();
    expect(image(null)).toBeNull();
  });

  it("drops an item with no id or title", () => {
    expect(parseWidgetFeedItem(served({ id: "" }))).toBeNull();
    expect(parseWidgetFeedItem(served({ title: undefined }))).toBeNull();
    expect(parseWidgetFeedItem(null)).toBeNull();
  });
});
