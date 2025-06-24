import { FormatterClient, FormatterConfig } from './formatter-client';
import { OpenRouterFormatterClient } from './openrouter-formatter-client';

/**
 * Main formatter service that manages different formatting providers
 */
export class FormatterService {
  private client: FormatterClient | null = null;
  private config: FormatterConfig | null = null;

  /**
   * Configure the formatter service with the given configuration
   */
  configure(config: FormatterConfig): void {
    this.config = config;
    
    if (!config.enabled) {
      this.client = null;
      return;
    }

    switch (config.provider) {
      case 'openrouter':
        this.client = new OpenRouterFormatterClient(config.apiKey, config.model);
        break;
      default:
        throw new Error(`Unsupported formatter provider: ${config.provider}`);
    }
  }

  /**
   * Format the given text using the configured formatter
   * Returns the original text if formatter is not configured or disabled
   */
  async formatText(text: string): Promise<string> {
    if (!this.client || !this.config?.enabled) {
      return text;
    }

    try {
      return await this.client.formatText(text);
    } catch (error) {
      console.error('Error in formatter service:', error);
      // Return original text if formatting fails
      return text;
    }
  }

  /**
   * Check if the formatter is configured and enabled
   */
  isEnabled(): boolean {
    return this.config?.enabled === true && this.client !== null;
  }

  /**
   * Get the current configuration
   */
  getConfiguration(): FormatterConfig | null {
    return this.config;
  }
}