export interface FormatterConfig {
  enabled: boolean;
  modelId?: string; // Selection key "<providerInstanceId>::<type>::<id>" or legacy raw model ID
  fallbackModelId?: string; // Selection key "<providerInstanceId>::<type>::<id>" or legacy raw model ID
}
