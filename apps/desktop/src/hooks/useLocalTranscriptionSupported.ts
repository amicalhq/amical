import { api } from "@/trpc/react";

type UseLocalTranscriptionSupportedResult = {
  localSupported: boolean;
  isLoading: boolean;
};

/**
 * Whether on-device (local whisper) transcription is supported on this machine.
 * Local models require macOS 15+ (the bundled bindings only load there).
 *
 * The value is constant for the process lifetime, so it's cached indefinitely.
 * Fails closed: `localSupported` is false until the query resolves true (and
 * whenever disabled), so callers never briefly treat local as available.
 */
export function useLocalTranscriptionSupported(options?: {
  enabled?: boolean;
}): UseLocalTranscriptionSupportedResult {
  const enabled = options?.enabled ?? true;
  const query = api.models.isLocalTranscriptionSupported.useQuery(undefined, {
    staleTime: Infinity,
    enabled,
  });

  return {
    localSupported: query.data === true,
    isLoading: enabled && query.isLoading,
  };
}
