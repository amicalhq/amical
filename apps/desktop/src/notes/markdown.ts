import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import type {
  Root,
  RootContent,
  PhrasingContent,
  BlockContent,
  ListItem,
} from "mdast";

// The persistence profile is documented in README.md. This adapter never uses
// HTML import/export; raw HTML is displayed as text and links use an allowlist.
const markdown = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkStringify, {
    bullet: "-",
    emphasis: "*",
    strong: "*",
    fences: true,
    listItemIndent: "one",
    handlers: {
      text(node, parent, state, info) {
        const output = state.safe(node.value, info);
        // GFM deletion delimiters cannot touch whitespace. Strong/emphasis are
        // handled by the serializer, but its delete handler needs this escape.
        return parent?.type === "delete"
          ? output.replace(/^[ \t]+|[ \t]+$/g, (spaces) =>
              [...spaces].map((char) => `&#${char.charCodeAt(0)};`).join(""),
            )
          : output;
      },
    },
  });

export function isSafeNoteUrl(url: string): boolean {
  return (
    /^(https?:\/\/|mailto:)/i.test(url) &&
    // eslint-disable-next-line no-control-regex -- Reject control characters in active links.
    !/[\u0000-\u0020\u007f]/.test(url)
  );
}

export interface EditorNode {
  type: string;
  version: number;
  children?: EditorNode[];
  text?: string;
  format?: number | string;
  style?: string;
  mode?: string;
  detail?: number;
  indent?: number;
  direction?: string | null;
  tag?: string;
  listType?: string;
  start?: number;
  value?: number;
  checked?: boolean;
  language?: string;
  url?: string;
  title?: string | null;
  rel?: string | null;
  target?: string | null;
  isUnlinked?: boolean;
}
export interface NoteEditorState {
  root: EditorNode & { children: EditorNode[] };
}

