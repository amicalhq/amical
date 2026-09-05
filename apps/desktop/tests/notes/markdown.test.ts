import { describe, expect, it } from "vitest";
import { markdownToEditorState, editorStateToMarkdown } from "@/notes/markdown";

const text = (value: string, format = 0) => ({
  type: "text",
  version: 1,
  text: value,
  format,
  style: "",
  mode: "normal",
  detail: 0,
});
const state = (...children: unknown[]) => ({
  root: {
    type: "root",
    version: 1,
    children,
    format: "",
    indent: 0,
    direction: null,
  },
});
const paragraph = (...children: unknown[]) => ({
  type: "paragraph",
  version: 1,
  children,
  format: "",
  indent: 0,
  direction: null,
});

describe("desktop Markdown profile", () => {
  it.each([
    "# Heading\n\n## Second\n\n**bold** and *italic* and ~~strike~~\n",
    "3. three\n   - nested\n     1. deeper\n4. four\n",
    "- [x] done\n- [ ] waiting\n",
    "> quote\n>\n> second paragraph\n\n---\n",
    '[link](https://example.com/a\\(b\\) "title")\n',
    "你好 नमस्ते مرحبا שלום 👩🏽‍💻 café\n\nfirst  \nsecond\nsoft line\n",
    "````js\nconst a = `literal`;\n```\n  indented\n\n````\n",
    "a `` `code` `` and `  space  `\n",
  ])("preserves supported structure: %s", (markdown) => {
    const editor = markdownToEditorState(markdown);
    expect(markdownToEditorState(editorStateToMarkdown(editor))).toEqual(
      editor,
    );
  });

  it.each([0, 1, 2, 3, 4, 16, 17, 23])(
    "preserves whitespace and punctuation in format %s",
    (format) => {
      const value = "  white * [space] ` < > &  ";
      const result = markdownToEditorState(
        editorStateToMarkdown(state(paragraph(text(value, format)))),
      );
      expect(result.root.children[0]).toMatchObject({
        children: [{ text: value, format }],
      });
    },
  );
  it("preserves repeated hard breaks, tabs, and code trailing newlines", () => {
    const value = state(
      paragraph(
        text(" leading\ttext "),
        { type: "linebreak", version: 1 },
        { type: "linebreak", version: 1 },
        text(" trailing "),
      ),
    );
    expect(
      markdownToEditorState(editorStateToMarkdown(value)).root.children[0],
    ).toMatchObject(value.root.children[0] as object);
    const code = "one\n\n";
    const output = editorStateToMarkdown(
      state({ type: "code", children: [text(code)] }),
    );
    expect(markdownToEditorState(output).root.children[0]).toMatchObject({
      type: "code",
      children: [{ text: "one" }, { type: "linebreak" }, { type: "linebreak" }],
    });
  });

  it("merges fragmented runs without changing their formatting", () => {
    const converted = markdownToEditorState(
      editorStateToMarkdown(
        state(
          paragraph(
            text("a", 1),
            text("b", 1),
            text(" c "),
            text("d", 3),
            text("e", 3),
          ),
        ),
      ),
    );
    expect(converted.root.children[0]).toMatchObject({
      children: [
        { text: "ab", format: 1 },
        { text: " c ", format: 0 },
        { text: "de", format: 3 },
      ],
    });
  });

  it("escapes literal punctuation instead of interpreting it on reopen", () => {
    const literal =
      "# *stars* _italics_ [link](url) ~~strike~~ > quote ![image](x) &amp; <script>alert(1)</script> \\ `ticks`";
    const result = markdownToEditorState(
      editorStateToMarkdown(state(paragraph(text(literal)))),
    );
    expect(result.root.children[0]).toMatchObject({
      children: [{ text: literal, format: 0 }],
    });
  });

  it.each([8, 32, 64, 128, 256])(
    "refuses unsupported text format %s",
    (format) => {
      expect(() =>
        editorStateToMarkdown(state(paragraph(text("original", format)))),
      ).toThrow(/unsupported/i);
    },
  );
  it("refuses CSS, alignment, unknown nodes, and malformed documents", () => {
    for (const source of [
      state(paragraph({ ...text("original"), style: "color: red" })),
      state({ ...paragraph(text("center")), format: "center" }),
      state({ type: "image", src: "original" }),
      {},
      state(paragraph({ type: "text" })),
    ]) {
      expect(() => editorStateToMarkdown(source)).toThrow();
    }
  });
  it("renders HTML as inert text and rejects active link schemes", () => {
    const source =
      "<script>alert(1)</script>\n\n[x](javascript:alert%281%29)\n";
    const editor = JSON.stringify(markdownToEditorState(source));
    expect(editor).toContain("<script>");
    expect(editor).not.toContain('"type":"link"');
    expect(() =>
      editorStateToMarkdown(
        state(
          paragraph({
            type: "link",
            url: "javascript:alert(1)",
            children: [text("x")],
          }),
        ),
      ),
    ).toThrow();
  });
  it("does not impose cloud body limits", () => {
    const source = "文".repeat(1_100_000);
    const editor = markdownToEditorState(
      editorStateToMarkdown(state(paragraph(text(source)))),
    );
    expect(editor.root.children[0]).toMatchObject({
      children: [{ text: source }],
    });
  });
});
