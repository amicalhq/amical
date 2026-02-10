import { FormattingProvider, FormatParams } from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { constructFormatterPrompt } from "./formatter-prompt";
import { extractFormattedText } from "./extract-formatted-text";

export class OllamaFormatter implements FormattingProvider {
  readonly name = "ollama";

  constructor(
    private ollamaUrl: string,
    private model: string,
  ) {}

  async format(params: FormatParams): Promise<string> {
    try {
      const { text, context } = params;

      // Construct the formatter prompt using the same function as OpenRouter
      const { systemPrompt, userPrompt } = constructFormatterPrompt(context);
      const userPromptContent = userPrompt(text);

      logger.pipeline.debug("Formatting request", {
        model: this.model,
        systemPrompt,
        userPrompt: userPromptContent,
      });

      // Use Ollama's chat endpoint for system/user message structure
      const response = await fetch(`${this.ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPromptContent },
          ],
          stream: false,
          options: {
            temperature: 0.1, // Low temperature for consistent formatting
            num_predict: 2000,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      const aiResponse = data.message?.content ?? "";

      logger.pipeline.debug("Formatting raw response", {
        model: this.model,
        rawResponse: aiResponse,
      });

      // Extract formatted text from XML tags, with original input as fallback
      const extraction = extractFormattedText(aiResponse, text);

      if (extraction.usedFallback) {
        logger.pipeline.warn(
          {
            model: this.model,
            reason: extraction.reason,
            rawResponsePreview: aiResponse.substring(0, 200),
          },
          "Formatting XML extraction failed, returning original text",
        );
      }

      logger.pipeline.debug("Formatting completed", {
        original: text,
        formatted: extraction.text,
        usedFallback: extraction.usedFallback,
      });

      return extraction.text;
    } catch (error) {
      logger.pipeline.error("Formatting failed:", error);
      // Return original text if formatting fails - simple fallback
      return params.text;
    }
  }
}
