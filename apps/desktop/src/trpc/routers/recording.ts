import { observable } from "@trpc/server/observable";
import { createRouter, procedure } from "../trpc";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import type { RecordingState } from "../../types/recording";
import type { RecordingMode } from "../../main/managers/recording-manager";
import type {
  WidgetNotification,
  WidgetNotificationType,
  WidgetNotificationConfig,
  LocalizedText,
} from "../../types/widget-notification";
import {
  WIDGET_NOTIFICATION_CONFIG,
  ERROR_CODE_CONFIG,
  buildNotificationDescription,
} from "../../types/widget-notification";
import { ErrorCodes, type ErrorCode } from "../../types/error";

interface RecordingStateUpdate {
  state: RecordingState;
  mode: RecordingMode;
  isDraft: boolean;
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

  confirmDraft: procedure.mutation(async ({ ctx }) => {
    const recordingManager = ctx.serviceManager.getService("recordingManager");
    if (!recordingManager) {
      throw new Error("Recording manager not available");
    }
    await recordingManager.confirmDraft();
  }),

  dismissDraft: procedure.mutation(async ({ ctx }) => {
    const recordingManager = ctx.serviceManager.getService("recordingManager");
    if (!recordingManager) {
      throw new Error("Recording manager not available");
    }
    recordingManager.dismissDraft();
  }),

  dismiss: procedure.mutation(async ({ ctx }) => {
    const recordingManager = ctx.serviceManager.getService("recordingManager");
    if (!recordingManager) {
      throw new Error("Recording manager not available");
    }
    return await recordingManager.dismissCurrentSession();
  }),

  captureStarted: procedure
    .input(
      z.object({
        microphoneName: z.string().optional(),
        deviceId: z.string().optional(),
        captureSource: z.enum(["preferred", "default"]).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const recordingManager =
        ctx.serviceManager.getService("recordingManager");
      if (!recordingManager) {
        throw new Error("Recording manager not available");
      }

      recordingManager.setActiveMicrophoneForCurrentSession(input);
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
        isDraft: recordingManager.getIsDraftSession(),
      });

      // Set up listener for state changes
      const handleStateChange = (status: RecordingState) => {
        emit.next({
          state: status,
          mode: recordingManager.getRecordingMode(),
          isDraft: recordingManager.getIsDraftSession(),
        });
      };

      const handleModeChange = (mode: RecordingMode) => {
        emit.next({
          state: recordingManager.getState(),
          mode,
          isDraft: recordingManager.getIsDraftSession(),
        });
      };

      // The draft tag latches mid-recording (first audio chunk) without a public
      // state change, so re-push the current state with the now-true isDraft so
      // the FAB shows the draft glyph while still recording.
      const handleDraftLatched = () => {
        emit.next({
          state: recordingManager.getState(),
          mode: recordingManager.getRecordingMode(),
          isDraft: recordingManager.getIsDraftSession(),
        });
      };

      recordingManager.on("state-changed", handleStateChange);
      recordingManager.on("mode-changed", handleModeChange);
      recordingManager.on("draft-latched", handleDraftLatched);

      // Cleanup function
      return () => {
        recordingManager.off("state-changed", handleStateChange);
        recordingManager.off("mode-changed", handleModeChange);
        recordingManager.off("draft-latched", handleDraftLatched);
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
        params?: Record<string, string | number>;
      }) => {
        let config: WidgetNotificationConfig;

        if (data.type === "transcription_failed" && data.errorCode) {
          // USER_DISMISSED is a control signal, not in ERROR_CODE_CONFIG; it
          // never reaches here (dismiss is handled before any emit), so fall
          // back to UNKNOWN if it somehow did.
          const errorConfig =
            data.errorCode === ErrorCodes.USER_DISMISSED
              ? undefined
              : ERROR_CODE_CONFIG[data.errorCode];
          config = errorConfig ?? ERROR_CODE_CONFIG[ErrorCodes.UNKNOWN];
        } else {
          config = WIDGET_NOTIFICATION_CONFIG[data.type];
        }

        // Inject params into i18n objects if provided
        const injectParams = (text: LocalizedText): LocalizedText => {
          if (!data.params || typeof text === "string") return text;
          return { ...text, params: { ...text.params, ...data.params } };
        };

        const description = buildNotificationDescription(
          data.type,
          config,
          data,
        );

        emit.next({
          id: uuid(),
          type: data.type,
          title: data.uiTitle ?? injectParams(config.title),
          description,
          subDescription: config.subDescription,
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

  // Draft review: the held generated text awaiting the user's insert/dismiss.
  // Emits the current draft on subscribe and on every change; null = cleared.
  draftReview: procedure.subscription(({ ctx }) => {
    return observable<{ sessionId: string; text: string } | null>((emit) => {
      const recordingManager =
        ctx.serviceManager.getService("recordingManager");
      if (!recordingManager) {
        throw new Error("Recording manager not available");
      }

      emit.next(recordingManager.getPendingDraft());

      const handleDraftChanged = (
        data: { sessionId: string; text: string } | null,
      ) => {
        emit.next(data);
      };

      recordingManager.on("draft-changed", handleDraftChanged);

      return () => {
        recordingManager.off("draft-changed", handleDraftChanged);
      };
    });
  }),
});
