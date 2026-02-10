import { FormattingProvider, FormatParams } from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { createOpenAI } from "@ai-sdk/openai";
import { constructFormatterPrompt } from "./formatter-prompt";
import { generateText } from "ai";

export class OpenAIFormatter implements FormattingProvider {
  readonly name = "openai";

  private provider: any;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.provider = createOpenAI({
      apiKey: apiKey,
    });

    this.model = model;
  }

  async format(params: FormatParams): Promise<string> {
    try {
      const { text, context } = params;
      const { systemPrompt } = constructFormatterPrompt(context);
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
        temperature: 0.1,
        maxTokens: 2000,
      });

      logger.pipeline.debug("Formatting raw response", {
        model: this.model,
        rawResponse: aiResponse,
      });

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
      return params.text;
    }
  }
}
