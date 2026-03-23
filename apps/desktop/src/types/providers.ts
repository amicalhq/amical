export interface ValidationResult {
  success: boolean;
  error?: string;
}

// OpenRouter API response types
export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing?: {
    prompt: number;
    completion: number;
  };
  context_length: number;
  architecture?: {
    modality: string;
    tokenizer: string;
    instruct_type?: string;
  };
  top_provider?: {
    max_completion_tokens?: number;
    is_moderated: boolean;
  };
}

export interface OpenRouterResponse {
  data: OpenRouterModel[];
}

// Ollama API response types
export interface OllamaModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
  expires_at?: string;
  size_vram?: number;
}

export interface OllamaResponse {
  models: OllamaModel[];
}

// OpenAI-compatible /v1/models response types
export interface OpenAICompatibleModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  context_length?: number;
  context_window?: number;
  description?: string;
  [key: string]: unknown;
}

export interface OpenAICompatibleResponse {
  data: OpenAICompatibleModel[];
}

// Unified model interface for UI
export interface ProviderModel {
  id: string; // Unique identifier (model ID)
  name: string; // Display name
  providerType: string; // Stable provider type key (e.g. "openrouter", "ollama")
  providerInstanceId: string; // Stable provider instance ID
  provider: string; // e.g. "OpenRouter", "Ollama", "OpenAI Compatible"
  size?: string; // Model size (e.g., "7B", "Large")
  context: string; // Context length (e.g., "32k", "128k")
  description?: string; // Optional description
  originalModel?: OpenRouterModel | OllamaModel | OpenAICompatibleModel; // Keep original for reference
}
