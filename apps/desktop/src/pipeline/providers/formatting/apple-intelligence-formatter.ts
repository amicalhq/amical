import { FormattingProvider, FormatParams } from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { constructFormatterPrompt } from "./formatter-prompt";
import type { NativeBridge } from "../../../services/platform/native-bridge-service";

export class AppleIntelligenceFormatter implements FormattingProvider {
  readonly name = "apple-intelligence";

  constructor(private nativeBridge: NativeBridge) {}

  async format(params: FormatParams): Promise<string> {
    try {
      const { text, context } = params;
      const { systemPrompt } = constructFormatterPrompt(context);

      logger.pipeline.debug("Apple Intelligence formatting request", {
        systemPrompt,
        userPrompt: text,
      });

      const result = await this.nativeBridge.call(
        "generateWithFoundationModel",
        {
          systemPrompt,
          userPrompt: text,
          temperature: 0.1,
        },
        30000,
      );

      logger.pipeline.debug("Apple Intelligence formatting raw response", {
        rawResponse: result.content,
      });

      // Extract formatted text from XML tags (same pattern as Ollama/OpenRouter)
      const match = result.content.match(
        /<formatted_text>([\s\S]*?)<\/formatted_text>/,
      );
      const formattedText = match ? match[1] : result.content;

      logger.pipeline.debug("Apple Intelligence formatting completed", {
        original: text,
        formatted: formattedText,
        hadXmlTags: !!match,
      });

      // If formatted text is empty, fall back to original text
      // On-device models may return empty tags for short inputs
      if (!formattedText || formattedText.trim().length === 0) {
        logger.pipeline.warn(
          "Apple Intelligence returned empty formatted text, using original",
        );
        return text;
      }

      return formattedText;
    } catch (error) {
      logger.pipeline.error("Apple Intelligence formatting failed:", error);
      return params.text;
    }
  }
}
