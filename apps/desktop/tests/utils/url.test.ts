import { describe, expect, it } from "vitest";
import {
  extractHostnameFromBrowserUrl,
  isInternalUrl,
} from "../../src/utils/url";

describe("isInternalUrl", () => {
  it("accepts root-relative URLs", () => {
    expect(isInternalUrl("/settings/about")).toBe(true);
  });

  it("rejects protocol-relative URLs", () => {
    expect(isInternalUrl("//amical.ai/changelog")).toBe(false);
  });
});

describe("extractHostnameFromBrowserUrl", () => {
  it("returns the hostname for a full URL", () => {
    expect(
      extractHostnameFromBrowserUrl(
        "https://docs.google.com/document/d/123/edit?tab=t.0#heading=h.abc",
      ),
    ).toBe("docs.google.com");
  });

  it("returns the hostname for protocol-less browser URLs", () => {
    expect(
      extractHostnameFromBrowserUrl(
        "mail.google.com/mail/u/0/#inbox?compose=new",
      ),
    ).toBe("mail.google.com");
  });

  it("strips ports from protocol-less localhost URLs", () => {
    expect(
      extractHostnameFromBrowserUrl("localhost:3000/settings/profile"),
    ).toBe("localhost");
  });

  it("strips ports from IPv4 URLs", () => {
    expect(
      extractHostnameFromBrowserUrl("http://127.0.0.1:5173/dashboard"),
    ).toBe("127.0.0.1");
  });

  it("keeps the authority host for custom browser schemes", () => {
    expect(extractHostnameFromBrowserUrl("chrome://settings/people")).toBe(
      "settings",
    );
  });

  it("handles wrapped schemes without relying on URL parsing", () => {
    expect(
      extractHostnameFromBrowserUrl(
        "view-source:https://claude.ai/chats/123?model=sonnet",
      ),
    ).toBe("claude.ai");
  });

  it("returns null for non-host browser values", () => {
    expect(extractHostnameFromBrowserUrl("about:blank")).toBeNull();
    expect(
      extractHostnameFromBrowserUrl("file:///Users/me/Desktop/test.txt"),
    ).toBeNull();
  });

  it("returns null for empty or whitespace-only values", () => {
    expect(extractHostnameFromBrowserUrl("")).toBeNull();
    expect(extractHostnameFromBrowserUrl("   ")).toBeNull();
    expect(extractHostnameFromBrowserUrl(null)).toBeNull();
  });
});
