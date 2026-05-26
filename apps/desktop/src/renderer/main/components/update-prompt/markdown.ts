export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: number; children: Inline[] }
  | { kind: "subheading"; children: Inline[] }
  | { kind: "bullet"; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] };

// Order matters: ** before * so bold wins. Bullets use - or • only (not * or +)
// to avoid colliding with *italic* at line start.
const INLINE_RE =
  /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)]+)\)/g;

export function parseInline(text: string): Inline[] {
  const nodes: Inline[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push({ kind: "text", text: text.slice(last, m.index) });
    }
    if (m[1] !== undefined) nodes.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) nodes.push({ kind: "italic", text: m[2] });
    else if (m[3] !== undefined) nodes.push({ kind: "italic", text: m[3] });
    else if (m[4] !== undefined) {
      nodes.push({ kind: "link", text: m[4], href: m[5] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push({ kind: "text", text: text.slice(last) });
  }
  return nodes;
}

export function parseReleaseNotes(md: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        children: parseInline(heading[2]),
      });
      continue;
    }
    const bullet = /^\s*[-•]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push({ kind: "bullet", children: parseInline(bullet[1]) });
      continue;
    }
    // A line that is entirely a single bold span is a feature subheading.
    const boldOnly = /^\*\*(.+)\*\*$/.exec(line);
    if (boldOnly && !boldOnly[1].includes("**")) {
      blocks.push({ kind: "subheading", children: parseInline(boldOnly[1]) });
      continue;
    }
    blocks.push({ kind: "paragraph", children: parseInline(line) });
  }
  return blocks;
}
