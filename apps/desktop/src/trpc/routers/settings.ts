import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { SettingsService } from "../../services/settings-service";

const t = initTRPC.create({
  isServer: true,
  transformer: superjson,
});

// FormatterConfig schema
const FormatterConfigSchema = z.object({
  provider: z.literal("openrouter"),
  model: z.string(),
  apiKey: z.string(),
  enabled: z.boolean(),
});

// We'll need to access these from the main process
declare global {
  var transcriptionService: any;
  var settingsService: any;
  var logger: any;
}

export const settingsRouter = t.router({
  // Get formatter configuration
  getFormatterConfig: t.procedure.query(async () => {
    try {
      if (!globalThis.settingsService) {
        throw new Error("SettingsService not available");
      }
      return await globalThis.settingsService.getFormatterConfig();
    } catch (error) {
      if (globalThis.logger) {
        globalThis.logger.transcription.error(
          "Error getting formatter config:",
          error,
        );
      }
      return null;
    }
  }),

  // Set formatter configuration
  setFormatterConfig: t.procedure
    .input(FormatterConfigSchema)
    .mutation(async ({ input }) => {
      try {
        if (!globalThis.settingsService) {
          throw new Error("SettingsService not available");
        }
        await globalThis.settingsService.setFormatterConfig(input);

        // Update transcription service with new formatter configuration
        if (globalThis.transcriptionService) {
          globalThis.transcriptionService.configureFormatter(input);
          if (globalThis.logger) {
            globalThis.logger.transcription.info(
              "Formatter configuration updated",
            );
          }
        }

        return true;
      } catch (error) {
        if (globalThis.logger) {
          globalThis.logger.transcription.error(
            "Error setting formatter config:",
            error,
          );
        }
        throw error;
      }
    }),
});
