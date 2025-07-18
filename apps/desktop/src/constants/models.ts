export interface Model {
  id: string;
  name: string;
  type: "whisper" | "tts" | "other";
  size: number; // Approximate size in bytes (for UI display only)
  sizeFormatted: string; // Human readable size (e.g., "~39 MB")
  description: string;
  downloadUrl: string;
  filename: string; // Expected filename after download
  checksum?: string; // Optional checksum for validation
}

// DownloadedModel type is now imported from the database schema

export interface DownloadProgress {
  modelId: string;
  progress: number; // 0-100
  status: "downloading" | "paused" | "cancelling" | "error";
  bytesDownloaded: number;
  totalBytes: number;
  error?: string;
  abortController?: AbortController;
}

export interface ModelManagerState {
  activeDownloads: Map<string, DownloadProgress>;
}

// Available Whisper models manifest
export const AVAILABLE_MODELS: Model[] = [
  {
    id: "whisper-tiny",
    name: "Whisper Tiny",
    type: "whisper",
    size: 77.7 * 1024 * 1024, // ~77.7 MB
    sizeFormatted: "~78 MB",
    description:
      "Fastest model with basic accuracy. Good for real-time transcription.",
    downloadUrl:
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    filename: "ggml-tiny.bin",
    checksum: "bd577a113a864445d4c299885e0cb97d4ba92b5f",
  },
  {
    id: "whisper-base",
    name: "Whisper Base",
    type: "whisper",
    size: 148 * 1024 * 1024, // ~148 MB
    sizeFormatted: "~148 MB",
    description: "Balanced speed and accuracy. Recommended for most use cases.",
    downloadUrl:
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    filename: "ggml-base.bin",
    checksum: "465707469ff3a37a2b9b8d8f89f2f99de7299dac",
  },
  {
    id: "whisper-small",
    name: "Whisper Small",
    type: "whisper",
    size: 488 * 1024 * 1024, // ~488 MB
    sizeFormatted: "~488 MB",
    description:
      "Higher accuracy with moderate speed. Good for quality transcription.",
    downloadUrl:
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    filename: "ggml-small.bin",
    checksum: "55356645c2b361a969dfd0ef2c5a50d530afd8d5",
  },
  {
    id: "whisper-medium",
    name: "Whisper Medium",
    type: "whisper",
    size: 1.53 * 1024 * 1024 * 1024, // ~1.53 GB
    sizeFormatted: "~1.5 GB",
    description: "High accuracy model. Slower but more precise transcription.",
    downloadUrl:
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
    filename: "ggml-medium.bin",
    checksum: "fd9727b6e1217c2f614f9b698455c4ffd82463b4",
  },
  {
    id: "whisper-large-v3",
    name: "Whisper Large v3",
    type: "whisper",
    size: 3.1 * 1024 * 1024 * 1024, // ~3.1 GB
    sizeFormatted: "~3.1 GB",
    description:
      "Highest accuracy model. Best quality but slowest transcription.",
    downloadUrl:
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
    filename: "ggml-large-v3.bin",
    checksum: "ad82bf6a9043ceed055076d0fd39f5f186ff8062",
  },
  {
    id: "whisper-large-v3-turbo",
    name: "Whisper Large v3 Turbo",
    type: "whisper",
    size: 1.5 * 1024 * 1024 * 1024, // ~1.5 GB
    sizeFormatted: "~1.5 GB",
    description:
      "Optimized Large v3 variant with only 4 decoder layers, offering significantly faster transcription with accuracy comparable to Large v2/v3.",
    downloadUrl:
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    filename: "ggml-large-v3-turbo.bin",
    checksum: "4af2b29d7ec73d781377bfd1758ca957a807e941",
  },
];
