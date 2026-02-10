export interface ValidationResult {
  success: boolean;
  error?: string;
}

export interface OpenRouterValidationRequest {
  apiKey: string;
}

export interface OllamaValidationRequest {
  url: string;
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

// OpenAI API response types
export interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface OpenAIModelsResponse {
  object: string;
  data: OpenAIModel[];
}

// Anthropic API response types
export interface AnthropicModel {
  id: string;
  display_name: string;
  type: string;
  created_at?: string;
}

export interface AnthropicModelsResponse {
  data: AnthropicModel[];
  has_more: boolean;
  first_id?: string;
  last_id?: string;
}

// Google Generative AI API response types
export interface GoogleModel {
  name: string; // e.g., "models/gemini-2.0-flash"
  displayName: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

export interface GoogleModelsResponse {
  models: GoogleModel[];
  nextPageToken?: string;
}

// Unified model interface for UI
export interface ProviderModel {
  id: string; // Unique identifier (model ID)
  name: string; // Display name
  provider: string; // "OpenRouter" | "Ollama" | "OpenAI" | "Anthropic" | "Google"
  size?: string; // Model size (e.g., "7B", "Large")
  context: string; // Context length (e.g., "32k", "128k")
  description?: string; // Optional description
  originalModel?:
    | OpenRouterModel
    | OllamaModel
    | OpenAIModel
    | AnthropicModel
    | GoogleModel; // Keep original for reference
}
