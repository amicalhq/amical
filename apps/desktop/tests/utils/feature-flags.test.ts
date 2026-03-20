import { describe, expect, it } from "vitest";
import {
  isFeatureFlagEnabled,
  parseSidebarCtaPayload,
} from "../../src/utils/feature-flags";

describe("isFeatureFlagEnabled", () => {
  it("returns true for the true boolean value", () => {
    expect(isFeatureFlagEnabled(true)).toBe(true);
  });

  it("returns true for enabled string values", () => {
    expect(isFeatureFlagEnabled("true")).toBe(true);
    expect(isFeatureFlagEnabled("1")).toBe(true);
    expect(isFeatureFlagEnabled("on")).toBe(true);
  });

  it("returns false for undefined and empty strings", () => {
    expect(isFeatureFlagEnabled(undefined)).toBe(false);
    expect(isFeatureFlagEnabled("")).toBe(false);
    expect(isFeatureFlagEnabled("   ")).toBe(false);
  });

  it("returns false for disabled values", () => {
    expect(isFeatureFlagEnabled(false)).toBe(false);
    expect(isFeatureFlagEnabled("false")).toBe(false);
    expect(isFeatureFlagEnabled("0")).toBe(false);
    expect(isFeatureFlagEnabled("disabled")).toBe(false);
  });
});

describe("parseSidebarCtaPayload", () => {
  it("parses a valid external CTA payload", () => {
    expect(
      parseSidebarCtaPayload({
        text: "Vote on Product Hunt",
        url: "https://www.producthunt.com/posts/amical",
        palette: "purple",
        style: "solid",
        emoji: "🚀",
      }),
    ).toEqual({
      text: "Vote on Product Hunt",
      url: "https://www.producthunt.com/posts/amical",
      palette: "purple",
      style: "solid",
      emoji: "🚀",
    });
  });

  it("rejects external payloads with non-http protocols", () => {
    expect(
      parseSidebarCtaPayload({
        text: "Bad Link",
        url: "javascript:alert(1)",
      }),
    ).toBeNull();
  });

  it("rejects external payloads with data and file protocols", () => {
    expect(
      parseSidebarCtaPayload({
        text: "Bad Link",
        url: "data:text/plain,hello",
      }),
    ).toBeNull();

    expect(
      parseSidebarCtaPayload({
        text: "Bad Link",
        url: "file:///tmp/amical.txt",
      }),
    ).toBeNull();
  });

  it("parses a valid internal CTA payload", () => {
    expect(
      parseSidebarCtaPayload({
        text: "Read changelog",
        url: "/settings/about",
        palette: "green",
        style: "border",
      }),
    ).toEqual({
      text: "Read changelog",
      url: "/settings/about",
      palette: "green",
      style: "border",
    });
  });

  it("rejects internal payloads that are not root-relative", () => {
    expect(
      parseSidebarCtaPayload({
        text: "Read changelog",
        url: "settings/about",
      }),
    ).toBeNull();
  });

  it("rejects protocol-relative URLs in internal-looking payloads", () => {
    expect(
      parseSidebarCtaPayload({
        text: "Read changelog",
        url: "//amical.ai/changelog",
      }),
    ).toBeNull();
  });

  it("rejects payloads missing required fields", () => {
    expect(
      parseSidebarCtaPayload({
        url: "https://amical.ai/changelog",
      }),
    ).toBeNull();
  });

  it("rejects payloads with empty required string fields", () => {
    expect(
      parseSidebarCtaPayload({
        text: "",
        url: "/settings/about",
      }),
    ).toBeNull();

    expect(
      parseSidebarCtaPayload({
        text: "Read changelog",
        url: "",
      }),
    ).toBeNull();
  });

  it("rejects payloads with unsupported style variants", () => {
    expect(
      parseSidebarCtaPayload({
        text: "Read changelog",
        url: "/settings/about",
        style: "neon",
      }),
    ).toBeNull();
  });
});
