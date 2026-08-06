import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OpenTranscriptionSessionOptions,
  PipelineContext,
} from "../../src/pipeline/core/pipeline-types";

const cloudMocks = vi.hoisted(() => {
  const sessions: Array<{
    sessionId: string;
    transcribe: ReturnType<typeof vi.fn>;
    flush: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    emitTerminalFailure(error: Error): void;
  }> = [];

  const openSession = vi.fn((options: OpenTranscriptionSessionOptions) => {
    const session = {
      name: "amical-cloud",
      sessionId: options.sessionId,
      transcribe: vi.fn(async () => ({ text: "" })),
      flush: vi.fn(async () => ({ text: "" })),
      cancel: vi.fn(),
      updateSessionContext: vi.fn(async () => undefined),
      emitTerminalFailure: (error: Error) => options.onTerminalFailure?.(error),
    };
    sessions.push(session);
    return session;
  });

  return {
    sessions,
    engine: {
      name: "amical-cloud",
      openSession,
      warmup: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    },
  };
});

vi.mock(
  "../../src/pipeline/providers/transcription/amical-cloud-provider",
  () => ({
    AmicalCloudProvider: vi.fn(function () {
      return cloudMocks.engine;
    }),
  }),
);

vi.mock("../../src/db/transcriptions", () => ({
  createTranscription: vi.fn(async () => "transaction-id"),
  getLatestTranscription: vi.fn(async () => null),
  getTranscriptionById: vi.fn(),
  updateTranscription: vi.fn(),
}));

vi.mock("../../src/db/daily-stats", () => ({
  incrementDailyStats: vi.fn(async () => undefined),
}));

import { createTranscription } from "../../src/db/transcriptions";
import { incrementDailyStats } from "../../src/db/daily-stats";
import { createDefaultContext } from "../../src/pipeline/core/context";
import { RecordingManager } from "../../src/main/managers/recording-manager";
import { TranscriptionService } from "../../src/services/transcription-service";
import type { AuthService } from "../../src/services/auth-service";
import type { ModelService } from "../../src/services/model-service";
import type { NativeBridge } from "../../src/services/platform/native-bridge-service";
import type { SettingsService } from "../../src/services/settings-service";
import type { TelemetryService } from "../../src/services/telemetry-service";
import type { VADService } from "../../src/services/vad-service";
import { AppError, ErrorCodes } from "../../src/types/error";

type RecordingManagerInternals = {
  currentSessionId: string | null;
  handleAudioChunk(chunk: Float32Array, isFinalChunk: boolean): Promise<void>;
  writeAudioFile(
    sessionId: string,
    chunks: Float32Array[],
  ): Promise<string | null>;
};

type TranscriptionServiceInternals = {
  buildContext(): Promise<PipelineContext>;
};

describe("RecordingManager terminal transcription flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cloudMocks.sessions.length = 0;
  });

  it("stops capture, persists the failure, retires the provider, and reaches IDLE", async () => {
    const modelService = {
      getSelectedModel: vi.fn(async () => "amical-cloud"),
    };
    const settingsService = {
      getFormatterConfig: vi.fn(async () => ({ enabled: false })),
      getPreferences: vi.fn(async () => ({
        muteSystemAudio: false,
        muteDictationSounds: false,
      })),
    };
    const transcriptionService = TranscriptionService.createForTests(
      modelService as unknown as ModelService,
      null as unknown as VADService,
      settingsService as unknown as SettingsService,
      { trackTranscriptionCompleted: vi.fn() } as unknown as TelemetryService,
      {
        isAuthenticated: vi.fn(),
        getIdToken: vi.fn(),
        refreshTokenIfNeeded: vi.fn(),
      } as unknown as AuthService,
      null,
      null,
    );
    vi.spyOn(
      transcriptionService as unknown as TranscriptionServiceInternals,
      "buildContext",
    ).mockResolvedValue(createDefaultContext("terminal-context"));

    let finalChunkPromise: Promise<void> | null = null;
    const nativeCall =
      vi.fn<(method: string) => Promise<{ success: boolean }>>();
    const nativeBridge = {
      call: nativeCall,
      refreshAccessibilityContext: vi.fn(async () => undefined),
      getAccessibilityContext: vi.fn(() => null),
    };
    const manager = RecordingManager.createForTests({
      settingsService: settingsService as unknown as SettingsService,
      modelService: modelService as unknown as ModelService,
      nativeBridge: nativeBridge as unknown as NativeBridge,
      transcriptionService,
    });
    const internals = manager as unknown as RecordingManagerInternals;
    nativeCall.mockImplementation(async (method) => {
      if (method === "stopRecording") {
        finalChunkPromise = Promise.resolve().then(() =>
          internals.handleAudioChunk(new Float32Array([0.2]), true),
        );
      }
      return { success: true };
    });
    const writeAudioFile = vi
      .spyOn(internals, "writeAudioFile")
      .mockResolvedValue("/tmp/terminal.wav");
    const widgetNotifications: Array<{
      type: string;
      errorCode?: string;
    }> = [];
    manager.on("widget-notification", (notification) => {
      widgetNotifications.push(notification);
    });

    await manager.signalStart();
    expect(manager.getState()).toBe("recording");
    const sessionId = internals.currentSessionId;
    expect(sessionId).not.toBeNull();

    await internals.handleAudioChunk(new Float32Array([0.1]), false);
    const providerSession = cloudMocks.sessions[0];
    expect(providerSession).toBeDefined();

    const terminalFailure = new AppError(
      "Cloud quota exhausted",
      ErrorCodes.QUOTA_EXCEEDED,
    );
    providerSession!.emitTerminalFailure(terminalFailure);

    await vi.waitFor(() => {
      expect(manager.getState()).toBe("idle");
    });
    expect(finalChunkPromise).not.toBeNull();
    await finalChunkPromise;

    expect(nativeCall.mock.calls.map(([method]) => method)).toEqual([
      "startRecording",
      "stopRecording",
    ]);
    expect(nativeCall).toHaveBeenCalledWith("stopRecording", {
      wasMuted: false,
      muteSounds: false,
    });
    expect(createTranscription).toHaveBeenCalledOnce();
    expect(createTranscription).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "",
        audioFile: "/tmp/terminal.wav",
        meta: expect.objectContaining({
          sessionId,
          status: "failed",
          failureReason: ErrorCodes.QUOTA_EXCEEDED,
          errorMessage: "Cloud quota exhausted",
        }),
      }),
    );
    expect(incrementDailyStats).toHaveBeenCalledWith(0);
    expect(writeAudioFile).toHaveBeenCalledWith(sessionId, [
      new Float32Array([0.1]),
      new Float32Array([0.2]),
    ]);
    expect(providerSession!.transcribe).toHaveBeenCalledOnce();
    expect(providerSession!.flush).not.toHaveBeenCalled();
    expect(providerSession!.cancel).toHaveBeenCalledOnce();
    expect(internals.currentSessionId).toBeNull();
    expect(widgetNotifications).toContainEqual({
      type: "transcription_failed",
      errorCode: ErrorCodes.QUOTA_EXCEEDED,
    });

    await manager.cleanup();
  });
});
