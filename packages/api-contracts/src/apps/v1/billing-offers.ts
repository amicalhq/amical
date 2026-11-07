import { z } from 'zod';

export const BillingOffersSchema = z
  .object({
    /** Premium can be bought. Checkout refuses orgs without it. */
    premiumUpgrade: z.boolean(),
    /** Show the Enterprise "Contact sales" row. */
    enterpriseRow: z.boolean(),
  })
  .strip();
export type BillingOffers = z.infer<typeof BillingOffersSchema>;
