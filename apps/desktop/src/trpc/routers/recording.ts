import { observable } from "@trpc/server/observable";
import { createRouter, procedure } from "../trpc";
import { v4 as uuid } from "uuid";
import type { RecordingState } from "../../types/recording";
import type { RecordingMode } from "../../main/managers/recording-manager";
import type {
  WidgetNotification,
  WidgetNotificationType,
  WidgetNotificationConfig,
} from "../../types/widget-notification";
import {
  WIDGET_NOTIFICATION_CONFIG,
  ERROR_CODE_CONFIG,
} from "../../types/widget-notification";
import { ErrorCodes, type ErrorCode } from "../../types/error";

interface RecordingStateUpdate {
  state: RecordingState;
  mode: RecordingMode;
}

export const recordingRouter = createRouter({
  signalStart: procedure.mutation(async ({ ctx }) => {
    const recordingManager = ctx.serviceManager.getService("recordingManager");
    if (!recordingManager) {
      throw new Error("Recording manager not available");
    }
    return await recordingManager.signalStart();
  }),

  signalStop: procedure.mutation(async ({ ctx }) => {
    const recordingManager = ctx.serviceManager.getService("recordingManager");
    if (!recordingManager) {
      throw new Error("Recording manager not available");
    }
    return await recordingManager.signalStop();
  }),

  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // Modern Node.js (20+) adds Symbol.asyncDispose to async generators natively,
  // which conflicts with electron-trpc's attempt to add the same symbol.
  // While Observables are deprecated in tRPC, they work without this conflict.
  // TODO: Remove this workaround when electron-trpc is updated to handle native Symbol.asyncDispose
  // eslint-disable-next-line deprecation/deprecation
  stateUpdates: procedure.subscription(({ ctx }) => {
    return observable<RecordingStateUpdate>((emit) => {
      const recordingManager =
        ctx.serviceManager.getService("recordingManager");
      if (!recordingManager) {
        throw new Error("Recording manager not available");
      }

      // Emit initial state
      emit.next({
        state: recordingManager.getState(),
        mode: recordingManager.getRecordingMode(),
      });

      // Set up listener for state changes
      const handleStateChange = (status: RecordingState) => {
        emit.next({
          state: status,
          mode: recordingManager.getRecordingMode(),
        });
      };

      const handleModeChange = (mode: RecordingMode) => {
        emit.next({
          state: recordingManager.getState(),
          mode,
        });
      };

      recordingManager.on("state-changed", handleStateChange);
      recordingManager.on("mode-changed", handleModeChange);

      // Cleanup function
      return () => {
        recordingManager.off("state-changed", handleStateChange);
        recordingManager.off("mode-changed", handleModeChange);
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

  // Widget notification subscription
  widgetNotifications: procedure.subscription(({ ctx }) => {
    return observable<WidgetNotification>((emit) => {
      const recordingManager =
        ctx.serviceManager.getService("recordingManager");
      if (!recordingManager) {
        throw new Error("Recording manager not available");
      }

      const handleNotification = (data: {
        type: WidgetNotificationType;
        errorCode?: ErrorCode;
        uiTitle?: string;
        uiMessage?: string;
        traceId?: string;
      }) => {
        let config: WidgetNotificationConfig;

        if (data.type === "transcription_failed" && data.errorCode) {
          config =
            ERROR_CODE_CONFIG[data.errorCode] ??
            ERROR_CODE_CONFIG[ErrorCodes.UNKNOWN];
        } else {
          config = WIDGET_NOTIFICATION_CONFIG[data.type];
        }

        emit.next({
          id: uuid(),
          type: data.type,
          // Use UI overrides if provided, fall back to config
          title: data.uiTitle ?? config.title,
          // Only send description for transcription_failed; audio notifications use mic-name template on frontend
          description:
            data.type === "transcription_failed"
              ? data.uiMessage ?? config.description
              : undefined,
          errorCode: data.errorCode,
          traceId: data.traceId,
          primaryAction: config.primaryAction,
          secondaryAction: config.secondaryAction,
          timestamp: Date.now(),
        });
      };

      recordingManager.on("widget-notification", handleNotification);

      // Cleanup function
      return () => {
        recordingManager.off("widget-notification", handleNotification);
      };
    });
  }),
});
