import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import superjson from "superjson";
import { ServiceManager } from "../../main/managers/service-manager";
import type { RecordingStatus } from "../../types/recording";
import { logger } from "../../main/logger";

const t = initTRPC.create({
  isServer: true,
  transformer: superjson,
});

export const recordingRouter = t.router({
  start: t.procedure.mutation(async () => {
    const serviceManager = ServiceManager.getInstance();
    if (!serviceManager) {
      throw new Error("ServiceManager not initialized");
    }

    const recordingManager = serviceManager.getRecordingManager();
    return await recordingManager.startRecording();
  }),

  stop: t.procedure.mutation(async () => {
    const serviceManager = ServiceManager.getInstance();
    if (!serviceManager) {
      throw new Error("ServiceManager not initialized");
    }

    const recordingManager = serviceManager.getRecordingManager();
    return await recordingManager.stopRecording();
  }),

  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // Modern Node.js (20+) adds Symbol.asyncDispose to async generators natively,
  // which conflicts with electron-trpc's attempt to add the same symbol.
  // While Observables are deprecated in tRPC, they work without this conflict.
  // TODO: Remove this workaround when electron-trpc is updated to handle native Symbol.asyncDispose
  // eslint-disable-next-line deprecation/deprecation
  stateUpdates: t.procedure.subscription(() => {
    return observable<RecordingStatus>((emit) => {
      const serviceManager = ServiceManager.getInstance();
      if (!serviceManager) {
        throw new Error("ServiceManager not initialized");
      }

      const recordingManager = serviceManager.getRecordingManager();

      // Emit initial state
      emit.next(recordingManager.getStatus());

      // Set up listener for state changes
      const handleStateChange = (status: RecordingStatus) => {
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
  voiceDetectionUpdates: t.procedure.subscription(() => {
    return observable<boolean>((emit) => {
      const serviceManager = ServiceManager.getInstance();
      if (!serviceManager) {
        throw new Error("ServiceManager not initialized");
      }

      const vadService = serviceManager.getVADService();
      if (!vadService) {
        logger.main.warn(
          "VAD service not available for voice detection subscription",
        );
        // Emit false and complete immediately if VAD is not available
        emit.next(false);
        return () => {};
      }

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
