import { observable } from "@trpc/server/observable";
import { createRouter, procedure } from "../trpc";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import type { RecordingMode, RecordingState } from "../../types/recording";
import type {
  WidgetNotification,
  WidgetNotificationConfig,
  LocalizedText,
} from "../../types/widget-notification";
import {
  WIDGET_NOTIFICATION_CONFIG,
  ERROR_CODE_CONFIG,
  buildNotificationDescription,
} from "../../types/widget-notification";
import { ErrorCodes } from "../../types/error";
import type {
  LifecycleNotification,
  RecordingLifecycle,
} from "../../main/lifecycle/runtime";
import type { LifecycleSessionMeta } from "../../main/lifecycle/metadata";
import type { LifecycleSnapshot } from "../../main/lifecycle/shell";

interface RecordingStateUpdate {
  sessionId: string | null;
  state: RecordingState;
  mode: RecordingMode;
  isDraft: boolean;
  /** Dismiss-vs-finalize while stopping (D7): dismissals render no
   * processing indicator — nothing is being transcribed. */
  stopKind: "none" | "dismiss" | "finalize";
  stopOrigin: "none" | "user" | "auto";
}

function requireLifecycle(ctx: {
  services: { recordingLifecycle?: RecordingLifecycle | null };
}): RecordingLifecycle {
  const lifecycle = ctx.services.recordingLifecycle;
  if (!lifecycle) {
    throw new Error("Recording lifecycle not available");
  }
  return lifecycle;
}

function toStateUpdate(
  snapshot: LifecycleSnapshot<LifecycleSessionMeta>,
): RecordingStateUpdate {
  return {
    sessionId: snapshot.sessionId,
    state: snapshot.projection.publicState,
    mode: snapshot.metadata?.mode ?? "ptt",
    isDraft: snapshot.metadata?.isDraft ?? false,
    stopKind: snapshot.projection.stopKind,
    stopOrigin: snapshot.projection.stopOrigin,
  };
}

export const recordingRouter = createRouter({
  signalStart: procedure.mutation(async ({ ctx }) => {
    await requireLifecycle(ctx).startDictation();
  }),

  signalStop: procedure.mutation(async ({ ctx }) => {
    await requireLifecycle(ctx).stopDictation();
  }),

  confirmDraft: procedure.mutation(async ({ ctx }) => {
    await requireLifecycle(ctx).confirmDraft();
  }),

  dismissDraft: procedure.mutation(({ ctx }) => {
    requireLifecycle(ctx).dismissDraft();
  }),

  dismiss: procedure.mutation(async ({ ctx }) => {
    await requireLifecycle(ctx).dismiss();
  }),

  captureStarted: procedure
    .input(
      z.object({
        sessionId: z.string(),
        microphoneName: z.string().optional(),
        deviceId: z.string().optional(),
        captureSource: z.enum(["preferred", "default"]).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      requireLifecycle(ctx).captureStarted(input.sessionId, {
        name: input.microphoneName,
        deviceId: input.deviceId,
      });
    }),

  captureStartFailed: procedure
    .input(
      z.object({
        sessionId: z.string(),
        name: z.string().optional(),
        message: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => {
      requireLifecycle(ctx).captureStartFailed(input.sessionId, input);
    }),

  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // Modern Node.js (20+) adds Symbol.asyncDispose to async generators natively,
  // which conflicts with electron-trpc's attempt to add the same symbol.
  // While Observables are deprecated in tRPC, they work without this conflict.
  // TODO: Remove this workaround when electron-trpc is updated to handle native Symbol.asyncDispose
  // eslint-disable-next-line deprecation/deprecation
  stateUpdates: procedure.subscription(({ ctx }) => {
    return observable<RecordingStateUpdate>((emit) => {
      const lifecycle = requireLifecycle(ctx);
      emit.next(toStateUpdate(lifecycle.getSnapshot()));
      // Snapshots publish on every material change (state, mode upgrade,
      // draft latch), so one subscription covers what took three v1 events.
      return lifecycle.onSnapshot((snapshot) => {
        emit.next(toStateUpdate(snapshot));
      });
    });
  }),

  // Widget notification subscription
  widgetNotifications: procedure.subscription(({ ctx }) => {
    return observable<WidgetNotification>((emit) => {
      const lifecycle = requireLifecycle(ctx);

      const handleNotification = (data: LifecycleNotification) => {
        let config: WidgetNotificationConfig;

        if (data.type === "transcription_failed" && data.errorCode) {
          // Causes are opaque strings; unknown codes fall back to UNKNOWN.
          config =
            ERROR_CODE_CONFIG[data.errorCode] ??
            ERROR_CODE_CONFIG[ErrorCodes.UNKNOWN];
        } else {
          config = WIDGET_NOTIFICATION_CONFIG[data.type];
        }

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

      return lifecycle.onNotification(handleNotification);
    });
  }),

  // Draft review: the held generated text awaiting the user's insert/dismiss.
  // Emits the current draft on subscribe and on every change; null = cleared.
  draftReview: procedure.subscription(({ ctx }) => {
    return observable<{ sessionId: string; text: string } | null>((emit) => {
      const lifecycle = requireLifecycle(ctx);
      emit.next(lifecycle.getPendingDraft());
      return lifecycle.onDraftChanged((draft) => emit.next(draft));
    });
  }),
});
