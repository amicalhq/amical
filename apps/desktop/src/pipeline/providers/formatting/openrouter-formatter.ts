import { FormattingProvider, FormatParams } from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { constructFormatterPrompt } from "./formatter-prompt";
import { extractFormattedText } from "./extract-formatted-text";

import { CoreMessage, generateText } from "ai";
import { getUserAgent } from "../../../utils/http-client";

export class OpenRouterProvider implements FormattingProvider {
  readonly name = "openrouter";

  private provider: ReturnType<typeof createOpenRouter>;
  private endpoint = "https://openrouter.ai/api/v1/chat/completions";
  private model: string;

  constructor(apiKey: string, model: string) {
    // Configure OpenRouter provider
    this.provider = createOpenRouter({
      apiKey: apiKey,
      headers: {
        "User-Agent": getUserAgent(),
      },
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
      const messages: CoreMessage[] = [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPromptContent,
        },
      ];
      const requestPayload = {
        provider: this.name,
        endpoint: this.endpoint,
        model: this.model,
        temperature: 0.1,
        maxTokens: 5000,
        messages,
      };

      logger.pipeline.debug("Formatting LLM request payload", requestPayload);

      const { text: aiResponse } = await generateText({
        model: this.provider(this.model),
        messages: requestPayload.messages,
        temperature: requestPayload.temperature,
        maxTokens: requestPayload.maxTokens,
      });

      logger.pipeline.debug("Formatting LLM raw response", {
        provider: this.name,
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
            rawResponseLength: aiResponse.length,
          },
          "Formatting XML extraction failed, returning original text",
        );
      }

      logger.pipeline.debug("Formatting LLM parsed response", {
        provider: this.name,
        original: text,
        formatted: extraction.text,
        usedFallback: extraction.usedFallback,
        fallbackReason: extraction.reason,
      });

      return extraction.text;
    } catch (error) {
      logger.pipeline.error("Formatting failed:", error);
      throw error;
    }
  }
}
