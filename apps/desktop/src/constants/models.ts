// ─── Base type ───
interface BaseSpeechModel {
  id: string;
  name: string;
  type: "whisper" | "tts" | "other";
  description: string;
  features: {
    icon: string;
    tooltip: string;
  }[];
  speed: number;
  accuracy: number;
  provider: string;
  providerIcon: string;
}

// ─── Offline Whisper model (local - requires download) ───
export interface OfflineWhisperModel extends BaseSpeechModel {
  setup: "offline";
  size: number; // Approximate size in bytes (for UI display only)
  sizeFormatted: string; // Human readable size (e.g., "~39 MB")
  modelSize: string;
  downloadUrl: string;
  filename: string; // Expected filename after download
  checksum?: string; // Optional checksum for validation
}

// ─── Amical Cloud model (requires Amical auth) ───
export interface AmicalSpeechModel extends BaseSpeechModel {
  setup: "amical";
}

// ─── API model (OpenAI, Groq, Grok - requires API key) ───
export interface OpenAISpeechModel extends BaseSpeechModel {
  setup: "api";
  apiModelId: string; // Model ID to send to the API (e.g., "whisper-1")
}

// ─── Union type ───
export type AvailableSpeechModel =
  | OfflineWhisperModel
  | AmicalSpeechModel
  | OpenAISpeechModel;

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

