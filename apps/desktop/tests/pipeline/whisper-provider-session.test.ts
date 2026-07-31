import { beforeEach, describe, expect, it, vi } from "vitest";

const workerMocks = vi.hoisted(() => ({
  construct: vi.fn(),
  initialize: vi.fn<() => Promise<void>>(),
  exec: vi.fn<(method: string, args: unknown[]) => Promise<unknown>>(),
  terminate: vi.fn<() => Promise<void>>(),
}));

const processingMocks = vi.hoisted(() => ({
  extractSpeechFromVad: vi.fn(),
  buildWhisperPrompt: vi.fn(),
}));

vi.mock(
  "../../src/pipeline/providers/transcription/simple-fork-wrapper",
  () => ({
    SimpleForkWrapper: class {
      constructor(workerPath: string, nodeBinaryPath: string) {
        workerMocks.construct(workerPath, nodeBinaryPath);
      }

      initialize() {
        return workerMocks.initialize();
      }

      exec(method: string, args: unknown[]) {
        return workerMocks.exec(method, args);
      }

      terminate() {
        return workerMocks.terminate();
      }
    },
  }),
);

vi.mock("../../src/utils/os-version", () => ({
  isLocalTranscriptionSupported: () => true,
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
  },
}));

vi.mock("../../src/main/logger", () => ({
  logger: {
    transcription: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
  },
}));

vi.mock("../../src/pipeline/utils/vad-audio-filter", () => ({
  extractSpeechFromVad: processingMocks.extractSpeechFromVad,
}));

vi.mock("../../src/pipeline/providers/transcription/whisper-prompt", () => ({
  buildWhisperPrompt: processingMocks.buildWhisperPrompt,
}));

beforeEach(() => {
  processingMocks.extractSpeechFromVad.mockImplementation(
    (audio: Float32Array) => ({
      audio,
      segments: audio.length > 0 ? [{ start: 0, end: audio.length }] : [],
    }),
  );
  processingMocks.buildWhisperPrompt.mockReturnValue("test prompt");
});

import { WhisperProvider } from "../../src/pipeline/providers/transcription/whisper-provider";
import type { ModelService } from "../../src/services/model-service";

