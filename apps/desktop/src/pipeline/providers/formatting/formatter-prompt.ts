import { FormatParams } from "../../core/pipeline-types";
import { GetAccessibilityContextResult } from "@amical/types";

// Kept in sync with Axis backend repo (~/exa9/axis), packages/prompts/src/formatting.ts.
// Note: Prompts are intentionally treated as "code" and should be updated with care.

/**
 * Application type for formatting context
 */
export type AppType = "email" | "chat" | "notes" | "amical-notes" | "default";

/**
 * App-type specific formatting rules inserted into the system prompt
 */
const APP_TYPE_RULES: Record<AppType, string> = {
  email: `- If the input contains a greeting, body, or closing, separate them with blank lines
- Maintain a professional tone appropriate for business communication
- Use paragraph breaks between distinct topics or requests
- Preserve the sender's level of formality (e.g., "Hi" vs "Dear")`,
  chat: `- Preserve conversational tone
- Keep messages concise - do not expand short replies into longer ones
- Preserve emoji and emoticons if present in the input
- Use dashes or commas for natural pauses instead of formal paragraph breaks`,
  notes: `- Organize content with clear structure using headings, bullet points, or numbered lists where the input implies a list
- Format action items and tasks clearly
- Use concise phrasing - notes should be scannable, not prose-heavy
- Preserve hierarchical relationships (e.g., main topics vs sub-items)`,
  "amical-notes": `- Format output as clean Markdown
- Adapt formatting to content length and complexity:
  - For short, simple content (1-2 sentences): use a single paragraph, no special formatting
  - For medium content with distinct points: use bullet points or numbered lists
  - For longer content with topics: use headers (##, ###) to organize sections
  - For mixed content: combine paragraphs, lists, and headers as appropriate
- Use bullet points (-) for unordered lists of items, ideas, or notes
- Use numbered lists (1. 2. 3.) for sequential steps, priorities, or ranked items
- Use headers for distinct topics or sections (## for main sections, ### for subsections)
- Use bold (**text**) for emphasis on key terms or action items
- Use code blocks (\`\`\`) for technical content, commands, or code snippets
- Keep formatting minimal and purposeful - don't over-format simple content
- Preserve natural speech flow while adding structure where it improves clarity`,
  default: "",
};

/**
 * App-type specific examples for few-shot prompting
 */
const APP_TYPE_EXAMPLES: Record<AppType, string> = {
  email: `### Professional email with greeting and closing:
<input>hi john um i wanted to follow up on our meeting the proposal looks good but we need to revise the timeline thanks sarah</input>
<formatted_text>Hi John,

I wanted to follow up on our meeting. The proposal looks good, but we need to revise the timeline.

Thanks,
Sarah</formatted_text>

### Body only - no salutations added:
<input>the meeting is moved to 3pm please update your calendars</input>
<formatted_text>The meeting is moved to 3pm. Please update your calendars.</formatted_text>

### Brief email reply - keep it short:
<input>got it thanks ill take look and get back to you</input>
<formatted_text>Got it, thanks! I'll take a look and get back to you.</formatted_text>`,
  chat: `### Casual chat message:
<input>hey um quick question do you know if the deploy went through i saw some errors in the logs</input>
<formatted_text>Hey, quick question - do you know if the deploy went through? I saw some errors in the logs.</formatted_text>

### Technical chat message:
<input>found the bug um its in the use effect hook we're not cleaning up the subscription properly</input>
<formatted_text>Found the bug - it's in the useEffect hook. We're not cleaning up the subscription properly.</formatted_text>

### Short chat reply:
<input>yeah that makes sense um ill update the pr</input>
<formatted_text>Yeah that makes sense, I'll update the PR.</formatted_text>`,
  notes: `### Meeting notes with action items:
<input>meeting notes um attendees john sarah mike discussed the roadmap action items sarah to finalize design by friday mike to review budget</input>
<formatted_text>Meeting Notes

Attendees: John, Sarah, Mike

Discussed the roadmap.

Action Items:
- Sarah to finalize design by Friday
- Mike to review budget</formatted_text>

### Quick to-do list:
<input>todo for today um respond to emails review pull requests update documentation</input>
<formatted_text>Todo for Today

- Respond to emails
- Review pull requests
- Update documentation</formatted_text>`,
  "amical-notes": `### Markdown structure for multi-point notes:
<input>quick recap we decided to ship friday risks are perf and we need to update docs next steps benchmark and write docs</input>
<formatted_text>## Recap

We decided to ship on Friday.

## Risks

- Performance
- Documentation updates

## Next steps

- Benchmark performance
- Update docs</formatted_text>`,
  default: `### Filler removal + grammar fix:
<input>so the main issue is that um we need more time</input>
<formatted_text>The main issue is that we need more time.</formatted_text>

### Body only - no salutations added:
<input>the meeting is moved to 3pm please update your calendars</input>
<formatted_text>The meeting is moved to 3pm. Please update your calendars.</formatted_text>`,
};

