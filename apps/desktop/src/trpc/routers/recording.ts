import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ServiceManager } from "../../main/managers/service-manager";
import type { RecordingStatus } from "../../types/recording";

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

  stateUpdates: t.procedure.subscription(async function* () {
    const serviceManager = ServiceManager.getInstance();
    if (!serviceManager) {
      throw new Error("ServiceManager not initialized");
    }

    const recordingManager = serviceManager.getRecordingManager();

    // Yield initial state
    yield recordingManager.getStatus();

    // Since we're using 'once', listeners auto-remove after firing
    // The only cleanup needed is if subscription closes while waiting
    while (true) {
      const status = await new Promise<RecordingStatus>((resolve) => {
        recordingManager.once("state-changed", resolve);
      });
      yield status;
    }
  }),
});
