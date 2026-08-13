import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OpenTranscriptionSessionOptions,
  TranscribeContext,
  TranscribeParams,
  TranscriptionOutput,
} from "../../src/pipeline/core/pipeline-types";
import { AppError, ErrorCodes } from "../../src/types/error";

const providerMocks = vi.hoisted(() => {
  const makeSession = (
    name: string,
    options: OpenTranscriptionSessionOptions,
  ) => ({
    name,
    sessionId: options.sessionId,
    transcribe: vi.fn<
      (params: TranscribeParams) => Promise<TranscriptionOutput>
    >(async () => ({ text: "" })),
    flush: vi.fn<
      (
        context: TranscribeContext,
        signal?: AbortSignal,
      ) => Promise<TranscriptionOutput>
    >(async () => ({ text: "resolved final" })),
    cancel: vi.fn<() => void>(),
    updateSessionContext: vi.fn<(context: TranscribeContext) => Promise<void>>(
      async () => undefined,
    ),
    emitTerminalFailure: (error: Error) => options.onTerminalFailure?.(error),
  });

  const sessions = new Map<string, ReturnType<typeof makeSession>>();
  const provider = {
    name: "whisper-local",
    sessions,
    openSession: vi.fn((options: OpenTranscriptionSessionOptions) => {
      const session = makeSession("whisper-local", options);
      sessions.set(options.sessionId, session);
      return session;
    }),
    warmup: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
    preloadModel: vi.fn(async () => undefined),
    getBindingInfo: vi.fn(async () => null),
  };
  return { provider };
});

vi.mock("../../src/db/transcriptions", () => ({
  getTranscriptionById: vi.fn(),
  updateTranscription: vi.fn(async () => undefined),
}));

vi.mock("../../src/db/daily-stats", () => ({
  incrementDailyStats: vi.fn(async () => undefined),
}));

vi.mock("../../src/services/transcription/load-dictation-context", () => ({
  loadDictationContext: vi.fn(),
}));

vi.mock(
  "../../src/services/transcription/prepare-transcript-text",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../src/services/transcription/prepare-transcript-text")
    >()),
    prepareTranscriptText: vi.fn(),
  }),
);

vi.mock("../../src/pipeline/providers/transcription/whisper-provider", () => ({
  WhisperProvider: vi.fn(function () {
    return providerMocks.provider;
  }),
}));

vi.mock(
  "../../src/pipeline/providers/transcription/amical-cloud-provider",
  () => ({
    AmicalCloudProvider: vi.fn(function () {
      return providerMocks.provider;
    }),
  }),
);

import { updateTranscription } from "../../src/db/transcriptions";
import type { AuthService } from "../../src/services/auth-service";
import type { ModelService } from "../../src/services/model-service";
import type { SettingsService } from "../../src/services/settings-service";
import type { TelemetryService } from "../../src/services/telemetry-service";
import { TranscriptionService } from "../../src/services/transcription-service";
import { loadDictationContext } from "../../src/services/transcription/load-dictation-context";
import { prepareTranscriptText } from "../../src/services/transcription/prepare-transcript-text";
import type { DictationContext } from "../../src/services/transcription/types";
import type { VADService } from "../../src/services/vad-service";

const dictationContext = (sessionId: string): DictationContext => ({
  sessionId,
  vocabulary: [],
  replacements: new Map(),
  formattingStyle: "formal",
  audio: { source: "microphone" },
  accessibilityContext: null,
  cloudFormattingEnabled: false,
  isInstruct: false,
});

