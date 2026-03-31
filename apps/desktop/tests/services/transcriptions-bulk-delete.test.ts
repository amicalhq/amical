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
      serviceManager: {
        getLogger: () => ({
          main: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
          },
        }),
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
