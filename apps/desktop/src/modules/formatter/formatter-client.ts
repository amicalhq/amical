/**
 * Abstract base class for text formatting clients
 */
export abstract class FormatterClient {
  abstract formatText(text: string): Promise<string>;
}

/**
 * Configuration interface for formatter clients
 */
export interface FormatterConfig {
  provider: "openrouter";
  model: string;
  apiKey: string;
  enabled: boolean;
}
