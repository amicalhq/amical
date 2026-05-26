import { describe, it, expect } from "vitest";
import {
  parseInline,
  parseReleaseNotes,
} from "../../src/renderer/main/components/update-prompt/markdown";

describe("parseInline", () => {
  it("parses bold, italic, link, and plain text", () => {
    expect(parseInline("a **b** _c_ [d](https://x.io) e")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", text: "b" },
      { kind: "text", text: " " },
      { kind: "italic", text: "c" },
      { kind: "text", text: " " },
      { kind: "link", text: "d", href: "https://x.io" },
      { kind: "text", text: " e" },
    ]);
  });

  it("prefers bold over italic for **", () => {
    expect(parseInline("**x**")).toEqual([{ kind: "bold", text: "x" }]);
  });
});

describe("parseReleaseNotes", () => {
  it("parses headings, bullets, and paragraphs, skipping blank lines", () => {
    const md = "## Amical 1.7.1\n\nbody text\n- one\n• two";
    expect(parseReleaseNotes(md)).toEqual([
      { kind: "heading", level: 2, children: [{ kind: "text", text: "Amical 1.7.1" }] },
      { kind: "paragraph", children: [{ kind: "text", text: "body text" }] },
      { kind: "bullet", children: [{ kind: "text", text: "one" }] },
      { kind: "bullet", children: [{ kind: "text", text: "two" }] },
    ]);
  });

  it("treats a fully-bold line as a subheading, tight to its body", () => {
    expect(parseReleaseNotes("**🔐 Title**\nbody")).toEqual([
      { kind: "subheading", children: [{ kind: "text", text: "🔐 Title" }] },
      { kind: "paragraph", children: [{ kind: "text", text: "body" }] },
    ]);
  });

  it("passes through unhandled markdown as plain text", () => {
    expect(parseReleaseNotes("| a | b |")).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "| a | b |" }] },
    ]);
  });
});
