import { z } from "zod";
import { getReferralWidgetToken } from "../../services/referral-widget-token";
import { createRouter, procedure } from "../trpc";

export const referralsRouter = createRouter({
  // The renderer names the account it shows; the request fails for any other
  // account.
  getWidgetToken: procedure
    .input(z.object({ accountId: z.string() }))
    .query(({ ctx, input }) =>
      getReferralWidgetToken(ctx.services.authService, input.accountId),
    ),
});
