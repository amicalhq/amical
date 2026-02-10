import { FormatParams } from "../../core/pipeline-types";
import { GetAccessibilityContextResult } from "@amical/types";

// Base system prompt
const SYSTEM_PROMPT = `You are a professional text formatter. Your task is to format transcribed text to be clear, readable, and properly structured.`;

// Base instructions that apply to all formatting
const BASE_INSTRUCTIONS = [
  "Fix any transcription errors based on context and custom vocabulary",
  "Add proper punctuation and capitalization",
  "Format paragraphs appropriately with sufficient line breaks",
  "Maintain the original meaning and tone",
  "Use the custom vocabulary to correct domain-specific terms",
  "Remove unnecessary filler words (um, uh, etc.) but keep natural speech patterns",
  "If the text is empty, return <formatted_text></formatted_text>",
  "Return ONLY the formatted text enclosed in <formatted_text></formatted_text> tags",
  "Do not include any commentary, explanations, or text outside the XML tags",
];

// Application type union
type AppType = "email" | "chat" | "notes" | "default";

// Application type specific rules
const APPLICATION_TYPE_RULES: Record<AppType, string[]> = {
  email: [
    "Format with proper email structure (greeting, body paragraphs, closing)",
    "Preserve email metadata if present (From, To, Subject, Date)",
    "Ensure proper paragraph breaks between different topics",
    "Maintain professional tone and formatting",
    "Format any quoted or forwarded content clearly",
    "Preserve email signatures and contact information",
  ],
  chat: [
    "Preserve conversational tone and informal language",
    "Keep messages concise and separate",
    "Maintain emoji and emoticons if present",
    "Format timestamps and usernames clearly if included",
    "Preserve thread context and replies",
  ],
  notes: [
    "Organize content with clear headings and sections",
    "Use bullet points or numbered lists where appropriate",
    "Maintain hierarchical structure of ideas",
    "Format action items and tasks clearly",
    "Preserve any existing formatting hints",
  ],
  default: [
    "Apply standard formatting for general text",
    "Create logical paragraph breaks based on content flow",
    "Maintain consistent formatting throughout",
    "Preserve the original tone and style",
  ],
};

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

export function constructFormatterPrompt(context: FormatParams["context"]): {
  systemPrompt: string;
} {
  const { accessibilityContext, vocabulary, customInstructions } = context;

  // Detect application type
  const applicationType = detectApplicationType(accessibilityContext);

  // Build instructions array
  const instructions = [
    ...BASE_INSTRUCTIONS,
    ...(APPLICATION_TYPE_RULES[applicationType] || []),
  ];

  // Build prompt parts
  const parts = [SYSTEM_PROMPT];

  // Add vocabulary context if available
  if (vocabulary && vocabulary.length > 0) {
    const vocabTerms = vocabulary.join(", ");
    parts.push(`\nCustom vocabulary to use for corrections: ${vocabTerms}`);
  }

  // Add custom instructions if available
  if (customInstructions && customInstructions.trim().length > 0) {
    parts.push(
      `\nCustom formatting instructions from user:\n<user_instructions>\n${customInstructions.trim()}\n</user_instructions>`,
    );
  }

  // Add numbered instructions
  parts.push("\nInstructions:");
  instructions.forEach((instruction, index) => {
    parts.push(`${index + 1}. ${instruction}`);
  });

  return { systemPrompt: parts.join("\n") };
}

export function detectApplicationType(
  accessibilityContext: GetAccessibilityContextResult | null | undefined,
): "email" | "chat" | "notes" | "default" {
  if (!accessibilityContext?.context?.application?.bundleIdentifier) {
    return "default";
  }

  const bundleId = accessibilityContext.context.application.bundleIdentifier;

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
