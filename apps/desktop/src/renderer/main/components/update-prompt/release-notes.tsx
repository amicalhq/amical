import { Fragment } from "react";
import { parseReleaseNotes, type Inline } from "./markdown";

function renderInline(nodes: Inline[]) {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case "bold":
        return (
          <strong key={i} className="font-semibold">
            {n.text}
          </strong>
        );
      case "italic":
        return (
          <em key={i} className="italic">
            {n.text}
          </em>
        );
      case "link":
        return (
          <a
            key={i}
            href={n.href}
            className="text-primary underline underline-offset-2"
            onClick={(e) => {
              e.preventDefault();
              void window.electronAPI?.openExternal(n.href);
            }}
          >
            {n.text}
          </a>
        );
      default:
        return <Fragment key={i}>{n.text}</Fragment>;
    }
  });
}

export function ReleaseNotes({ markdown }: { markdown: string }) {
  const blocks = parseReleaseNotes(markdown);
  return (
    <div className="text-sm leading-relaxed">
      {blocks.map((b, i) => {
        if (b.kind === "heading") {
          return (
            <p
              key={i}
              className="text-base font-semibold mt-6 mb-1 first:mt-0"
            >
              {renderInline(b.children)}
            </p>
          );
        }
        if (b.kind === "subheading") {
          return (
            <p key={i} className="font-semibold mt-4 mb-1 first:mt-0">
              {renderInline(b.children)}
            </p>
          );
        }
        if (b.kind === "bullet") {
          return (
            <div key={i} className="flex gap-2 mt-1 pl-1">
              <span aria-hidden>•</span>
              <span>{renderInline(b.children)}</span>
            </div>
          );
        }
        return (
          <p key={i} className="mt-1 text-muted-foreground">
            {renderInline(b.children)}
          </p>
        );
      })}
    </div>
  );
}
