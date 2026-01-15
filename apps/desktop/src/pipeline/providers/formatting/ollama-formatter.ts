import { FormattingProvider, FormatParams } from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { constructFormatterPrompt } from "./formatter-prompt";

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
      const { systemPrompt } = constructFormatterPrompt(context);

      logger.pipeline.debug("Formatting request", {
        model: this.model,
        systemPrompt,
        userPrompt: text,
      });

      // Use Ollama's chat endpoint for system/user message structure
      const response = await fetch(`${this.ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text },
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

      // Extract formatted text from XML tags (same as OpenRouter)
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
