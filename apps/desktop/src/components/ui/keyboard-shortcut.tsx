import * as React from "react";
import { cn } from "@/lib/utils";

const KEY_LABELS: Record<string, string> = {
  cmd: "⌘",
  command: "⌘",
  ctrl: "Ctrl",
  control: "Ctrl",
  shift: "⇧",
  alt: "Alt",
  option: "Alt",
  fn: "Fn",
  enter: "↵",
  return: "↵",
  backspace: "⌫",
  delete: "⌦",
  escape: "Esc",
  esc: "Esc",
  tab: "⇥",
  space: "Space",
  " ": "Space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

const MAC_KEY_LABELS: Record<string, string> = {
  ...KEY_LABELS,
  ctrl: "⌃",
  control: "⌃",
  alt: "⌥",
  option: "⌥",
  fn: "fn",
};

const LARGE_SYMBOL_LABELS = new Set([
  "⌘",
  "⌃",
  "⌥",
  "⇧",
  "↵",
  "⌫",
  "⌦",
  "⇥",
  "↑",
  "↓",
  "←",
  "→",
]);

interface KeyboardShortcutProps extends React.ComponentProps<"span"> {
  keys?: string[];
  keyClassName?: string;
  separatorClassName?: string;
}

function isMacPlatform() {
  if (typeof window === "undefined") return false;
  return window.electronAPI?.platform === "darwin";
}

function formatShortcutKey(key: string, useMacLabels: boolean) {
  const normalized = key.trim();
  const map = useMacLabels ? MAC_KEY_LABELS : KEY_LABELS;
  const mapped = map[normalized.toLowerCase()];

  if (mapped) return mapped;
  if (normalized.length === 1) return normalized.toUpperCase();
  return normalized;
}

function isLargeSymbolLabel(label: string) {
  return LARGE_SYMBOL_LABELS.has(label);
}

function KeyboardShortcut({
  keys = [],
  className,
  keyClassName,
  separatorClassName,
  ...props
}: KeyboardShortcutProps) {
  if (!keys.length) return null;

  const useMacLabels = isMacPlatform();

  return (
    <span
      data-slot="keyboard-shortcut"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    >
      {keys.map((key, index) => {
        const label = formatShortcutKey(key, useMacLabels);

        return (
          <React.Fragment key={`${key}-${index}`}>
            <kbd
              className={cn(
                "kbd-keycap inline-flex h-6 min-w-6 items-center justify-center rounded-[0.45rem] border-[1.5px] bg-[var(--kbd-keycap-face-2)] bg-gradient-to-b from-[var(--kbd-keycap-face-1)] to-[var(--kbd-keycap-face-2)] px-2 text-xs font-semibold text-foreground",
                keyClassName,
              )}
            >
              <span
                className={cn(
                  isLargeSymbolLabel(label) && "[font-size:1.12em] leading-none",
                )}
              >
                {label}
              </span>
            </kbd>
            {index < keys.length - 1 ? (
              <span
                className={cn("text-xs text-muted-foreground/80", separatorClassName)}
              >
                +
              </span>
            ) : null}
          </React.Fragment>
        );
      })}
    </span>
  );
}

export { KeyboardShortcut };
