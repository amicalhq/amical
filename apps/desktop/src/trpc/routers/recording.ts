import { observable } from "@trpc/server/observable";
import { createRouter, procedure } from "../trpc";
import type { RecordingState } from "../../types/recording";

export const recordingRouter = createRouter({
  start: procedure.mutation(async ({ ctx }) => {
    const recordingManager = ctx.serviceManager.getService("recordingManager");
    if (!recordingManager) {
      throw new Error("Recording manager not available");
    }
    return await recordingManager.startRecording();
  }),

  stop: procedure.mutation(async ({ ctx }) => {
    const recordingManager = ctx.serviceManager.getService("recordingManager");
    if (!recordingManager) {
      throw new Error("Recording manager not available");
    }
    return await recordingManager.stopRecording();
  }),

  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // Modern Node.js (20+) adds Symbol.asyncDispose to async generators natively,
  // which conflicts with electron-trpc's attempt to add the same symbol.
  // While Observables are deprecated in tRPC, they work without this conflict.
  // TODO: Remove this workaround when electron-trpc is updated to handle native Symbol.asyncDispose
  // eslint-disable-next-line deprecation/deprecation
  stateUpdates: procedure.subscription(({ ctx }) => {
    return observable<RecordingState>((emit) => {
      const recordingManager =
        ctx.serviceManager.getService("recordingManager");
      if (!recordingManager) {
        throw new Error("Recording manager not available");
      }

      // Emit initial state
      emit.next(recordingManager.getState());

      // Set up listener for state changes
      const handleStateChange = (status: RecordingState) => {
        emit.next(status);
      };

      recordingManager.on("state-changed", handleStateChange);

      // Cleanup function
      return () => {
        recordingManager.off("state-changed", handleStateChange);
      };
    });
  }),

  // Voice detection subscription
  voiceDetectionUpdates: procedure.subscription(({ ctx }) => {
    return observable<boolean>((emit) => {
      const vadService = ctx.serviceManager.getService("vadService");
      const logger = ctx.serviceManager.getLogger();

      if (!vadService) {
        logger.main.warn(
          "VAD service not available for voice detection subscription",
        );
        // Emit false and complete immediately if VAD is not available
        emit.next(false);
        return () => {};
      }

      const isSpeaking = vadService.getIsSpeaking();
      emit.next(isSpeaking);

      // Set up listener for voice detection changes
      const handleVoiceDetection = (detected: boolean) => {
        emit.next(detected);
      };

      vadService.on("voice-detected", handleVoiceDetection);

      // Cleanup function
      return () => {
        vadService.off("voice-detected", handleVoiceDetection);
      };
    });
  }),
});
