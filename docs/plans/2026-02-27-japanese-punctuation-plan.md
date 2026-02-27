# Japanese Punctuation Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix missing Japanese punctuation (。、) in Whisper transcription output by adding language-specific default initial prompts.

**Architecture:** Add a `LANGUAGE_DEFAULT_PROMPTS` map and use it as fallback in `generateInitialPrompt()` when no prior context is available. Pass `language` through to the prompt generator.

**Tech Stack:** TypeScript, Vitest, whisper-provider.ts

---

### Task 1: Add test for generateInitialPrompt language fallback

**Files:**
- Create: `apps/desktop/tests/pipeline/whisper-provider-prompt.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { LANGUAGE_DEFAULT_PROMPTS, generateInitialPromptForLanguage } from "../../../src/pipeline/providers/transcription/whisper-prompt-utils";

describe("generateInitialPromptForLanguage", () => {
  it("returns Japanese prompt with punctuation for ja language", () => {
    const result = generateInitialPromptForLanguage("ja");
    expect(result).toContain("。");
    expect(result).toContain("、");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns Chinese prompt for zh language", () => {
    const result = generateInitialPromptForLanguage("zh");
    expect(result).toContain("，");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns Korean prompt for ko language", () => {
    const result = generateInitialPromptForLanguage("ko");
    expect(result).toContain(".");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns empty string for en language", () => {
    const result = generateInitialPromptForLanguage("en");
    expect(result).toBe("");
  });

  it("returns empty string for auto language", () => {
    const result = generateInitialPromptForLanguage("auto");
    expect(result).toBe("");
  });

  it("returns empty string for undefined language", () => {
    const result = generateInitialPromptForLanguage(undefined);
    expect(result).toBe("");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run tests/pipeline/whisper-provider-prompt.test.ts`
Expected: FAIL with "Cannot find module"

---

### Task 2: Create whisper-prompt-utils module

**Files:**
- Create: `apps/desktop/src/pipeline/providers/transcription/whisper-prompt-utils.ts`

**Step 1: Write minimal implementation**

```typescript
/**
 * Language-specific default prompts for Whisper.
 * Whisper adapts its output style (punctuation, formatting) to match the initial_prompt.
 * These prompts contain proper punctuation to guide Whisper's output for CJK languages.
 */
export const LANGUAGE_DEFAULT_PROMPTS: Record<string, string> = {
  ja: "当店の自慢は、時間をかけて仕込んだビーフカレーです。",
  zh: "你好，今天天气不错。",
  ko: "안녕하세요. 오늘 날씨가 좋네요.",
};

/**
 * Returns a language-specific default prompt for Whisper.
 * Used as fallback when no prior transcription context is available.
 */
export function generateInitialPromptForLanguage(
  language: string | undefined,
): string {
  if (!language) return "";
  return LANGUAGE_DEFAULT_PROMPTS[language] ?? "";
}
```

**Step 2: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run tests/pipeline/whisper-provider-prompt.test.ts`
Expected: PASS (6 tests)

**Step 3: Commit**

```bash
git add apps/desktop/src/pipeline/providers/transcription/whisper-prompt-utils.ts apps/desktop/tests/pipeline/whisper-provider-prompt.test.ts
git commit -m "feat: add language-specific default prompts for Whisper (issue #88)"
```

---

### Task 3: Integrate into whisper-provider.ts

**Files:**
- Modify: `apps/desktop/src/pipeline/providers/transcription/whisper-provider.ts:268-291`

**Step 1: Add import**

At top of file, add:
```typescript
import { generateInitialPromptForLanguage } from "./whisper-prompt-utils";
```

**Step 2: Update generateInitialPrompt to accept and use language**

Change signature and add fallback:

```typescript
private generateInitialPrompt(
  aggregatedTranscription?: string,
  accessibilityContext?: TranscribeContext["accessibilityContext"],
  language?: string,
): string {
  if (aggregatedTranscription) {
    logger.transcription.debug(
      `Generated initial prompt from aggregated transcription: "${aggregatedTranscription}"`,
    );
    return aggregatedTranscription;
  }

  const beforeText =
    accessibilityContext?.context?.textSelection?.preSelectionText;
  if (beforeText && beforeText.trim().length > 0) {
    logger.transcription.debug(
      `Generated initial prompt from before text: "${beforeText}"`,
    );
    return beforeText;
  }

  const defaultPrompt = generateInitialPromptForLanguage(language);
  if (defaultPrompt) {
    logger.transcription.debug(
      `Generated initial prompt from language default (${language}): "${defaultPrompt}"`,
    );
    return defaultPrompt;
  }

  logger.transcription.debug("Generated initial prompt: empty");
  return "";
}
```

**Step 3: Pass language to generateInitialPrompt in doTranscription**

In `doTranscription()`, change line 168-171:

```typescript
const initialPrompt = this.generateInitialPrompt(
  aggregatedTranscription,
  context.accessibilityContext,
  language,
);
```

**Step 4: Run type check**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: No errors

**Step 5: Run all pipeline tests**

Run: `cd apps/desktop && npx vitest run tests/pipeline/`
Expected: All tests pass

**Step 6: Commit**

```bash
git add apps/desktop/src/pipeline/providers/transcription/whisper-provider.ts
git commit -m "feat: use language-specific default prompt in whisper provider (issue #88)"
```