describe("TranscriptionService — lifecycle resolve", () => {
  let service: TranscriptionService;

  beforeEach(() => {
    vi.clearAllMocks();
    providerMocks.provider.sessions.clear();

    service = TranscriptionService.createForTests(
      {
        getSelectedModel: vi.fn(async () => "whisper-tiny"),
      } as unknown as ModelService,
      {
        processAudioFrame: vi.fn(async () => ({
          probability: 1,
          isSpeaking: true,
        })),
        reset: vi.fn(),
      } as unknown as VADService,
      {
        getFormatterConfig: vi.fn(async () => ({ enabled: false })),
      } as unknown as SettingsService,
      new Proxy({}, { get: () => vi.fn() }) as unknown as TelemetryService,
      {
        isAuthenticated: vi.fn(),
        getIdToken: vi.fn(),
        refreshTokenIfNeeded: vi.fn(),
      } as unknown as AuthService,
      null,
      null,
    );
    vi.mocked(loadDictationContext).mockImplementation(async (options) =>
      dictationContext(options.sessionId ?? "resolve-session"),
    );
    vi.mocked(prepareTranscriptText).mockImplementation(
      async ({ text, detectedLanguage }) => ({
        text: text ? `${text} (prepared)` : text,
        language: "en",
        detectedLanguage: detectedLanguage?.trim() || undefined,
        wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
        formattingUsed: false,
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const feed = (sessionId: string) =>
    service.processStreamingChunk({
      sessionId,
      audioChunk: new Float32Array([0.5]),
    });

  it("returns the prepared transcript without persisting anything", async () => {
    service.beginStreamingSession("s1");
    await feed("s1");

    const resolvedSession = await service.resolveStreamingSession({
      sessionId: "s1",
    });

    expect(resolvedSession).toMatchObject({
      text: "resolved final (prepared)",
      language: "en",
      speechModel: "whisper-tiny",
      meta: { source: "microphone", vocabularySize: 0 },
    });
    expect(updateTranscription).not.toHaveBeenCalled();

    // The live session is retired: a second resolve has nothing to work on.
    await expect(
      service.resolveStreamingSession({ sessionId: "s1" }),
    ).resolves.toBeNull();
  });

  it("returns null for never-fed and unknown sessions", async () => {
    service.beginStreamingSession("never-fed");
    await expect(
      service.resolveStreamingSession({ sessionId: "never-fed" }),
    ).resolves.toBeNull();

    await expect(
      service.resolveStreamingSession({ sessionId: "unknown" }),
    ).resolves.toBeNull();
    expect(updateTranscription).not.toHaveBeenCalled();
  });

  it("a terminal failure retires the session; a successor can begin", async () => {
    const failure = new AppError("provider down", ErrorCodes.NETWORK_ERROR);
    const listener = vi.fn();
    service.beginStreamingSession("s1", listener);
    await feed("s1");
    providerMocks.provider.sessions.get("s1")!.emitTerminalFailure(failure);

    // The stream reported terminal and retired itself: the lifecycle heard
    // the failure through the callback, and nothing is left to resolve.
    expect(listener).toHaveBeenCalledWith(failure);
    await expect(
      service.resolveStreamingSession({ sessionId: "s1" }),
    ).resolves.toBeNull();
    expect(updateTranscription).not.toHaveBeenCalled();

    // The slot is free — one dead stream must not poison the next session.
    expect(service.beginStreamingSession("s2")).toBe(true);
  });

  it("an abort during the flush rejects the resolve and persists nothing", async () => {
    service.beginStreamingSession("s1");
    await feed("s1");
    const providerSession = providerMocks.provider.sessions.get("s1")!;
    providerSession.flush.mockImplementation(
      (_context, signal?: AbortSignal) =>
        new Promise((_, reject) => {
          const abort = () =>
            reject(new AppError("aborted", ErrorCodes.NETWORK_ERROR));
          if (signal?.aborted) return abort();
          signal?.addEventListener("abort", abort);
        }),
    );

    const pending = service.resolveStreamingSession({ sessionId: "s1" });
    await vi.waitFor(() => expect(providerSession.flush).toHaveBeenCalled());
    service.abortSession("s1");

    await expect(pending).rejects.toMatchObject({
      errorCode: ErrorCodes.NETWORK_ERROR,
    });
    expect(updateTranscription).not.toHaveBeenCalled();
  });
});
