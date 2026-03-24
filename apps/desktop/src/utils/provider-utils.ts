import {
  REMOTE_PROVIDERS,
  type RemoteProvider,
} from "../constants/remote-providers";

export function isRemoteProvider(provider: string): provider is RemoteProvider {
  return Object.values(REMOTE_PROVIDERS).includes(provider as RemoteProvider);
}

export function isOllamaEmbeddingModelName(name: string): boolean {
  return name.toLowerCase().includes("embed");
}

export function normalizeOllamaUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function normalizeOpenAICompatibleBaseURL(baseURL: string): string {
  const normalized = baseURL.trim().replace(/\/+$/, "");
  if (!normalized) {
    return normalized;
  }

  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}
