import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { z } from 'zod';
import { SettingsService } from '../../modules/settings';

const t = initTRPC.create({
  isServer: true,
  transformer: superjson,
});

// FormatterConfig schema
const FormatterConfigSchema = z.object({
  provider: z.literal('openrouter'),
  model: z.string(),
  apiKey: z.string(),
  enabled: z.boolean(),
});

// We'll need to access these from the main process
declare global {
  var aiService: any;
  var logger: any;
}

export const settingsRouter = t.router({
  // Get formatter configuration
  getFormatterConfig: t.procedure.query(async () => {
    try {
      const settingsService = SettingsService.getInstance();
      return await settingsService.getFormatterConfig();
    } catch (error) {
      if (globalThis.logger) {
        globalThis.logger.ai.error('Error getting formatter config:', error);
      }
      return null;
    }
  }),

  // Set formatter configuration
  setFormatterConfig: t.procedure
    .input(FormatterConfigSchema)
    .mutation(async ({ input }) => {
      try {
        const settingsService = SettingsService.getInstance();
        await settingsService.setFormatterConfig(input);

        // Update AI service with new formatter configuration
        if (globalThis.aiService) {
          globalThis.aiService.configureFormatter(input);
          if (globalThis.logger) {
            globalThis.logger.ai.info('Formatter configuration updated');
          }
        }

        return true;
      } catch (error) {
        if (globalThis.logger) {
          globalThis.logger.ai.error('Error setting formatter config:', error);
        }
        throw error;
      }
    }),
}); 