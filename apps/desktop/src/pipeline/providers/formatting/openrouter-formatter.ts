import { FormattingProvider, FormatParams } from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { constructFormatterPrompt } from "./formatter-prompt";
import { extractFormattedText } from "./extract-formatted-text";

import { generateText } from "ai";

export class OpenRouterProvider implements FormattingProvider {
  readonly name = "openrouter";

  private provider: any;
  private model: string;

  constructor(apiKey: string, model: string) {
    // Configure OpenRouter provider
    this.provider = createOpenRouter({
      apiKey: apiKey,
    });

    this.model = model;
  }

  async format(params: FormatParams): Promise<string> {
    try {
      // Extract parameters from the new structure
      const { text, context } = params;

      // Construct the formatter prompt using the extracted function
      const { systemPrompt, userPrompt } = constructFormatterPrompt(context);

      // Build user prompt with context
      const userPromptContent = userPrompt(text);

      logger.pipeline.info("Formatting request", {
        model: this.model,
        systemPrompt,
        userPrompt: userPromptContent,
      });

      const { text: aiResponse } = await generateText({
        model: this.provider(this.model),
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPromptContent,
          },
        ],
        temperature: 0.1, // Low temperature for consistent formatting
        maxTokens: 2000,
      });

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
