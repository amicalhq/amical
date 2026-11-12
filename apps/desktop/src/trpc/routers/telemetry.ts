import { z } from "zod";
import { createRouter, procedure } from "../trpc";
import {
  mobileAppQrOpenedSchema,
  starNudgeSchema,
  widgetNotificationShownSchema,
} from "../../types/telemetry-events";

const telemetryEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("widget_notification_shown"),
    payload: widgetNotificationShownSchema,
  }),
  z.object({
    event: z.literal("star_nudge"),
    payload: starNudgeSchema,
  }),
  z.object({
    event: z.literal("mobile_app_qr_opened"),
    payload: mobileAppQrOpenedSchema,
  }),
  z.object({ event: z.literal("referral_widget_opened") }),
]);

// Generic telemetry router for renderer-originated events.
// Domain routers (notes, transcriptions, etc.) track telemetry inline since
// they already handle the action. This router exists for cases where only the
// renderer knows the event occurred (e.g. a toast was actually displayed).
// Add new event types by extending the telemetryEventSchema discriminated union.
export const telemetryRouter = createRouter({
  trackEvent: procedure
    .input(telemetryEventSchema)
    .mutation(({ ctx, input }) => {
      const telemetryService = ctx.services.telemetryService;

      switch (input.event) {
        case "widget_notification_shown":
          telemetryService.trackWidgetNotificationShown(input.payload);
          break;
        case "star_nudge":
          telemetryService.trackStarNudge(input.payload);
          break;
        case "mobile_app_qr_opened":
          telemetryService.trackMobileAppQrOpened(input.payload);
          break;
        case "referral_widget_opened":
          telemetryService.trackReferralWidgetOpened();
          break;
        default:
          input satisfies never;
      }
    }),
});