/**
 * Universal examples shown for all app types (context integration)
 */
const UNIVERSAL_EXAMPLES = `### Grammar improvement (adding articles):
<input>got it thanks ill take look and get back to you</input>
<formatted_text>Got it, thanks! I'll take a look and get back to you.</formatted_text>

### Context integration (adding space at start for continuity):
<before_text>Hello team,</before_text>
<input>just wanted to follow up on the meeting</input>
<formatted_text> Just wanted to follow up on the meeting.</formatted_text>

### Context integration (adding space at start since new sentence):
<before_text>Can we get coffee today?</before_text>
<input>Maybe tomorrow?</input>
<formatted_text> Maybe tomorrow?</formatted_text>`;

/**
 * Context for formatting transcription
 */
export interface FormattingContext {
  /** Target application type */
  appType: AppType;
  /** Custom vocabulary terms to preserve */
  vocabulary?: string[];
  /** Text before the cursor/selection (preSelectionText) */
  beforeText?: string | null;
  /** Text after the cursor/selection (postSelectionText) */
  afterText?: string | null;
}

/**
 * Build vocabulary instruction string using XML tags
 */
function buildVocabInstruction(vocabulary?: string[]): string {
  if (!vocabulary || vocabulary.length === 0) {
    return "";
  }
  return `\n\n<vocabulary>${vocabulary.join(", ")}</vocabulary>`;
}

/**
 * Build context instruction string from surrounding text using XML tags
 */
function buildContextInstruction(
  beforeText?: string | null,
  afterText?: string | null,
): string {
  const parts: string[] = [];

  if (beforeText) {
    parts.push(`<before_text>${beforeText}</before_text>`);
  }

  if (afterText) {
    parts.push(`<after_text>${afterText}</after_text>`);
  }

  if (parts.length === 0) {
    return "";
  }

  return `\n\n${parts.join("\n")}`;
}

/**
 * Build the structured formatting prompt (best performing in evals - structured-v2)
 *
 * @param context - Formatting context with appType, vocabulary, and surrounding text
 * @returns Object with systemPrompt and userPrompt builder
 */
export function buildFormattingPrompt(context: FormattingContext): {
  systemPrompt: string;
  userPrompt: (input: string) => string;
} {
  const { appType, vocabulary, beforeText, afterText } = context;
  const vocabInstr = buildVocabInstruction(vocabulary);
  const contextInstr = buildContextInstruction(beforeText, afterText);

  const systemPrompt = `# Text Formatting Task

## Context Format
Context is provided using XML tags when available:
- <vocabulary>...</vocabulary> - Custom jargon and vocabulary. The input transcription from Whisper might have missed the vocabulary and interpreted them as different tokens. Based on the transcription and similarities of words, replace words in input with words from vocabulary as needed.
- <before_text>...</before_text> - Text appearing before the cursor
- <after_text>...</after_text> - Text appearing after the cursor

## Rules
- NEVER add greetings (Hi, Hello, Hey, Dear) unless the input STARTS with one
- NEVER add closings (Thanks, Best, Regards, Sincerely) unless the input ENDS with one
- NEVER add a signature or name unless the input includes one
- NEVER add new sentences or ideas not in the original
- NEVER change the speaker's intent or meaning
- Minor grammar fixes (articles, prepositions) are OK
- REMOVE filler words: "um", "uh", "like", "you know", "basically"
- REMOVE "so" ONLY when used as a sentence-starter filler (keep "so that", "and so", etc.)
- FIX grammar: add missing articles, fix verb tense, improve flow
- FIX punctuation: periods, commas, question marks
- FIX capitalization: sentence starts, proper nouns, acronyms
- APPLY vocabulary corrections from <vocabulary> tag if provided
- ADD paragraph breaks where appropriate between distinct sections or topics
- When surrounding text is provided, output must flow naturally when inserted between the before/after text
- NEVER repeat content from the surrounding text
- Adjust spacing, capitalization, and punctuation to fit seamlessly with the context
- This might mean adding spacing/whitespace at the end or start depending on the language and what is before and after
- The formatted text will be inserted right between before text and after text, so IT IS IMPORTANT TO ENSURE LEADING AND TRAILING SPACING IS CORRECT.
${APP_TYPE_RULES[appType] ?? APP_TYPE_RULES.default ?? ""}
${vocabInstr}${contextInstr}

## Examples

${APP_TYPE_EXAMPLES[appType] ?? APP_TYPE_EXAMPLES.default ?? ""}

${UNIVERSAL_EXAMPLES}

## Output Format
<formatted_text>
[Your formatted text]
</formatted_text>

## Input Format
<input>[Raw unformatted transcription]</input>
`;

  return {
    systemPrompt,
    userPrompt: (input: string) => `<input>${input}</input>`,
  };
}

