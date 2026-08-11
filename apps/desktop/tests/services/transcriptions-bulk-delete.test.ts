import { describe, expect, it, vi } from "vitest";

const deleteAllTranscriptionsMock = vi.fn();
const deleteAudioFilesForTranscriptionsMock = vi.fn();

vi.mock("../../src/db/transcriptions.ts", () => ({
  getTranscriptions: vi.fn(),
  getTranscriptionById: vi.fn(),
  updateTranscription: vi.fn(),
  deleteTranscription: vi.fn(),
  deleteAllTranscriptions: deleteAllTranscriptionsMock,
  getTranscriptionsCount: vi.fn(),
  searchTranscriptions: vi.fn(),
}));

vi.mock("../../src/db/daily-stats.ts", () => ({
  getLifetimeStats: vi.fn(),
}));

vi.mock("../../src/utils/audio-file-cleanup.ts", () => ({
  deleteAudioFilesForTranscriptions: deleteAudioFilesForTranscriptionsMock,
}));

describe("transcriptionsRouter.deleteAllTranscriptions", () => {
  it("returns the deleted count and cleans up associated audio files", async () => {
    const deletedRows = [
      { id: 1, audioFile: "/tmp/amical-audio/audio-1.wav" },
      { id: 2, audioFile: "/tmp/amical-audio/audio-2.wav" },
    ];

    deleteAllTranscriptionsMock.mockResolvedValueOnce(deletedRows);
    deleteAudioFilesForTranscriptionsMock.mockResolvedValueOnce(2);

    const { transcriptionsRouter } = await import(
      "../../src/trpc/routers/transcriptions"
    );

    const caller = transcriptionsRouter.createCaller({
      logger: {
        main: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
      },
    } as any);

    const result = await caller.deleteAllTranscriptions();

    expect(deleteAllTranscriptionsMock).toHaveBeenCalledTimes(1);
    expect(deleteAudioFilesForTranscriptionsMock).toHaveBeenCalledWith(
      deletedRows,
    );
    expect(result).toEqual({
      deletedCount: 2,
      deletedAudioFiles: 2,
    });
  });
});

const lifecycleSnapshotFor = (state: string) => ({
  sessionId: state === "idle" ? null : "session-1",
  projection: {
    publicState: state,
    stopKind: "none",
    stopOrigin: "none",
    terminal: null,
  },
  metadata: null,
});

describe("transcriptionsRouter.retryTranscription", () => {
  it.each(["starting", "recording", "stopping"] as const)(
    "rejects retry while the recording lifecycle is %s",
    async (state) => {
      const retryTranscription = vi.fn();
      const { transcriptionsRouter } = await import(
        "../../src/trpc/routers/transcriptions"
      );
      const caller = transcriptionsRouter.createCaller({
        services: {
          recordingLifecycle: {
            getSnapshot: vi.fn(() => lifecycleSnapshotFor(state)),
          },
          transcriptionService: { retryTranscription },
        },
      } as never);

      await expect(caller.retryTranscription({ id: 42 })).rejects.toMatchObject(
        {
          code: "CONFLICT",
          message: "Cannot retry while a recording is in progress",
        },
      );
      expect(retryTranscription).not.toHaveBeenCalled();
    },
  );

  it("delegates retry while the recording lifecycle is idle", async () => {
    const retryTranscription = vi.fn().mockResolvedValue("retried text");
    const { transcriptionsRouter } = await import(
      "../../src/trpc/routers/transcriptions"
    );
    const caller = transcriptionsRouter.createCaller({
      services: {
        recordingLifecycle: {
          getSnapshot: vi.fn(() => lifecycleSnapshotFor("idle")),
        },
        transcriptionService: { retryTranscription },
      },
    } as never);

    await expect(caller.retryTranscription({ id: 42 })).resolves.toBe(
      "retried text",
    );
    expect(retryTranscription).toHaveBeenCalledOnce();
    expect(retryTranscription).toHaveBeenCalledWith(42);
  });
});
