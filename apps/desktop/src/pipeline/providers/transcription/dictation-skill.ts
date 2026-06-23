// Shared cloud dictation skill payload used by both HTTP and gRPC transports.
// `args` is flattened; gRPC wraps each value array into proto StringList.
export interface DictationSkill {
  preset?: string;
  customPrompt?: string;
  args?: Record<string, string[]>;
}
