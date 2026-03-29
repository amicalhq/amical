import { z } from "zod";
import { dialog } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRouter, procedure } from "../trpc";
import {
  getTranscriptions,
  getTranscriptionById,
  updateTranscription,
  deleteTranscription,
  getTranscriptionsCount,
  searchTranscriptions,
} from "../../db/transcriptions.js";
import { getLifetimeStats } from "../../db/daily-stats.js";
import { deleteAudioFile } from "../../utils/audio-file-cleanup.js";

// Input schemas
const GetTranscriptionsSchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
  sortBy: z.enum(["timestamp", "createdAt"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
});

const UpdateTranscriptionSchema = z.object({
  text: z.string().optional(),
  timestamp: z.date().optional(),
  audioFile: z.string().optional(),
  language: z.string().optional(),
});

const ReportTranscriptionSchema = z.object({
  transcriptionId: z.number(),
  feedbackText: z.string().min(1).max(2000),
});

export const transcriptionsRouter = createRouter({
  getLifetimeStats: procedure.query(async () => {
    return await getLifetimeStats();
  }),

  // Get transcriptions list with pagination and filtering
  getTranscriptions: procedure
    .input(GetTranscriptionsSchema)
    .query(async ({ input }) => {
      return await getTranscriptions(input);
    }),

  // Get transcriptions count
  getTranscriptionsCount: procedure
    .input(z.object({ search: z.string().optional() }))
    .query(async ({ input }) => {
      return await getTranscriptionsCount(input.search);
    }),

  // Get transcription by ID
  getTranscriptionById: procedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return await getTranscriptionById(input.id);
    }),

  // Search transcriptions
  searchTranscriptions: procedure
    .input(
      z.object({
        searchTerm: z.string(),
        limit: z.number().optional(),
      }),
    )
    .query(async ({ input }) => {
      return await searchTranscriptions(input.searchTerm, input.limit);
    }),

  // Update transcription
  updateTranscription: procedure
    .input(
      z.object({
        id: z.number(),
        data: UpdateTranscriptionSchema,
      }),
    )
    .mutation(async ({ input }) => {
      return await updateTranscription(input.id, input.data);
    }),

  // Delete transcription
  deleteTranscription: procedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // Get transcription to check for audio file
      const transcription = await getTranscriptionById(input.id);

      // Delete the transcription
      const result = await deleteTranscription(input.id);

      // Delete associated audio file if it exists
      if (transcription?.audioFile) {
        try {
          await deleteAudioFile(transcription.audioFile);
        } catch (error) {
          const logger = ctx.serviceManager.getLogger();
          logger.main.warn(
            "Failed to delete audio file during transcription deletion",
            {
              transcriptionId: input.id,
              audioFile: transcription.audioFile,
              error,
            },
          );
        }
      }

      return result;
    }),

  // Get audio file for playback
  // Implemented as mutation instead of query because:
  // 1. Large binary data (audio files) shouldn't be cached by React Query
  // 2. Prevents automatic refetching on window focus/network reconnect
  // 3. Represents an explicit user action (clicking play), not passive data fetching
  // 4. Avoids memory overhead from React Query's caching system
  getAudioFile: procedure
    .input(z.object({ transcriptionId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const transcription = await getTranscriptionById(input.transcriptionId);

      if (!transcription?.audioFile) {
        throw new Error("No audio file associated with this transcription");
      }

      try {
        // Check if file exists
        await fs.promises.access(transcription.audioFile);

        // Read the file
        const audioData = await fs.promises.readFile(transcription.audioFile);
        const filename = path.basename(transcription.audioFile);

        // Detect MIME type based on file extension
        const ext = path.extname(transcription.audioFile).toLowerCase();
        let mimeType = "audio/wav"; // Default for our WAV files

        // Map common audio extensions to MIME types
        const mimeTypes: Record<string, string> = {
          ".wav": "audio/wav",
          ".mp3": "audio/mpeg",
          ".webm": "audio/webm",
          ".ogg": "audio/ogg",
          ".m4a": "audio/mp4",
          ".flac": "audio/flac",
        };

        if (ext in mimeTypes) {
          mimeType = mimeTypes[ext];
        }

        return {
          data: audioData.toString("base64"),
          filename,
          mimeType,
        };
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        logger.main.error("Failed to read audio file", {
          transcriptionId: input.transcriptionId,
          audioFile: transcription.audioFile,
          error,
        });
        throw new Error("Audio file not found or inaccessible");
      }
    }),

  // Retry transcription using current model and settings
  retryTranscription: procedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const transcriptionService = ctx.serviceManager.getService(
        "transcriptionService",
      );
      return await transcriptionService.retryTranscription(input.id);
    }),

  // Report a transcription issue (telemetry only)
  reportTranscription: procedure
    .input(ReportTranscriptionSchema)
    .mutation(async ({ input, ctx }) => {
      const logger = ctx.serviceManager.getLogger();
      const telemetryService =
        ctx.serviceManager.getService("telemetryService");
      const transcription = await getTranscriptionById(input.transcriptionId);

      if (!transcription) {
        throw new Error("Transcription not found");
      }

      logger.main.info("Transcription report captured via telemetry", {
        transcriptionId: input.transcriptionId,
      });

      const speechModelForTelemetry =
        transcription.speechModel?.trim() || undefined;

      telemetryService.trackTranscriptionReported({
        transcription_id: transcription.id,
        feedback_text: input.feedbackText,
        feedback_length: input.feedbackText.length,
        ...(speechModelForTelemetry
          ? { speech_model: speechModelForTelemetry }
          : {}),
        formatting_model: transcription.formattingModel || undefined,
        language: transcription.language || undefined,
        report_channel: "history",
      });

      return { success: true };
    }),

  // Download audio file with save dialog
  // Mutation because this triggers a system dialog and file write operation
  // Not a query since it has side effects beyond just fetching data
  downloadAudioFile: procedure
    .input(z.object({ transcriptionId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const transcription = await getTranscriptionById(input.transcriptionId);

      if (!transcription?.audioFile) {
        throw new Error("No audio file associated with this transcription");
      }

      try {
        // Read the audio file (already in WAV format)
        const audioData = await fs.promises.readFile(transcription.audioFile);
        const filename = path.basename(transcription.audioFile);

        // Show save dialog
        const result = await dialog.showSaveDialog({
          defaultPath: filename,
          filters: [
            { name: "WAV Audio", extensions: ["wav"] },
            { name: "All Files", extensions: ["*"] },
          ],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, canceled: true };
        }

        // Write file to chosen location
        await fs.promises.writeFile(result.filePath, audioData);

        const logger = ctx.serviceManager.getLogger();
        logger.main.info("Audio file downloaded", {
          transcriptionId: input.transcriptionId,
          savedTo: result.filePath,
          size: audioData.length,
        });

        return {
          success: true,
          filePath: result.filePath,
        };
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        logger.main.error("Failed to download audio file", {
          transcriptionId: input.transcriptionId,
          audioFile: transcription.audioFile,
          error,
        });
        throw new Error("Failed to download audio file");
      }
    }),
});
