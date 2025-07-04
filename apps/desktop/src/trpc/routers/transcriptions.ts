import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { dialog } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  getTranscriptions,
  getTranscriptionById,
  createTranscription,
  updateTranscription,
  deleteTranscription,
  getTranscriptionsCount,
  searchTranscriptions,
} from "../../db/transcriptions.js";
import { logger } from "../../main/logger.js";
import { deleteAudioFile } from "../../utils/audio-file-cleanup.js";

const t = initTRPC.create({
  isServer: true,
  transformer: superjson,
});

// Input schemas
const GetTranscriptionsSchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
  sortBy: z.enum(["timestamp", "createdAt"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
});

const CreateTranscriptionSchema = z.object({
  text: z.string(),
  timestamp: z.date().optional(),
  audioFile: z.string().optional(),
  language: z.string().optional(),
});

const UpdateTranscriptionSchema = z.object({
  text: z.string().optional(),
  timestamp: z.date().optional(),
  audioFile: z.string().optional(),
  language: z.string().optional(),
});

export const transcriptionsRouter = t.router({
  // Get transcriptions list with pagination and filtering
  getTranscriptions: t.procedure
    .input(GetTranscriptionsSchema)
    .query(async ({ input }) => {
      return await getTranscriptions(input);
    }),

  // Get transcriptions count
  getTranscriptionsCount: t.procedure
    .input(z.object({ search: z.string().optional() }))
    .query(async ({ input }) => {
      return await getTranscriptionsCount(input.search);
    }),

  // Get transcription by ID
  getTranscriptionById: t.procedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return await getTranscriptionById(input.id);
    }),

  // Search transcriptions
  searchTranscriptions: t.procedure
    .input(
      z.object({
        searchTerm: z.string(),
        limit: z.number().optional(),
      }),
    )
    .query(async ({ input }) => {
      return await searchTranscriptions(input.searchTerm, input.limit);
    }),

  // Create transcription
  createTranscription: t.procedure
    .input(CreateTranscriptionSchema)
    .mutation(async ({ input }) => {
      return await createTranscription(input);
    }),

  // Update transcription
  updateTranscription: t.procedure
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
  deleteTranscription: t.procedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      // Get transcription to check for audio file
      const transcription = await getTranscriptionById(input.id);

      // Delete the transcription
      const result = await deleteTranscription(input.id);

      // Delete associated audio file if it exists
      if (transcription?.audioFile) {
        try {
          await deleteAudioFile(transcription.audioFile);
        } catch (error) {
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

  // Get audio file for download
  getAudioFile: t.procedure
    .input(z.object({ transcriptionId: z.number() }))
    .query(async ({ input }) => {
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

        return {
          data: audioData,
          filename,
          mimeType: "audio/webm",
        };
      } catch (error) {
        logger.main.error("Failed to read audio file", {
          transcriptionId: input.transcriptionId,
          audioFile: transcription.audioFile,
          error,
        });
        throw new Error("Audio file not found or inaccessible");
      }
    }),

  // Download audio file with save dialog
  downloadAudioFile: t.procedure
    .input(z.object({ transcriptionId: z.number() }))
    .mutation(async ({ input }) => {
      console.log("Downloading audio file", input);
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
        logger.main.error("Failed to download audio file", {
          transcriptionId: input.transcriptionId,
          audioFile: transcription.audioFile,
          error,
        });
        throw new Error("Failed to download audio file");
      }
    }),
});
