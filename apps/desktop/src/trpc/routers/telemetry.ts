import { z } from "zod";
import { createRouter, procedure } from "../trpc";
import { widgetNotificationShownSchema } from "../../types/telemetry-events";

const telemetryEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("widget_notification_shown"),
    payload: widgetNotificationShownSchema,
  }),
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
      const telemetryService =
        ctx.serviceManager.getService("telemetryService");

      switch (input.event) {
        case "widget_notification_shown":
          telemetryService.trackWidgetNotificationShown(input.payload);
          break;
        default:
          input.event satisfies never;
      }
    }),
});