function unsupported(reason: string): never {
  throw new Error(`Unsupported note formatting: ${reason}`);
}
function children(node: EditorNode): EditorNode[] {
  if (!Array.isArray(node.children)) throw new Error("Malformed note children");
  return node.children;
}
function check(node: EditorNode) {
  if (!node || typeof node !== "object" || typeof node.type !== "string")
    throw new Error("Malformed note node");
  if (node.version !== undefined && node.version !== 1)
    unsupported("node version");
  if (node.children && typeof node.format === "number" && node.format !== 0)
    unsupported("block alignment");
  if (node.style) unsupported("custom text style");
  if (
    typeof node.format === "string" &&
    node.format !== "" &&
    node.format !== "left"
  )
    unsupported("block alignment");
  if (node.direction && node.direction !== "ltr")
    unsupported("explicit text direction");
  if (node.indent && !["list", "listitem", "note-listitem"].includes(node.type))
    unsupported("block indentation");
  if (node.mode && node.mode !== "normal") unsupported("text mode");
}
function inline(nodes: EditorNode[]): PhrasingContent[] {
  const merged: EditorNode[] = [];
  for (const node of nodes) {
    check(node);
    const previous = merged.at(-1);
    if (
      node.type === "text" &&
      previous?.type === "text" &&
      (node.format ?? 0) === (previous.format ?? 0) &&
      typeof node.text === "string" &&
      typeof previous.text === "string"
    ) {
      previous.text += node.text;
    } else merged.push({ ...node });
  }
  return merged.flatMap((node): PhrasingContent[] => {
    if (node.type === "linebreak") return [{ type: "break" }];
    if (node.type === "autolink" && node.isUnlinked)
      return inline(children(node));
    if (node.type === "link" || node.type === "autolink") {
      if (typeof node.url !== "string" || !isSafeNoteUrl(node.url))
        unsupported("link scheme");
      return [
        {
          type: "link",
          url: node.url,
          title: node.title ?? null,
          children: inline(children(node)) as Exclude<
            PhrasingContent,
            { type: "link" }
          >[],
        },
      ];
    }
    if (node.type !== "text" && node.type !== "tab") unsupported(node.type);
    if (typeof node.text !== "string") throw new Error("Malformed note text");
    const format = node.format ?? 0;
    if (
      typeof format !== "number" ||
      !Number.isInteger(format) ||
      format < 0 ||
      format > 23 ||
      (format & ~23) !== 0
    )
      unsupported(`text format ${format}`);
    if (format & 16) {
      if (/[\r\n]/.test(node.text)) unsupported("multiline inline code");
    }
    let result: PhrasingContent =
      format & 16
        ? { type: "inlineCode", value: node.text }
        : { type: "text", value: node.text };
    if (format & 2) result = { type: "emphasis", children: [result] };
    if (format & 1) result = { type: "strong", children: [result] };
    if (format & 4) result = { type: "delete", children: [result] };
    return node.text ? [result] : [];
  });
}
function codeText(node: EditorNode): string {
  return children(node)
    .map((child) => {
      if (child.type === "linebreak") return "\n";
      if (
        !["text", "code-highlight", "tab"].includes(child.type) ||
        typeof child.text !== "string"
      )
        unsupported("code child");
      if (child.style || (child.format && child.format !== 0))
        unsupported("formatted code block");
      return child.text;
    })
    .join("");
}
const inlineTypes = new Set(["text", "tab", "linebreak", "link", "autolink"]);
function blocks(nodes: EditorNode[]): BlockContent[] {
  return nodes.map((node): BlockContent => {
    check(node);
    switch (node.type) {
      case "paragraph":
        return { type: "paragraph", children: inline(children(node)) };
      case "heading": {
        if (!/^h[1-6]$/.test(node.tag ?? "")) unsupported("heading level");
        return {
          type: "heading",
          depth: Number(node.tag!.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6,
          children: inline(children(node)),
        };
      }
      case "quote":
        return {
          type: "blockquote",
          children: children(node).every((child) => inlineTypes.has(child.type))
            ? [{ type: "paragraph", children: inline(children(node)) }]
            : blocks(children(node)),
        };
      case "horizontalrule":
        return { type: "thematicBreak" };
      case "code":
        return {
          type: "code",
          lang: node.language || null,
          value: codeText(node),
        };
      case "list": {
        if (!["number", "bullet", "check"].includes(node.listType ?? ""))
          unsupported("list type");
        const items: ListItem[] = [];
        for (const item of children(node)) {
          check(item);
          if (!["listitem", "note-listitem"].includes(item.type))
            unsupported("list child");
          const contents = children(item);
          // Lexical represents nested lists using a sibling wrapper list item.
          if (
            contents.length === 1 &&
            contents[0].type === "list" &&
            items.length
          ) {
            items[items.length - 1].children.push(...blocks(contents));
            continue;
          }
          const itemBlocks: BlockContent[] = [];
          let pending: EditorNode[] = [];
          const flush = () => {
            if (pending.length) {
              itemBlocks.push({ type: "paragraph", children: inline(pending) });
              pending = [];
            }
          };
          for (const child of contents) {
            if (inlineTypes.has(child.type)) pending.push(child);
            else {
              flush();
              itemBlocks.push(...blocks([child]));
            }
          }
          flush();
          items.push({
            type: "listItem",
            spread:
              itemBlocks.filter((block) => block.type === "paragraph").length >
              1,
            checked: node.listType === "check" ? (item.checked ?? false) : null,
            children: itemBlocks,
          });
        }
        return {
          type: "list",
          ordered: node.listType === "number",
          start: node.listType === "number" ? (node.start ?? 1) : null,
          spread: false,
          children: items,
        };
      }
      default:
        return unsupported(node.type);
    }
  });
}

export function editorStateToMarkdown(value: unknown): string {
  if (!value || typeof value !== "object" || !("root" in value))
    throw new Error("Malformed note document");
  const root = (value as NoteEditorState).root;
  check(root);
  if (root.type !== "root") throw new Error("Malformed note root");
  const tree: Root = { type: "root", children: blocks(children(root)) };
  if (
    tree.children.every(
      (node) => node.type === "paragraph" && node.children.length === 0,
    )
  )
    return "";
  const result = markdown.stringify(tree);
  // Refuse to mark a conversion successful if Markdown cannot carry its
  // structure or text. The caller retains the complete original for recovery.
  if (
    JSON.stringify(semanticTree(tree)) !==
    JSON.stringify(semanticTree(markdown.parse(result)))
  ) {
    unsupported("content cannot round-trip through the Markdown profile");
  }
  return result;
}

function semanticTree(value: unknown): unknown {
  const node = value as {
    type: string;
    children?: unknown[];
    value?: string;
    depth?: number;
    url?: string;
    title?: string;
    ordered?: boolean;
    start?: number;
    checked?: boolean;
    lang?: string;
  };
  const result: Record<string, unknown> = { type: node.type };
  for (const key of [
    "value",
    "depth",
    "url",
    "title",
    "ordered",
    "start",
    "checked",
    "lang",
  ] as const) {
    if (node[key] != null) result[key] = node[key];
  }
  if (node.children && (node.type === "paragraph" || node.type === "heading")) {
    result.children = readInline(node.children as PhrasingContent[]);
  } else if (node.children) {
    result.children = node.children.map(semanticTree).filter((child) => {
      const block = child as { type: string; children?: unknown[] };
      return block.type !== "paragraph" || block.children?.length;
    });
  }
  return result;
}

const element = (
  type: string,
  childNodes: EditorNode[],
  extra: Partial<EditorNode> = {},
): EditorNode => ({
  type,
  version: 1,
  children: childNodes,
  format: "",
  indent: 0,
  direction: null,
  ...extra,
});
const textNode = (text: string, format = 0): EditorNode => ({
  type: "text",
  version: 1,
  text,
  format,
  style: "",
  mode: "normal",
  detail: 0,
});
const linebreak = (): EditorNode => ({ type: "linebreak", version: 1 });
function textLines(value: string, format = 0): EditorNode[] {
  return value
    .split("\n")
    .flatMap((line, index) => [
      ...(index ? [linebreak()] : []),
      ...(line ? [textNode(line, format)] : []),
    ]);
}
function readInline(nodes: PhrasingContent[], format = 0): EditorNode[] {
  const result = nodes.flatMap((node): EditorNode[] => {
    switch (node.type) {
      case "text":
      case "html":
        return textLines(node.value, format);
      case "inlineCode":
        return [textNode(node.value, format | 16)];
      case "break":
        return [linebreak()];
      case "strong":
        return readInline(node.children, format | 1);
      case "emphasis":
        return readInline(node.children, format | 2);
      case "delete":
        return readInline(node.children, format | 4);
      case "link":
        return isSafeNoteUrl(node.url)
          ? [
              element("link", readInline(node.children, format), {
                url: node.url,
                title: node.title ?? null,
                rel: "noopener noreferrer",
                target: null,
              }),
            ]
          : readInline(node.children, format);
      default:
        return unsupported(`Markdown ${node.type}`);
    }
  });
  // Lexical merges adjacent equally formatted text nodes too.
  return result.reduce<EditorNode[]>((merged, node) => {
    const prev = merged.at(-1);
    if (
      prev?.type === "text" &&
      node.type === "text" &&
      prev.format === node.format
    )
      prev.text += node.text!;
    else merged.push(node);
    return merged;
  }, []);
}
function readBlocks(nodes: RootContent[]): EditorNode[] {
  return nodes.map((node): EditorNode => {
    switch (node.type) {
      case "paragraph":
        return element("paragraph", readInline(node.children));
      case "heading":
        return element("heading", readInline(node.children), {
          tag: `h${node.depth}`,
        });
      case "blockquote":
        return element("quote", readBlocks(node.children));
      case "thematicBreak":
        return { type: "horizontalrule", version: 1 };
      case "code":
        return element("code", textLines(node.value), {
          language: node.lang ?? undefined,
        });
      case "html":
        return element("paragraph", textLines(node.value));
      case "list": {
        const listType = node.ordered
          ? "number"
          : node.children.some((item) => item.checked != null)
            ? "check"
            : "bullet";
        const items = node.children.flatMap((item, index) => {
          const value = (node.start ?? 1) + index;
          const contents: EditorNode[] = [];
          const nested: EditorNode[] = [];
          // Use Lexical's wrapper convention for trailing nested lists only.
          // Moving a list past a following paragraph changes the reading order.
          const trailingLists =
            item.children.findLastIndex((block) => block.type !== "list") + 1;
          for (const [index, block] of item.children.entries()) {
            if (index >= trailingLists)
              nested.push(
                element("note-listitem", readBlocks([block]), { value }),
              );
            else if (block.type === "paragraph" && contents.length === 0)
              contents.push(...readInline(block.children));
            else contents.push(...readBlocks([block]));
          }
          return [
            element("note-listitem", contents, {
              value,
              ...(listType === "check"
                ? { checked: item.checked ?? false }
                : {}),
            }),
            ...nested,
          ];
        });
        return element("list", items, {
          listType,
          tag: node.ordered ? "ol" : "ul",
          start: node.start ?? 1,
        });
      }
      default:
        return unsupported(`Markdown ${node.type}`);
    }
  });
}
export function markdownToEditorState(value: string): NoteEditorState {
  const root = markdown.parse(value) as Root;
  const contents = readBlocks(root.children);
  return {
    root: element(
      "root",
      contents.length ? contents : [element("paragraph", [])],
    ) as NoteEditorState["root"],
  };
}