export const AVAILABLE_MODELS: AvailableSpeechModel[] = [
  // ─── Amical Cloud ───
  {
    id: "amical-cloud",
    name: "Amical Cloud",
    type: "whisper",
    description: "Fast cloud-based transcription with high accuracy.",
    features: [
      {
        icon: "cloud",
        tooltip: "Cloud-based processing",
      },
      {
        icon: "bolt",
        tooltip: "Fast transcription",
      },
      {
        icon: "languages",
        tooltip: "Multilingual support",
      },
    ],
    speed: 4.5,
    accuracy: 4.5,
    setup: "amical",
    provider: "Amical Cloud",
    providerIcon: "/assets/logo.svg",
  },

  // ─── Offline Whisper models ───
  {
    id: "whisper-tiny",
    name: "Whisper Tiny",
    type: "whisper",
    description: "Very fast, lightweight model ideal for real-time tasks.",
    checksum: "bd577a113a864445d4c299885e0cb97d4ba92b5f",
    filename: "ggml-tiny.bin",
    downloadUrl:
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    size: 77.7 * 1024 * 1024,
    sizeFormatted: "~78 MB",
    modelSize: "~78 MB",
    features: [
      {
        icon: "rabbit",
        tooltip: "Very fast transcription",
      },
      {
        icon: "scale",
        tooltip: "Lightweight, efficient model",
      },
      {
        icon: "languages",
        tooltip: "Multilingual support",
      },
    ],
    speed: 5.0,
    accuracy: 2.5,
    setup: "offline",
    provider: "OpenAI",
    providerIcon: "/icons/models/openai_dark.svg",
  },
  {
    id: "whisper-base",
    name: "Whisper Base",
    type: "whisper",
    description: "Balanced speed and accuracy for everyday use.",
    checksum: "465707469ff3a37a2b9b8d8f89f2f99de7299dac",
    filename: "ggml-base.bin",
    downloadUrl:
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    size: 148 * 1024 * 1024,
    sizeFormatted: "~148 MB",
    modelSize: "~148 MB",
    features: [
      {
        icon: "gauge",
        tooltip: "Good balance of speed & accuracy",
      },
      {
        icon: "scale",
        tooltip: "Efficient model size",
      },
      {
        icon: "languages",
        tooltip: "Multilingual support",
      },
    ],
    speed: 4.0,
    accuracy: 3.0,
    setup: "offline",
    provider: "OpenAI",
    providerIcon: "/icons/models/openai_dark.svg",
  },
  {
    id: "whisper-small",
    name: "Whisper Small",
    type: "whisper",
    description:
      "High accuracy with moderate speed, ideal for quality transcription.",
    checksum: "55356645c2b361a969dfd0ef2c5a50d530afd8d5",
    filename: "ggml-small.bin",
    downloadUrl:
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    size: 488 * 1024 * 1024,
    sizeFormatted: "~488 MB",
    modelSize: "~488 MB",
    features: [
      {
        icon: "crosshair",
        tooltip: "High transcription accuracy",
      },
      {
        icon: "timer",
        tooltip: "Moderate processing speed",
      },
      {
        icon: "languages",
        tooltip: "Multilingual support",
      },
    ],
    speed: 3.0,
    accuracy: 3.8,
    setup: "offline",
    provider: "OpenAI",
    providerIcon: "/icons/models/openai_dark.svg",
  },
  {
    id: "whisper-medium",
    name: "Whisper Medium",
    type: "whisper",
    description: "Very high accuracy for professional, precise transcription.",
    checksum: "fd9727b6e1217c2f614f9b698455c4ffd82463b4",
    filename: "ggml-medium.bin",
    downloadUrl:
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
    size: 1.53 * 1024 * 1024 * 1024,
    sizeFormatted: "~1.5 GB",
    modelSize: "~1.5 GB",
    features: [
      {
        icon: "crosshair",
        tooltip: "Very high transcription accuracy",
      },
      {
        icon: "languages",
        tooltip: "Advanced multilingual support",
      },
      {
        icon: "gauge",
        tooltip: "Stable performance for large jobs",
      },
    ],
    speed: 2.0,
    accuracy: 4.3,
    setup: "offline",
    provider: "OpenAI",
    providerIcon: "/icons/models/openai_dark.svg",
  },
  {
    id: "whisper-large-v3",
    name: "Whisper Large v3",
    type: "whisper",
    description: "Highest accuracy and best robustness for complex audio.",
    checksum: "ad82bf6a9043ceed055076d0fd39f5f186ff8062",
    filename: "ggml-large-v3.bin",
    downloadUrl:
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
    size: 3.1 * 1024 * 1024 * 1024,
    sizeFormatted: "~3.1 GB",
    modelSize: "~3.1 GB",
    features: [
      {
        icon: "award",
        tooltip: "Highest transcription accuracy",
      },
      {
        icon: "languages",
        tooltip: "Superior multilingual & accent support",
      },
      {
        icon: "gauge",
        tooltip: "Robust, reliable processing for intensive needs",
      },
    ],
    speed: 1.5,
    accuracy: 4.7,
    setup: "offline",
    provider: "OpenAI",
    providerIcon: "/icons/models/openai_dark.svg",
  },
  {
    id: "whisper-large-v3-turbo",
    name: "Whisper Large v3 Turbo",
    type: "whisper",
    description: "Optimized for fastest performance with high accuracy.",
    checksum: "4af2b29d7ec73d781377bfd1758ca957a807e941",
    filename: "ggml-large-v3-turbo.bin",
    downloadUrl:
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    size: 1.5 * 1024 * 1024 * 1024,
    sizeFormatted: "~1.5 GB",
    modelSize: "~1.5 GB",
    features: [
      {
        icon: "rocket",
        tooltip: "Optimized turbo speed",
      },
      {
        icon: "award",
        tooltip: "High accuracy across conditions",
      },
      {
        icon: "languages",
        tooltip: "Strong multilingual support",
      },
    ],
    speed: 3.5,
    accuracy: 4.2,
    setup: "offline",
    provider: "OpenAI",
    providerIcon: "/icons/models/openai_dark.svg",
  },

  // ─── OpenAI API models ───
  {
    id: "openai-whisper-1",
    name: "OpenAI Whisper",
    type: "whisper",
    description: "OpenAI cloud-based Whisper model via API.",
    features: [
      {
        icon: "cloud",
        tooltip: "Cloud-based API",
      },
      {
        icon: "bolt",
        tooltip: "Fast transcription",
      },
      {
        icon: "languages",
        tooltip: "Multilingual support",
      },
    ],
    speed: 4.0,
    accuracy: 4.0,
    setup: "api",
    apiModelId: "whisper-1",
    provider: "OpenAI",
    providerIcon: "/icons/models/openai_dark.svg",
  },
  {
    id: "openai-gpt-4o-transcribe",
    name: "OpenAI GPT-4o Transcribe",
    type: "whisper",
    description:
      "GPT-4o powered transcription with superior accuracy and context understanding.",
    features: [
      {
        icon: "cloud",
        tooltip: "Cloud-based API",
      },
      {
        icon: "award",
        tooltip: "Superior accuracy",
      },
      {
        icon: "languages",
        tooltip: "Multilingual support",
      },
    ],
    speed: 3.5,
    accuracy: 4.8,
    setup: "api",
    apiModelId: "gpt-4o-transcribe",
    provider: "OpenAI",
    providerIcon: "/icons/models/openai_dark.svg",
  },
  {
    id: "openai-gpt-4o-mini-transcribe",
    name: "OpenAI GPT-4o Mini Transcribe",
    type: "whisper",
    description:
      "Lightweight GPT-4o transcription model, fast and cost-effective.",
    features: [
      {
        icon: "cloud",
        tooltip: "Cloud-based API",
      },
      {
        icon: "bolt",
        tooltip: "Fast and cost-effective",
      },
      {
        icon: "languages",
        tooltip: "Multilingual support",
      },
    ],
    speed: 4.5,
    accuracy: 4.3,
    setup: "api",
    apiModelId: "gpt-4o-mini-transcribe",
    provider: "OpenAI",
    providerIcon: "/icons/models/openai_dark.svg",
  },

  // ─── Groq API models ───
  {
    id: "groq-whisper-large-v3",
    name: "Groq Whisper Large v3",
    type: "whisper",
    description: "Whisper Large v3 on Groq's ultra-fast inference platform.",
    features: [
      {
        icon: "cloud",
        tooltip: "Cloud-based API",
      },
      {
        icon: "rocket",
        tooltip: "Ultra-fast inference",
      },
      {
        icon: "languages",
        tooltip: "Multilingual support",
      },
    ],
    speed: 5.0,
    accuracy: 4.7,
    setup: "api",
    apiModelId: "whisper-large-v3",
    provider: "Groq",
    providerIcon: "/icons/models/groq_dark.svg",
  },
  {
    id: "groq-whisper-large-v3-turbo",
    name: "Groq Whisper Large v3 Turbo",
    type: "whisper",
    description:
      "Turbo-optimized Whisper on Groq for maximum speed with high accuracy.",
    features: [
      {
        icon: "cloud",
        tooltip: "Cloud-based API",
      },
      {
        icon: "rocket",
        tooltip: "Maximum inference speed",
      },
      {
        icon: "languages",
        tooltip: "Multilingual support",
      },
    ],
    speed: 5.0,
    accuracy: 4.2,
    setup: "api",
    apiModelId: "whisper-large-v3-turbo",
    provider: "Groq",
    providerIcon: "/icons/models/groq_dark.svg",
  },
  {
    id: "groq-distil-whisper-large-v3-en",
    name: "Groq Distil Whisper Large v3 EN",
    type: "whisper",
    description:
      "Distilled English-only Whisper model on Groq, optimized for speed.",
    features: [
      {
        icon: "cloud",
        tooltip: "Cloud-based API",
      },
      {
        icon: "rocket",
        tooltip: "Ultra-fast English transcription",
      },
    ],
    speed: 5.0,
    accuracy: 4.0,
    setup: "api",
    apiModelId: "distil-whisper-large-v3-en",
    provider: "Groq",
    providerIcon: "/icons/models/groq_dark.svg",
  },

  // ─── Grok (xAI) API models ───
  {
    id: "grok-whisper-large-v3",
    name: "Grok Whisper Large v3",
    type: "whisper",
    description: "Whisper Large v3 on xAI's Grok inference platform.",
    features: [
      {
        icon: "cloud",
        tooltip: "Cloud-based API",
      },
      {
        icon: "bolt",
        tooltip: "Fast transcription",
      },
      {
        icon: "languages",
        tooltip: "Multilingual support",
      },
    ],
    speed: 4.5,
    accuracy: 4.7,
    setup: "api",
    apiModelId: "whisper-large-v3",
    provider: "Grok",
    providerIcon: "/icons/models/grok_dark.svg",
  },
  {
    id: "grok-whisper-large-v3-turbo",
    name: "Grok Whisper Large v3 Turbo",
    type: "whisper",
    description:
      "Turbo-optimized Whisper on xAI's Grok for fast transcription.",
    features: [
      {
        icon: "cloud",
        tooltip: "Cloud-based API",
      },
      {
        icon: "rocket",
        tooltip: "Turbo speed",
      },
      {
        icon: "languages",
        tooltip: "Multilingual support",
      },
    ],
    speed: 4.5,
    accuracy: 4.2,
    setup: "api",
    apiModelId: "whisper-large-v3-turbo",
    provider: "Grok",
    providerIcon: "/icons/models/grok_dark.svg",
  },
];