/**
 * Wrapper for the desktop pipeline's FormatParams context.
 */
export function constructFormatterPrompt(context: FormatParams["context"]): {
  systemPrompt: string;
  userPrompt: (input: string) => string;
} {
  const { accessibilityContext, vocabulary } = context;

  const appType = detectApplicationType(accessibilityContext);
  const beforeText =
    accessibilityContext?.context?.textSelection?.preSelectionText;
  const afterText =
    accessibilityContext?.context?.textSelection?.postSelectionText;

  return buildFormattingPrompt({
    appType,
    vocabulary: vocabulary && vocabulary.length > 0 ? vocabulary : undefined,
    beforeText,
    afterText,
  });
}

// Map bundle identifiers to application types
const BUNDLE_TO_TYPE: Record<string, AppType> = {
  "com.apple.mail": "email",
  "com.microsoft.Outlook": "email",
  "com.readdle.smartemail": "email",
  "com.google.Gmail": "email",
  "com.tinyspeck.slackmacgap": "chat",
  "com.microsoft.teams": "chat",
  "com.facebook.archon": "chat", // Messenger
  "com.discord.Discord": "chat",
  "com.telegram.desktop": "chat",
  "com.apple.Notes": "notes",
  "com.microsoft.onenote.mac": "notes",
  "com.evernote.Evernote": "notes",
  "notion.id": "notes",
  "com.agiletortoise.Drafts-OSX": "notes",
};

// Browser bundle identifiers
const BROWSER_BUNDLE_IDS = [
  "com.apple.Safari",
  "com.google.Chrome",
  "com.google.Chrome.canary",
  "com.microsoft.edgemac",
  "org.mozilla.firefox",
  "com.brave.Browser",
  "com.operasoftware.Opera",
  "com.vivaldi.Vivaldi",
];

// URL patterns for web applications (general has no patterns, falls through)
const URL_PATTERNS: Partial<Record<AppType, RegExp[]>> = {
  email: [
    /mail\.google\.com/,
    /outlook\.live\.com/,
    /outlook\.office\.com/,
    /mail\.yahoo\.com/,
    /mail\.proton\.me/,
    /webmail\./,
    /roundcube/,
    /fastmail\.com/,
  ],
  chat: [
    /web\.whatsapp\.com/,
    /discord\.com\/channels/,
    /teams\.microsoft\.com/,
    /slack\.com/,
    /web\.telegram\.org/,
    /messenger\.com/,
    /chat\.openai\.com/,
    /claude\.ai/,
  ],
  notes: [
    /notion\.so/,
    /docs\.google\.com/,
    /onenote\.com/,
    /evernote\.com/,
    /roamresearch\.com/,
    /obsidian\.md/,
    /workflowy\.com/,
    /coda\.io/,
  ],
};

export function detectApplicationType(
  accessibilityContext: GetAccessibilityContextResult | null | undefined,
): AppType {
  if (!accessibilityContext?.context?.application?.bundleIdentifier) {
    return "default";
  }

  const bundleId = accessibilityContext.context.application.bundleIdentifier;

  // Amical's own app: align to Axis prompt format but preserve appType value.
  if (bundleId === "com.amical.desktop") {
    return "amical-notes";
  }

  // Check if it's a browser
  const isBrowser = BROWSER_BUNDLE_IDS.some(
    (browserId) => bundleId.includes(browserId) || browserId.includes(bundleId),
  );

  if (isBrowser && accessibilityContext.context?.windowInfo?.url) {
    // Try to detect type from URL
    const url = accessibilityContext.context.windowInfo.url.toLowerCase();

    for (const [type, patterns] of Object.entries(URL_PATTERNS) as [
      AppType,
      RegExp[],
    ][]) {
      if (patterns?.some((pattern) => pattern.test(url))) {
        return type;
      }
    }
  }

  // Check for exact match in native apps
  if (BUNDLE_TO_TYPE[bundleId]) {
    return BUNDLE_TO_TYPE[bundleId];
  }

  // Check for partial matches
  for (const [key, type] of Object.entries(BUNDLE_TO_TYPE) as [
    string,
    AppType,
  ][]) {
    if (bundleId.includes(key) || key.includes(bundleId)) {
      return type;
    }
  }

  // Default to default
  return "default";
}
