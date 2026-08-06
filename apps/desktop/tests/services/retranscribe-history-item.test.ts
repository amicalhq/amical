import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OpenTranscriptionSessionOptions,
  TranscribeContext,
  TranscribeParams,
  TranscriptionEngine,
  TranscriptionOutput,
  TranscriptionProviderSession,
} from "../../src/pipeline/core/pipeline-types";

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

import * as fs from "node:fs";
import { incrementDailyStats } from "../../src/db/daily-stats";
import {
  getTranscriptionById,
  updateTranscription,
} from "../../src/db/transcriptions";
import { loadDictationContext } from "../../src/services/transcription/load-dictation-context";
import { prepareTranscriptText } from "../../src/services/transcription/prepare-transcript-text";
import {
  retranscribeHistoryItem,
  type RetranscribeHistoryItemDependencies,
} from "../../src/services/transcription/retranscribe-history-item";

const historyRecord = () =>
  ({
    id: 7,
    audioFile: "/tmp/history.wav",
    text: "",
    detectedLanguage: null,
    language: null,
    meta: { preserved: true },
  }) as unknown as Awaited<ReturnType<typeof getTranscriptionById>>;

function wavWithSamples(sampleCount: number): Buffer {
  const wav = Buffer.alloc(44 + sampleCount * 2);
  for (let index = 0; index < sampleCount; index++) {
    wav.writeInt16LE(1000 + index, 44 + index * 2);
  }
  return wav;
}

function makeEngine(name = "whisper-local") {
  const session = {
    name,
    sessionId: "history-session",
    transcribe: vi.fn<
      (params: TranscribeParams) => Promise<TranscriptionOutput>
    >(async () => ({ text: "" })),
    flush: vi.fn<(context: TranscribeContext) => Promise<TranscriptionOutput>>(
      async () => ({ text: "" }),
    ),
    cancel: vi.fn(),
  } satisfies TranscriptionProviderSession;
  const engine = {
    name,
    openSession: vi.fn((options: OpenTranscriptionSessionOptions) => {
      session.sessionId = options.sessionId;
      return session;
    }),
    dispose: vi.fn(async () => undefined),
  } satisfies TranscriptionEngine;
  return { engine, session };
}

function makeDependencies(
  engine: TranscriptionEngine,
): RetranscribeHistoryItemDependencies {
  return {
    settingsService: {
      getFormatterConfig: vi.fn(async () => ({ enabled: false })),
    } as unknown as RetranscribeHistoryItemDependencies["settingsService"],
    modelService: {
      getSelectedModel: vi.fn(async () => "whisper-tiny"),
    } as unknown as RetranscribeHistoryItemDependencies["modelService"],
    telemetryService: {
      trackTranscriptionCompleted: vi.fn(),
    } as unknown as RetranscribeHistoryItemDependencies["telemetryService"],
    processVadFrames: vi.fn(async (frames: Float32Array[]) =>
      frames.map((_, index) => index / 10),
    ),
    engineForSelectedModel: vi.fn(() => engine),
    withTranscriptionLock: vi.fn(async (work) => work()),
    wasModelPreloaded: () => true,
    isVadEnabled: () => true,
  };
}

