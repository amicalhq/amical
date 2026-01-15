import { FormattingProvider, FormatParams } from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { constructFormatterPrompt } from "./formatter-prompt";

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
      const { systemPrompt } = constructFormatterPrompt(context);

      // Build user prompt with context
      const userPrompt = text;

      logger.pipeline.info("Formatting request", {
        model: this.model,
        systemPrompt,
        userPrompt,
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
            content: userPrompt,
          },
        ],
        temperature: 0.1, // Low temperature for consistent formatting
        maxTokens: 2000,
      });

      logger.pipeline.debug("Formatting raw response", {
        model: this.model,
        rawResponse: aiResponse,
      });

      // Extract formatted text from XML tags
      const match = aiResponse.match(
        /<formatted_text>([\s\S]*?)<\/formatted_text>/,
      );
      const formattedText = match ? match[1] : aiResponse;

      logger.pipeline.debug("Formatting completed", {
        original: text,
        formatted: formattedText,
        hadXmlTags: !!match,
      });

      return formattedText;
    } catch (error) {
      logger.pipeline.error("Formatting failed:", error);
      // Return original text if formatting fails - simple fallback
      return params.text;
    }
  }
}
