import * as Y from "yjs";
import {
  editorStateToMarkdown,
  isSafeNoteUrl,
  type EditorNode,
} from "./markdown";
import { serializePlainTextToLexicalEditorStateJson } from "../services/notes/lexical-editor-state";

export function reconstructLegacyNote(
  updates: Uint8Array[],
  content: string | null,
): string | null {
  if (!updates.length) {
    if (!content) return null;
    // No format marker ever existed for this column. Only recognize a complete
    // Lexical document; arbitrary text must not silently become Markdown.
    const parsed = JSON.parse(content);
    if (parsed?.root?.type !== "root")
      throw new Error("Missing legacy editor updates");
    return content;
  }
  const doc = new Y.Doc();
  try {
    for (const update of updates) Y.applyUpdate(doc, update);
    if (doc.store.pendingStructs || doc.store.pendingDs)
      throw new Error("Incomplete legacy editor updates");
    if ([...doc.share.keys()].some((key) => key !== "content"))
      throw new Error("Unknown legacy document structure");
    return doc.getText("content").toString() || null;
  } finally {
    doc.destroy();
  }
}

export function convertLegacyNote(
  updates: Uint8Array[],
  content: string | null,
  allowPlainTextYjs = false,
): string {
  const source = reconstructLegacyNote(updates, content);
  if (source === null) return "";
  // Before the Lexical rollout Y.Text held plain text. Only enable that
  // interpretation when the existing data-migration marker identifies it.
  // JSON-looking broken documents remain blocked, never treated as plain text.
  if (
    allowPlainTextYjs &&
    updates.length &&
    !["{", "["].includes(source.trimStart()[0])
  ) {
    return editorStateToMarkdown(
      JSON.parse(serializePlainTextToLexicalEditorStateJson(source)),
    );
  }
  const document = JSON.parse(source);
  return editorStateToMarkdown({
    ...document,
    root: stripLegacyStyling(document.root)[0],
  });
}

// Migration-only normalization. Retained Yjs/SQL originals keep the styling;
// the regular editor uses only the Markdown profile after this conversion.
function stripLegacyStyling(value: unknown, inCode = false): EditorNode[] {
  if (!value || typeof value !== "object" || !("type" in value))
    throw new Error("Malformed note node");
  const node = { ...(value as EditorNode) };
  if (node.children !== undefined) {
    if (!Array.isArray(node.children))
      throw new Error("Malformed note children");
    node.children = node.children.flatMap((child) =>
      stripLegacyStyling(child, inCode || node.type === "code"),
    );
    node.format = "";
  } else if (["text", "tab", "code-highlight"].includes(node.type)) {
    if (
      typeof node.text !== "string" ||
      (node.format !== undefined &&
        (typeof node.format !== "number" ||
          !Number.isSafeInteger(node.format) ||
          node.format < 0))
    )
      throw new Error("Malformed note text");
    // Retain bold, italic, strikethrough and inline code; all other bits style
    // the same underlying text. Code-block highlighting is derived on reopen.
    node.format = inCode ? 0 : ((node.format as number | undefined) ?? 0) & 23;
    if (/[\r\n]/.test(node.text)) node.format &= ~16;
  }
  node.style = "";
  node.mode = "normal";
  node.direction = null;
  node.indent = 0;
  if (
    ["link", "autolink"].includes(node.type) &&
    typeof node.url === "string" &&
    !isSafeNoteUrl(node.url)
  ) {
    if (!node.children) throw new Error("Malformed note children");
    return node.children;
  }
  // Unknown node types/versions still reach the strict converter. They may
  // contain attachments or other content that is not safe to discard.
  return [node];
}
