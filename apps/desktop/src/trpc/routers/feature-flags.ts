import { z } from "zod";
import { createRouter, procedure } from "../trpc";

export const featureFlagsRouter = createRouter({
  getAll: procedure.query(({ ctx }) => {
    const featureFlagService =
      ctx.serviceManager.getService("featureFlagService");
    return {
      flags: featureFlagService.getAllFlags(),
      payloads: featureFlagService.getAllPayloads(),
    };
  }),

  getFlag: procedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input, ctx }) => {
      const featureFlagService =
        ctx.serviceManager.getService("featureFlagService");
      return featureFlagService.getFlagWithPayload(input.key);
    }),

  refresh: procedure.mutation(async ({ ctx }) => {
    const featureFlagService =
      ctx.serviceManager.getService("featureFlagService");
    await featureFlagService.refresh();
    return {
      flags: featureFlagService.getAllFlags(),
      payloads: featureFlagService.getAllPayloads(),
    };
  }),
});
