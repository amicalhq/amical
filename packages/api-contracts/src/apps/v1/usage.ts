import { z } from 'zod';
import { BillingOffersSchema } from './billing-offers.js';
import { AppsV1IsoDateTimeSchema } from './common.js';

/** The caller's cloud dictation word allowance, counted the way the dictation gate counts it. */
export const CloudWordsAllowanceSchema = z
  .object({
    /** Words the gate counted in the current window. Can be greater than `limit`. */
    used: z.number().int().nonnegative(),
    /** Words per window. Always a cap: a plan without a cap gets `cloudWords: null`. */
    limit: z.number().int().positive(),
    /** UTC instant the window ends (the next reset). */
    resetsAt: AppsV1IsoDateTimeSchema,
  })
  .strip();

export const UsageResponseSchema = z
  .object({
    /** null = draw no meter (no cap, pooled plan, never-resetting plan, no active subscription). */
    cloudWords: CloudWordsAllowanceSchema.nullable(),
    /**
     * Plan-level, not filtered by role: show a buy CTA only if
     * `offers.premiumUpgrade && billing.canManage`.
     */
    offers: BillingOffersSchema,
    billing: z.object({ canManage: z.boolean() }).strip(), // owner or admin
  })
  .strip();

export type UsageResponse = z.infer<typeof UsageResponseSchema>;