describe("retranscribeHistoryItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTranscriptionById).mockResolvedValue(historyRecord());
    vi.mocked(loadDictationContext).mockResolvedValue({
      sessionId: "history-session",
      vocabulary: ["Amical"],
      replacements: new Map(),
      languages: ["en"],
      formattingStyle: "formal",
      audio: { source: "microphone" },
      accessibilityContext: null,
      cloudFormattingEnabled: false,
      isInstruct: false,
    });
    vi.mocked(prepareTranscriptText).mockImplementation(
      async ({ text, detectedLanguage }) => ({
        text,
        language: "en",
        detectedLanguage: detectedLanguage?.trim() || undefined,
        wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
        formattingUsed: false,
      }),
    );
    vi.spyOn(fs.promises, "access").mockResolvedValue(undefined);
  });

  it("feeds ordered 512-sample frames and persists the completed retry", async () => {
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(
      wavWithSamples(1025) as never,
    );
    const { engine, session } = makeEngine();
    session.transcribe
      .mockResolvedValueOnce({ text: "one" })
      .mockResolvedValueOnce({ text: " two" })
      .mockResolvedValueOnce({ text: " three", detectedLanguage: " en " });
    session.flush.mockResolvedValueOnce({ text: " final" });
    const dependencies = makeDependencies(engine);

    await expect(retranscribeHistoryItem(7, dependencies)).resolves.toBe(
      "one two three final",
    );

    const frames = vi.mocked(dependencies.processVadFrames).mock.calls[0]![0];
    expect(frames.map((frame) => frame.length)).toEqual([512, 512, 1]);
    expect(session.transcribe).toHaveBeenCalledTimes(3);
    expect(
      session.transcribe.mock.calls.map(([input]) => input.audioData),
    ).toEqual(frames);
    expect(
      session.transcribe.mock.calls.map(([input]) => input.speechProbability),
    ).toEqual([0, 0.1, 0.2]);
    expect(session.flush).toHaveBeenCalledOnce();
    expect(session.cancel).toHaveBeenCalledOnce();
    expect(dependencies.withTranscriptionLock).toHaveBeenCalledOnce();
    expect(prepareTranscriptText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "one two three final",
        detectedLanguage: "en",
      }),
      expect.anything(),
    );
    expect(updateTranscription).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        text: "one two three final",
        detectedLanguage: "en",
        speechModel: "whisper-tiny",
        meta: expect.objectContaining({
          preserved: true,
          retried: true,
          retriedAt: expect.any(String),
        }),
      }),
    );
    expect(incrementDailyStats).toHaveBeenCalledWith(4, expect.any(Date), 0);
    expect(
      dependencies.telemetryService.trackTranscriptionCompleted,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: "history-session",
        word_count: 4,
        is_retry: true,
      }),
    );
  });

  it("cancels the provider session when transcription fails", async () => {
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(
      wavWithSamples(1) as never,
    );
    const { engine, session } = makeEngine();
    const failure = new Error("decode failed");
    session.transcribe.mockRejectedValueOnce(failure);
    const dependencies = makeDependencies(engine);

    await expect(retranscribeHistoryItem(7, dependencies)).rejects.toBe(
      failure,
    );

    expect(session.cancel).toHaveBeenCalledOnce();
    expect(session.flush).not.toHaveBeenCalled();
    expect(updateTranscription).not.toHaveBeenCalled();
    expect(prepareTranscriptText).not.toHaveBeenCalled();
  });

  it("keeps only the cumulative cloud result", async () => {
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(
      wavWithSamples(513) as never,
    );
    const { engine, session } = makeEngine("amical-cloud");
    session.transcribe
      .mockResolvedValueOnce({ text: "first" })
      .mockResolvedValueOnce({ text: "first second" });
    session.flush.mockResolvedValueOnce({ text: "first second final" });
    const dependencies = makeDependencies(engine);

    await retranscribeHistoryItem(7, dependencies);

    expect(prepareTranscriptText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "first second final",
        usedCloudProvider: true,
      }),
      expect.anything(),
    );
    expect(updateTranscription).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ speechModel: "amical-cloud" }),
    );
  });

  it("does not count an already-counted transcription again", async () => {
    vi.mocked(getTranscriptionById).mockResolvedValue({
      ...historyRecord()!,
      text: "already counted",
    });
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(
      wavWithSamples(1) as never,
    );
    const { engine, session } = makeEngine();
    session.transcribe.mockResolvedValueOnce({ text: "replacement" });
    const dependencies = makeDependencies(engine);

    await retranscribeHistoryItem(7, dependencies);

    expect(updateTranscription).toHaveBeenCalledOnce();
    expect(incrementDailyStats).not.toHaveBeenCalled();
  });
});
