import { createRouter, procedure } from "../trpc";

export const remoteConfigRouter = createRouter({
  // Current envelope (in-memory; the service refreshes it from amical-core on
  // launch + interval + auth change). Cheap — no network on read.
  get: procedure.query(({ ctx }) => {
    return ctx.serviceManager.getService("remoteConfigService").getConfig();
  }),

  // Force an immediate re-fetch from amical-core (used by the dev menu).
  refresh: procedure.mutation(async ({ ctx }) => {
    const remoteConfigService = ctx.serviceManager.getService(
      "remoteConfigService",
    );
    await remoteConfigService.refresh();
    return remoteConfigService.getConfig();
  }),
});
