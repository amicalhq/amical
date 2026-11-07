import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { convertLegacyNote } from "@/notes/legacy";
import { markdownToEditorState } from "@/notes/markdown";

function document(children: unknown[]) {
  return JSON.stringify({ root: { type: "root", children } });
}
const text = (value: string, format = 0) => ({
  type: "text",
  version: 1,
  text: value,
  format,
});
const paragraph = (children: unknown[]) => ({ type: "paragraph", children });

describe("legacy formatting policy", () => {
  it.each([8, 32, 64, 128, 256, 512, 1024])(
    "drops unsupported format %s while preserving supported bold and literal text",
    (format) => {
      const source = document([
        paragraph([text("مرحبا *literal* 👋", format | 1)]),
      ]);
      const result = markdownToEditorState(convertLegacyNote([], source));
      expect(result.root.children[0].children).toMatchObject([
        { text: "مرحبا *literal* 👋", format: 1 },
      ]);
    },
  );

  it("drops CSS and layout styling from a compacted Yjs document", () => {
    const source = document([
      {
        ...paragraph([
          { ...text("styled", 9), style: "color:red", mode: "token" },
          { type: "linebreak" },
          text("next", 4),
        ]),
        format: "center",
        direction: "rtl",
        indent: 3,
      },
      {
        type: "code",
        language: "js",
        children: [{ ...text("const x = `hi`;\n", 8), style: "color:red" }],
      },
    ]);
    const doc = new Y.Doc();
    doc.getText("content").insert(0, source);
    const compacted = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    const result = convertLegacyNote([compacted], "stale column");
    expect(result).toContain("**styled**\\\n~~next~~");
    expect(result).toContain("const x = `hi`;\n");
    expect(result).not.toContain("color:red");
    expect(convertLegacyNote([compacted], "stale column")).toBe(result);
  });

  it("keeps the label of an unsafe link as text", () => {
    const source = document([
      paragraph([
        {
          type: "link",
          url: "javascript:alert(1)",
          children: [text("label", 8)],
        },
      ]),
    ]);
    expect(convertLegacyNote([], source)).toBe("label\n");
  });

  it("still refuses malformed content and unknown content-bearing nodes", () => {
    for (const source of [
      "{bad JSON",
      document([paragraph([{ type: "text", format: 8 }])]),
      document([{ type: "image", src: "original.png" }]),
      document([{ type: "custom-embed", data: "original" }]),
    ]) {
      expect(() => convertLegacyNote([], source)).toThrow();
    }
  });
});
