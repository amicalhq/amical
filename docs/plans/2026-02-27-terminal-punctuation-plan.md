# Terminal App Punctuation Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix missing Japanese punctuation when dictating into terminal apps (iTerm2, Terminal.app, etc.) by skipping their noisy `preSelectionText` in Whisper's initial prompt.

**Architecture:** Add `isTerminalApp()` to `whisper-prompt-utils.ts` that checks bundleId against a known list of terminal apps. Use it in `generateInitialPrompt()` to skip `preSelectionText` for terminals, falling back to the language-specific default prompt.

**Tech Stack:** TypeScript, Vitest, whisper-provider.ts, whisper-prompt-utils.ts

---

### Task 1: Add test for isTerminalApp

**Files:**
- Modify: `apps/desktop/tests/pipeline/whisper-provider-prompt.test.ts`

**Step 1: Write the failing tests**

Append to existing test file:

```typescript
import { isTerminalApp } from "../../src/pipeline/providers/transcription/whisper-prompt-utils";

describe("isTerminalApp", () => {
  it("returns true for iTerm2", () => {
    expect(isTerminalApp("com.googlecode.iterm2")).toBe(true);
  });

  it("returns true for Terminal.app", () => {
    expect(isTerminalApp("com.apple.Terminal")).toBe(true);
  });

  it("returns true for Alacritty", () => {
    expect(isTerminalApp("io.alacritty")).toBe(true);
  });

  it("returns false for Safari", () => {
    expect(isTerminalApp("com.apple.Safari")).toBe(false);
  });

  it("returns false for VS Code", () => {
    expect(isTerminalApp("com.microsoft.VSCode")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isTerminalApp(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isTerminalApp("")).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run tests/pipeline/whisper-provider-prompt.test.ts`
Expected: FAIL with "isTerminalApp is not exported"

---

### Task 2: Implement isTerminalApp

**Files:**
- Modify: `apps/desktop/src/pipeline/providers/transcription/whisper-prompt-utils.ts`

**Step 1: Add implementation**

Append to existing file:

```typescript
/**
 * Known terminal app bundle identifiers.
 * Terminal apps return noisy preSelectionText (ANSI escapes, commands, etc.)
 * that is not useful as Whisper initial prompt.
 */
const TERMINAL_BUNDLE_IDS = [
  "com.googlecode.iterm2",
  "com.apple.Terminal",
  "io.alacritty",
  "net.kovidgoyal.kitty",
  "dev.warp.Warp-Stable",
  "com.github.wez.wezterm",
  "co.zeit.hyper",
];

/**
 * Returns true if the given bundleId belongs to a terminal application.
 */
export function isTerminalApp(bundleId: string | undefined): boolean {
  if (!bundleId) return false;
  return TERMINAL_BUNDLE_IDS.includes(bundleId);
}
```

**Step 2: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run tests/pipeline/whisper-provider-prompt.test.ts`
Expected: PASS (all 13 tests)

**Step 3: Commit**

```bash
git add apps/desktop/src/pipeline/providers/transcription/whisper-prompt-utils.ts apps/desktop/tests/pipeline/whisper-provider-prompt.test.ts
git commit -m "feat: add isTerminalApp helper for terminal bundleId detection"
```

---

### Task 3: Integrate into whisper-provider.ts

**Files:**
- Modify: `apps/desktop/src/pipeline/providers/transcription/whisper-provider.ts:270-302`

**Step 1: Update import**

Change existing import at top of file from:
```typescript
import { generateInitialPromptForLanguage } from "./whisper-prompt-utils";
```
to:
```typescript
import { generateInitialPromptForLanguage, isTerminalApp } from "./whisper-prompt-utils";
```

**Step 2: Update generateInitialPrompt to skip preSelectionText for terminals**

Replace the `preSelectionText` block (lines 283-290):

```typescript
    const beforeText =
      accessibilityContext?.context?.textSelection?.preSelectionText;
    if (beforeText && beforeText.trim().length > 0) {
      logger.transcription.debug(
        `Generated initial prompt from before text: "${beforeText}"`,
      );
      return beforeText;
    }
```

with:

```typescript
    const beforeText =
      accessibilityContext?.context?.textSelection?.preSelectionText;
    const bundleId =
      accessibilityContext?.context?.application?.bundleIdentifier;
    if (beforeText && beforeText.trim().length > 0 && !isTerminalApp(bundleId)) {
      logger.transcription.debug(
        `Generated initial prompt from before text: "${beforeText}"`,
      );
      return beforeText;
    }
    if (beforeText && isTerminalApp(bundleId)) {
      logger.transcription.debug(
        `Skipped terminal preSelectionText for initial prompt (${bundleId})`,
      );
    }
```

**Step 3: Run type check**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: No errors

**Step 4: Run all pipeline tests**

Run: `cd apps/desktop && npx vitest run tests/pipeline/`
Expected: All tests pass

**Step 5: Commit**

```bash
git add apps/desktop/src/pipeline/providers/transcription/whisper-provider.ts
git commit -m "feat: skip terminal preSelectionText in Whisper initial prompt"
```
