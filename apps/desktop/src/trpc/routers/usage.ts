import { z } from "zod";
import { observable } from "@trpc/server/observable";
import { createRouter, procedure } from "../trpc";

export const usageRouter = createRouter({
  get: procedure.query(({ ctx }) => ctx.services.usageService.get()),

  // Window focus or return from the web billing page.
  refreshIfStale: procedure.mutation(({ ctx }) =>
    ctx.services.usageService.refreshIfStale(),
  ),

  onChanged: procedure
    .input(z.object({ visible: z.boolean() }))
    .subscription(({ ctx, input }) => {
      return observable<{ changed: true }>((emit) => {
        const usageService = ctx.services.usageService;
        const unsubscribe = usageService.onChange(() =>
          emit.next({ changed: true }),
        );
        const stopWatching = input.visible ? usageService.watch() : undefined;
        // Also repair updates missed before attachment or during reconnection.
        emit.next({ changed: true });
        return () => {
          unsubscribe();
          stopWatching?.();
        };
      });
    }),
});
