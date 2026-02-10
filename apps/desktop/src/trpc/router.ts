import { z } from "zod";
import { vocabularyRouter } from "./routers/vocabulary";
import { transcriptionsRouter } from "./routers/transcriptions";
import { modelsRouter } from "./routers/models";
import { settingsRouter } from "./routers/settings";
import { updaterRouter } from "./routers/updater";
import { recordingRouter } from "./routers/recording";
import { widgetRouter } from "./routers/widget";
import { authRouter } from "./routers/auth";
import { onboardingRouter } from "./routers/onboarding";
import { createRouter, procedure } from "./trpc";

export const router = createRouter({
  // Test procedures
  greeting: procedure.input(z.object({ name: z.string() })).query((req) => {
    return {
      text: `Hello ${req.input.name}`,
      timestamp: new Date(), // Date objects require transformation
    };
  }),

  // Example of a simple procedure without input
  ping: procedure.query(() => {
    return {
      message: "pong",
      timestamp: new Date(),
    };
  }),

  // Example mutation
  echo: procedure.input(z.object({ message: z.string() })).mutation((req) => {
    return {
      echo: req.input.message,
      timestamp: new Date(),
    };
  }),

  // Vocabulary router
  vocabulary: vocabularyRouter,

  // Transcriptions router
  transcriptions: transcriptionsRouter,

  // Models router
  models: modelsRouter,

  // Settings router
  settings: settingsRouter,

  // Auto-updater router
  updater: updaterRouter,

  // Recording router
  recording: recordingRouter,

  // Widget router
  widget: widgetRouter,

  // Auth router
  auth: authRouter,

  // Onboarding router
  onboarding: onboardingRouter,
});

export type AppRouter = typeof router;
