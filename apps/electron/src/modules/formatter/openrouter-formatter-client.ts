import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { FormatterClient } from './formatter-client';

/**
 * OpenRouter-based text formatter client
 */
export class OpenRouterFormatterClient extends FormatterClient {
  private provider: any;
  private model: string;

  constructor(apiKey: string, model: string) {
    super();

    // Configure OpenRouter provider
    this.provider = createOpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: apiKey,
    });

    this.model = model;
  }

  async formatText(text: string): Promise<string> {
    try {
      const { text: formattedText } = await generateText({
        model: this.provider(this.model),
        messages: [
          {
            role: 'system',
            content: `You are a professional text formatter. Your task is to clean up and improve the formatting of transcribed text while preserving the original meaning and content.

Please:
1. Fix obvious transcription errors and typos
2. Add proper punctuation where missing
3. Organize the text into proper paragraphs
4. Capitalize proper nouns and sentence beginnings
5. Remove unnecessary filler words (um, uh, etc.) but keep natural speech patterns
6. Maintain the speaker's original tone and style

Return only the formatted text without any explanations or additional commentary.`,
          },
          {
            role: 'user',
            content: `Please format this transcribed text:\n\n${text}`,
          },
        ],
        temperature: 0.1, // Low temperature for consistent formatting
        maxTokens: 2000,
      });

      return formattedText;
    } catch (error) {
      console.error('Error formatting text with OpenRouter:', error);
      // Return original text if formatting fails
      return text;
    }
  }
}