describe("WhisperProvider sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workerMocks.initialize.mockResolvedValue(undefined);
    workerMocks.terminate.mockResolvedValue(undefined);
    workerMocks.exec.mockImplementation(async (method, args) => {
      if (method === "transcribeAudio") {
        return {
          text: Array.from(args[0] as Float32Array).join(","),
        };
      }
      return undefined;
    });
  });

  const createProvider = () => {
    let bestAvailableModelPath = "/models/whisper.bin";
    const modelService = {
      getBestAvailableModelPath: vi.fn(async () => bestAvailableModelPath),
      getValidDownloadedModels: vi.fn(async () => ({
        "model-a": { localPath: "/models/a.bin" },
        "model-b": { localPath: "/models/b.bin" },
      })),
    };
    return {
      provider: new WhisperProvider(modelService as unknown as ModelService),
      modelService,
      selectBestAvailableModel(path: string) {
        bestAvailableModelPath = path;
      },
    };
  };

  const modelByDecodedFirstSample = (): Map<number, string> => {
    const modelBySample = new Map<number, string>();
    let activeModel = "";

    for (const [method, args] of workerMocks.exec.mock.calls) {
      if (method === "initializeModel") {
        activeModel = args[0] as string;
      } else if (method === "transcribeAudio") {
        modelBySample.set((args[0] as Float32Array)[0]!, activeModel);
      }
    }

    return modelBySample;
  };

  it("isolates buffered audio and cancellation between sessions", async () => {
    const { provider } = createProvider();
    const first = provider.openSession({
      sessionId: "first",
      modelId: "model-a",
    });
    const second = provider.openSession({
      sessionId: "second",
      modelId: "model-a",
    });

    await first.transcribe({
      audioData: new Float32Array([1, 2]),
      speechProbability: 1,
      context: { sessionId: "first" },
    });
    await second.transcribe({
      audioData: new Float32Array([9]),
      speechProbability: 1,
      context: { sessionId: "second" },
    });

    first.cancel();
    expect(() => first.cancel()).not.toThrow();

    await expect(first.flush({ sessionId: "first" })).resolves.toEqual({
      text: "",
    });
    await expect(second.flush({ sessionId: "second" })).resolves.toEqual({
      text: "9",
    });

    const transcriptionCalls = workerMocks.exec.mock.calls.filter(
      ([method]) => method === "transcribeAudio",
    );
    expect(transcriptionCalls).toHaveLength(1);
    expect(Array.from(transcriptionCalls[0]![1][0] as Float32Array)).toEqual([
      9,
    ]);
  });

  it("reasserts the pinned model immediately before decode", async () => {
    const { provider } = createProvider();
    const session = provider.openSession({
      sessionId: "session",
      modelId: "model-a",
    });

    await session.transcribe({
      audioData: new Float32Array([1]),
      context: { sessionId: "session" },
    });
    await session.transcribe({
      audioData: new Float32Array([2]),
      context: { sessionId: "session" },
    });
    await provider.getBindingInfo();
    await expect(session.flush({ sessionId: "session" })).resolves.toEqual({
      text: "1,2",
    });

    await session.transcribe({
      audioData: new Float32Array([3]),
      context: { sessionId: "session" },
    });
    await provider.getBindingInfo();
    await expect(session.flush({ sessionId: "session" })).resolves.toEqual({
      text: "3",
    });

    const calls = workerMocks.exec.mock.calls;
    const decodeIndexes = calls
      .map(([method], index) => (method === "transcribeAudio" ? index : -1))
      .filter((index) => index >= 0);
    expect(decodeIndexes).toHaveLength(2);
    for (const decodeIndex of decodeIndexes) {
      expect(calls[decodeIndex - 1]).toEqual([
        "initializeModel",
        ["/models/a.bin"],
      ]);
    }
  });

  it("does not initialize the worker after cancellation during model lookup", async () => {
    const { provider, modelService } = createProvider();
    let resolveModels!: (
      models: Awaited<ReturnType<typeof modelService.getValidDownloadedModels>>,
    ) => void;
    modelService.getValidDownloadedModels.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveModels = resolve;
      }),
    );
    const session = provider.openSession({
      sessionId: "cancelled",
      modelId: "model-a",
    });

    const transcribe = session.transcribe({
      audioData: new Float32Array([1]),
      context: { sessionId: "cancelled" },
    });
    await vi.waitFor(() => {
      expect(modelService.getValidDownloadedModels).toHaveBeenCalledOnce();
    });

    session.cancel();
    resolveModels({
      "model-a": { localPath: "/models/a.bin" },
      "model-b": { localPath: "/models/b.bin" },
    });

    await expect(transcribe).resolves.toEqual({ text: "" });
    expect(workerMocks.construct).not.toHaveBeenCalled();
    expect(workerMocks.initialize).not.toHaveBeenCalled();
  });

  it("suppresses a model lookup failure after the session is cancelled", async () => {
    const { provider, modelService } = createProvider();
    let rejectModels!: (error: Error) => void;
    modelService.getValidDownloadedModels.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectModels = reject;
      }),
    );
    const session = provider.openSession({
      sessionId: "cancelled",
      modelId: "model-a",
    });

    const transcribe = session.transcribe({
      audioData: new Float32Array([1]),
      context: { sessionId: "cancelled" },
    });
    session.cancel();
    rejectModels(new Error("lookup failed"));

    await expect(transcribe).resolves.toEqual({ text: "" });
    expect(workerMocks.construct).not.toHaveBeenCalled();
  });

  it("rejects an unavailable pinned model before starting a worker", async () => {
    const { provider } = createProvider();
    const session = provider.openSession({
      sessionId: "missing-model",
      modelId: "missing",
    });

    await expect(
      session.transcribe({
        audioData: new Float32Array([1]),
        context: { sessionId: "missing-model" },
      }),
    ).rejects.toThrow("Selected Whisper model is unavailable: missing");
    expect(workerMocks.construct).not.toHaveBeenCalled();
  });

  it("does not decode when flush is aborted before decode starts", async () => {
    const { provider } = createProvider();
    const session = provider.openSession({
      sessionId: "aborted",
      modelId: "model-a",
    });
    await session.transcribe({
      audioData: new Float32Array([1]),
      context: { sessionId: "aborted" },
    });

    const abortController = new AbortController();
    const flush = session.flush(
      { sessionId: "aborted" },
      abortController.signal,
    );
    abortController.abort();

    await expect(flush).resolves.toEqual({ text: "" });
    expect(
      workerMocks.exec.mock.calls.filter(
        ([method]) => method === "transcribeAudio",
      ),
    ).toHaveLength(0);
  });

  it("shares one worker across concurrent same-model sessions", async () => {
    const { provider, selectBestAvailableModel } = createProvider();
    selectBestAvailableModel("/models/a.bin");
    const first = provider.openSession({
      sessionId: "first",
      modelId: "model-a",
    });
    const second = provider.openSession({
      sessionId: "second",
      modelId: "model-a",
    });

    let releaseWorker!: () => void;
    const workerGate = new Promise<void>((resolve) => {
      releaseWorker = resolve;
    });
    workerMocks.initialize.mockReturnValueOnce(workerGate);

    const warmup = provider.warmup();
    const firstChunk = first.transcribe({
      audioData: new Float32Array([1]),
      context: { sessionId: "first" },
    });
    const secondChunk = second.transcribe({
      audioData: new Float32Array([2]),
      context: { sessionId: "second" },
    });

    await vi.waitFor(() => {
      expect(workerMocks.initialize).toHaveBeenCalledOnce();
    });
    releaseWorker();
    await Promise.all([warmup, firstChunk, secondChunk]);

    expect(workerMocks.construct).toHaveBeenCalledOnce();
    const initializedPaths = workerMocks.exec.mock.calls
      .filter(([method]) => method === "initializeModel")
      .map(([, args]) => args[0]);
    expect(initializedPaths.length).toBeGreaterThan(0);
    expect(new Set(initializedPaths)).toEqual(new Set(["/models/a.bin"]));
  });

  it("retires a worker after model initialization fails", async () => {
    const { provider } = createProvider();
    const first = provider.openSession({
      sessionId: "first",
      modelId: "model-a",
    });
    const second = provider.openSession({
      sessionId: "second",
      modelId: "model-b",
    });

    await first.transcribe({
      audioData: new Float32Array([1]),
      context: { sessionId: "first" },
    });

    let failedModelB = false;
    workerMocks.exec.mockImplementation(async (method, args) => {
      if (
        method === "initializeModel" &&
        args[0] === "/models/b.bin" &&
        !failedModelB
      ) {
        failedModelB = true;
        throw new Error("model B failed to load");
      }
      if (method === "transcribeAudio") {
        return {
          text: Array.from(args[0] as Float32Array).join(","),
        };
      }
      return undefined;
    });

    await expect(
      second.transcribe({
        audioData: new Float32Array([2]),
        context: { sessionId: "second" },
      }),
    ).rejects.toThrow("model B failed to load");
    expect(workerMocks.terminate).toHaveBeenCalledOnce();
    expect(workerMocks.construct).toHaveBeenCalledOnce();

    await expect(first.flush({ sessionId: "first" })).resolves.toEqual({
      text: "1",
    });
    expect(workerMocks.construct).toHaveBeenCalledTimes(2);
    expect(workerMocks.initialize).toHaveBeenCalledTimes(2);
    expect(workerMocks.terminate).toHaveBeenCalledOnce();
    expect(
      workerMocks.exec.mock.calls
        .filter(([method]) => method === "initializeModel")
        .map(([, args]) => args[0]),
    ).toEqual(["/models/a.bin", "/models/b.bin", "/models/a.bin"]);
  });

  it("pins each session to its selected model while reusing the worker", async () => {
    const { provider, selectBestAvailableModel } = createProvider();
    const first = provider.openSession({
      sessionId: "first",
      modelId: "model-a",
    });
    selectBestAvailableModel("/models/b.bin");
    const second = provider.openSession({
      sessionId: "second",
      modelId: "model-b",
    });

    await first.transcribe({
      audioData: new Float32Array([1]),
      context: { sessionId: "first" },
    });
    await second.transcribe({
      audioData: new Float32Array([2]),
      context: { sessionId: "second" },
    });
    await first.flush({ sessionId: "first" });
    await second.flush({ sessionId: "second" });

    expect(modelByDecodedFirstSample()).toEqual(
      new Map([
        [1, "/models/a.bin"],
        [2, "/models/b.bin"],
      ]),
    );
    expect(workerMocks.construct).toHaveBeenCalledOnce();
  });

  it("suppresses a decode failure after the session is cancelled", async () => {
    const { provider } = createProvider();
    const session = provider.openSession({
      sessionId: "cancelled",
      modelId: "model-a",
    });
    await session.transcribe({
      audioData: new Float32Array([1]),
      context: { sessionId: "cancelled" },
    });

    let rejectDecode!: (error: Error) => void;
    workerMocks.exec.mockImplementation(async (method) => {
      if (method === "transcribeAudio") {
        return new Promise((_, reject) => {
          rejectDecode = reject;
        });
      }
      return undefined;
    });

    const flush = session.flush({ sessionId: "cancelled" });
    await vi.waitFor(() => {
      expect(rejectDecode).toBeTypeOf("function");
    });
    session.cancel();
    rejectDecode(new Error("decode failed"));

    await expect(flush).resolves.toEqual({ text: "" });
    await expect(session.flush({ sessionId: "cancelled" })).resolves.toEqual({
      text: "",
    });
    expect(
      workerMocks.exec.mock.calls.filter(
        ([method]) => method === "transcribeAudio",
      ),
    ).toHaveLength(1);
  });

  it("suppresses a successful decode result after cancellation", async () => {
    const { provider } = createProvider();
    const session = provider.openSession({
      sessionId: "cancelled",
      modelId: "model-a",
    });
    await session.transcribe({
      audioData: new Float32Array([1]),
      context: { sessionId: "cancelled" },
    });

    let resolveDecode!: (result: { text: string }) => void;
    workerMocks.exec.mockImplementation(async (method) => {
      if (method === "transcribeAudio") {
        return new Promise((resolve) => {
          resolveDecode = resolve;
        });
      }
      return undefined;
    });

    const flush = session.flush({ sessionId: "cancelled" });
    await vi.waitFor(() => {
      expect(resolveDecode).toBeTypeOf("function");
    });
    session.cancel();
    resolveDecode({ text: "late result" });

    await expect(flush).resolves.toEqual({ text: "" });
  });

  it("serializes model preload and binding inspection behind decode", async () => {
    const { provider, selectBestAvailableModel } = createProvider();
    const session = provider.openSession({
      sessionId: "session",
      modelId: "model-a",
    });
    await session.transcribe({
      audioData: new Float32Array([1]),
      context: { sessionId: "session" },
    });

    let releaseDecode!: () => void;
    const decodeGate = new Promise<void>((resolve) => {
      releaseDecode = resolve;
    });
    workerMocks.exec.mockImplementation(async (method, args) => {
      if (method === "transcribeAudio") {
        await decodeGate;
        return { text: Array.from(args[0] as Float32Array).join(",") };
      }
      if (method === "getBindingInfo") {
        return { path: "/binding", type: "mock" };
      }
      return undefined;
    });

    const flush = session.flush({ sessionId: "session" });
    await vi.waitFor(() => {
      expect(
        workerMocks.exec.mock.calls.filter(
          ([method]) => method === "transcribeAudio",
        ),
      ).toHaveLength(1);
    });

    selectBestAvailableModel("/models/b.bin");
    const preload = provider.preloadModel();
    const bindingInfo = provider.getBindingInfo();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(workerMocks.exec).not.toHaveBeenCalledWith("initializeModel", [
      "/models/b.bin",
    ]);
    expect(workerMocks.exec).not.toHaveBeenCalledWith("getBindingInfo", []);

    releaseDecode();
    await expect(flush).resolves.toEqual({ text: "1" });
    await expect(preload).resolves.toBeUndefined();
    await expect(bindingInfo).resolves.toEqual({
      path: "/binding",
      type: "mock",
    });
    expect(workerMocks.exec).toHaveBeenCalledWith("initializeModel", [
      "/models/b.bin",
    ]);
  });

  it("makes disposal serialized, idempotent, and terminal", async () => {
    const { provider } = createProvider();
    const session = provider.openSession({
      sessionId: "session",
      modelId: "model-a",
    });
    await session.transcribe({
      audioData: new Float32Array([1]),
      context: { sessionId: "session" },
    });

    let releaseDecode!: () => void;
    const decodeGate = new Promise<void>((resolve) => {
      releaseDecode = resolve;
    });
    workerMocks.exec.mockImplementation(async (method, args) => {
      if (method === "transcribeAudio") {
        await decodeGate;
        return { text: Array.from(args[0] as Float32Array).join(",") };
      }
      if (method === "dispose") {
        throw new Error("worker-side dispose failed");
      }
      return undefined;
    });

    const flush = session.flush({ sessionId: "session" });
    await vi.waitFor(() => {
      expect(
        workerMocks.exec.mock.calls.filter(
          ([method]) => method === "transcribeAudio",
        ),
      ).toHaveLength(1);
    });

    const firstDisposal = provider.dispose();
    const secondDisposal = provider.dispose();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(workerMocks.exec).not.toHaveBeenCalledWith("dispose", []);
    expect(workerMocks.terminate).not.toHaveBeenCalled();

    expect(() =>
      provider.openSession({
        sessionId: "after-dispose",
        modelId: "model-a",
      }),
    ).toThrow("Whisper provider has been disposed");
    await expect(provider.warmup()).rejects.toThrow(
      "Whisper provider has been disposed",
    );
    await expect(provider.getBindingInfo()).resolves.toBeNull();

    releaseDecode();
    await expect(flush).resolves.toEqual({ text: "1" });
    await expect(Promise.all([firstDisposal, secondDisposal])).resolves.toEqual(
      [undefined, undefined],
    );
    await expect(provider.dispose()).resolves.toBeUndefined();
    await expect(
      session.transcribe({
        audioData: new Float32Array([2]),
        context: { sessionId: "session" },
      }),
    ).rejects.toThrow("Whisper provider has been disposed");
    expect(workerMocks.exec).toHaveBeenCalledWith("dispose", []);
    expect(workerMocks.terminate).toHaveBeenCalledOnce();
    expect(workerMocks.construct).toHaveBeenCalledOnce();
  });

  it("preserves normal legacy sessions until final flush", async () => {
    const { provider } = createProvider();

    await provider.transcribe({
      audioData: new Float32Array([1]),
      context: { sessionId: "first" },
    });
    await expect(provider.flush({ sessionId: "first" })).resolves.toEqual({
      text: "1",
    });

    await provider.transcribe({
      audioData: new Float32Array([9]),
      context: { sessionId: "second" },
    });

    await expect(provider.flush({ sessionId: "second" })).resolves.toEqual({
      text: "9",
    });
  });

  it("retires an unflushed legacy session when its ID changes", async () => {
    const { provider } = createProvider();

    await provider.transcribe({
      audioData: new Float32Array([1]),
      context: { sessionId: "first" },
    });
    await provider.transcribe({
      audioData: new Float32Array([9]),
      context: { sessionId: "second" },
    });

    await expect(provider.flush({ sessionId: "second" })).resolves.toEqual({
      text: "9",
    });
  });

  it("clears a cancelled legacy session before the next one", async () => {
    const { provider } = createProvider();

    await provider.transcribe({
      audioData: new Float32Array([1]),
      context: { sessionId: "cancelled" },
    });
    provider.reset();

    await expect(provider.flush({ sessionId: "cancelled" })).resolves.toEqual({
      text: "",
    });

    await provider.transcribe({
      audioData: new Float32Array([9]),
      context: { sessionId: "next" },
    });
    await expect(provider.flush({ sessionId: "next" })).resolves.toEqual({
      text: "9",
    });
  });

  it("keeps the legacy session on its selected model until retirement", async () => {
    const { provider, selectBestAvailableModel } = createProvider();
    selectBestAvailableModel("/models/a.bin");

    await provider.transcribe({
      audioData: new Float32Array([1]),
      context: { sessionId: "first" },
    });
    selectBestAvailableModel("/models/b.bin");
    await provider.flush({ sessionId: "first" });

    provider.reset();
    await provider.transcribe({
      audioData: new Float32Array([2]),
      context: { sessionId: "second" },
    });
    await provider.flush({ sessionId: "second" });

    expect(modelByDecodedFirstSample()).toEqual(
      new Map([
        [1, "/models/a.bin"],
        [2, "/models/b.bin"],
      ]),
    );
  });

  it("legacy reset does not cancel explicitly opened sessions", async () => {
    const { provider } = createProvider();
    const explicit = provider.openSession({
      sessionId: "explicit",
      modelId: "model-a",
    });
    await explicit.transcribe({
      audioData: new Float32Array([9]),
      context: { sessionId: "explicit" },
    });
    await provider.transcribe({
      audioData: new Float32Array([1]),
      context: { sessionId: "legacy" },
    });

    provider.reset();

    await expect(explicit.flush({ sessionId: "explicit" })).resolves.toEqual({
      text: "9",
    });
  });

  it.each([
    {
      reason: "after more than three seconds of silence",
      probabilities: [1, ...new Array<number>(94).fill(0)],
    },
    {
      reason: "at the 30-second buffer cap",
      probabilities: new Array<number>(938).fill(1),
    },
  ])("automatically transcribes $reason", async ({ probabilities }) => {
    const { provider } = createProvider();
    const sessionId = `automatic-${probabilities.length}`;
    const session = provider.openSession({
      sessionId,
      modelId: "model-a",
    });
    const nonEmptyResultIndexes: number[] = [];

    for (const [index, speechProbability] of probabilities.entries()) {
      const result = await session.transcribe({
        audioData: new Float32Array([index + 1]),
        speechProbability,
        context: { sessionId },
      });
      if (result.text) {
        nonEmptyResultIndexes.push(index);
      }
    }

    expect(nonEmptyResultIndexes).toEqual([probabilities.length - 1]);
    const transcriptionCalls = workerMocks.exec.mock.calls.filter(
      ([method]) => method === "transcribeAudio",
    );
    expect(transcriptionCalls).toHaveLength(1);
    expect(transcriptionCalls[0]![1][0]).toHaveLength(probabilities.length);
  });

  it("preserves VAD filtering and Whisper prompt/decode options", async () => {
    const { provider } = createProvider();
    const session = provider.openSession({
      sessionId: "session",
      modelId: "model-a",
    });

    await session.transcribe({
      audioData: new Float32Array([0.5]),
      speechProbability: 0.8,
      context: { sessionId: "session" },
    });
    await session.transcribe({
      audioData: new Float32Array([0.25]),
      speechProbability: 0.6,
      context: { sessionId: "session" },
    });
    await session.flush({
      sessionId: "session",
      vocabulary: ["Amical"],
      aggregatedTranscription: "prior words",
      languages: ["en", "hi"],
    });

    expect(processingMocks.extractSpeechFromVad).toHaveBeenCalledOnce();
    const [rawAudio, vadProbabilities] =
      processingMocks.extractSpeechFromVad.mock.calls[0]!;
    expect(Array.from(rawAudio as Float32Array)).toEqual([0.5, 0.25]);
    expect(vadProbabilities).toEqual([0.8, 0.6]);
    expect(processingMocks.buildWhisperPrompt).toHaveBeenCalledWith({
      vocabulary: ["Amical"],
      previousTranscription: "prior words",
      beforeText: undefined,
    });
    expect(workerMocks.exec).toHaveBeenCalledWith("transcribeAudio", [
      expect.any(Float32Array),
      {
        languages: ["en", "hi"],
        initial_prompt: "test prompt",
        suppress_blank: true,
        suppress_non_speech_tokens: true,
        no_timestamps: false,
        format: "detail",
      },
    ]);
  });
});
