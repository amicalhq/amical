import { FormatParams } from "../../core/pipeline-types";
import { GetAccessibilityContextResult, ApplicationInfo } from "@amical/types";

export function constructFormatterPrompt(context: FormatParams["context"]): {
  systemPrompt: string;
} {
  const { accessibilityContext } = context;

  // Build enhanced system prompt with context information
  let systemPrompt = `You are a professional text formatter. Your task is to clean up and improve the formatting of transcribed text while preserving the original meaning and content.

Please:
1. Fix obvious transcription errors and typos
2. Add proper punctuation where missing
3. Organize the text into proper paragraphs, with sufficient line breaks, etc.
4. Capitalize proper nouns and sentence beginnings
5. Remove unnecessary filler words (um, uh, etc.) but keep natural speech patterns
6. Maintain the speaker's original tone and style
7. If the text is empty, return an empty string
8. For formatting of emails make sure to use the correct email format`;

  // Build context information
  const contextXml = buildContextXml(accessibilityContext);

  if (contextXml) {
    systemPrompt += `\n\n${contextXml}`;
    systemPrompt += `\n\nUse this context to better understand the environment where the text will be used and adjust formatting accordingly.`;
  }

  systemPrompt += `\n\nReturn only the formatted text without any explanations or additional commentary.`;

  return { systemPrompt };
}

function buildContextXml(
  accessibilityContext: GetAccessibilityContextResult | null | undefined,
): string | null {
  if (!accessibilityContext?.context) return null;

  const contextParts: string[] = ["<context>"];

  // Add application info
  const appXml = buildApplicationXml(accessibilityContext.context.application);
  if (appXml) contextParts.push(appXml);

  // Add URL info
  const urlXml = buildUrlXml(
    accessibilityContext.context.windowInfo?.url || undefined,
  );
  if (urlXml) contextParts.push(urlXml);

  contextParts.push("</context>");

  // Only return context if we have actual content
  return contextParts.length > 2 ? contextParts.join("\n") : null;
}

function buildApplicationXml(application: ApplicationInfo): string | null {
  if (!application?.name) return null;

  const appParts = ["  <application>", `    <name>${application.name}</name>`];

  if (application.bundleIdentifier) {
    appParts.push(`    <bundle>${application.bundleIdentifier}</bundle>`);
  }

  appParts.push("  </application>");
  return appParts.join("\n");
}

function buildUrlXml(url: string | undefined): string | null {
  if (!url) return null;

  const domain = extractDomain(url);
  if (!domain) return null;

  return ["  <url>", `    <domain>${domain}</domain>`, "  </url>"].join("\n");
}

function extractDomain(url: string): string | null {
  try {
    // Try standard URL parsing first
    const parsedUrl = new URL(url);
    return parsedUrl.hostname;
  } catch {
    // Handle URLs without protocol or malformed URLs
    // Remove any leading slashes
    const cleanUrl = url.replace(/^\/+/, "");

    // Extract domain from patterns like "domain.com/path" or just "domain.com"
    const match = cleanUrl.match(/^([^\/\s?#]+)/);
    if (match && match[1].includes(".")) {
      return match[1];
    }

    return null;
  }
}
