import { createOpenAI } from "@ai-sdk/openai";
import { CoreMessage, generateText } from "ai";
import { FormattingProvider, FormatParams } from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { getUserAgent } from "../../../utils/http-client";
import { extractFormattedText } from "./extract-formatted-text";
import { constructFormatterPrompt } from "./formatter-prompt";

export class OpenAICompatibleFormatter implements FormattingProvider {
  readonly name = "openai-compatible";

  private provider: ReturnType<typeof createOpenAI>;
  private baseURL: string;

  constructor(
    apiKey: string,
    baseURL: string,
    private model: string,
  ) {
    this.baseURL = baseURL;
    this.provider = createOpenAI({
      apiKey,
      baseURL,
      compatibility: "compatible",
      name: "openai-compatible",
      headers: {
        "User-Agent": getUserAgent(),
      },
    });
  }

  async format(params: FormatParams): Promise<string> {
    try {
      const { text, context } = params;
      const { systemPrompt, userPrompt } = constructFormatterPrompt(context);
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
        endpoint: `${this.baseURL}/chat/completions`,
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
