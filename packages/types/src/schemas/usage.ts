import { z } from "zod";

// Structural copy of the Apps V1 `GET /me/usage` response contract. Each
// field is parsed on its own, so one bad or newer field hides only its part.

/** The caller's cloud dictation word allowance for the current window. */
const CloudWordsAllowanceSchema = z.object({
  /** Words counted in the current window. Can be greater than `limit`. */
  used: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  /** End of the current window (the next reset). */
  resetsAt: z.iso.datetime({ offset: true }),
});

const UsageOffersSchema = z.object({
  /** Premium can be bought for the org's plan. */
  premiumUpgrade: z.boolean(),
});

const UsageBillingSchema = z.object({
  /** The caller is an owner or admin. */
  canManage: z.boolean(),
});

export interface CloudUsage {
  /** null = draw no meter. */
  cloudWords: z.output<typeof CloudWordsAllowanceSchema> | null;
  offers: z.output<typeof UsageOffersSchema>;
  billing: z.output<typeof UsageBillingSchema>;
}

/**
 * Parse each field separately. An invalid or unknown `cloudWords` becomes null;
 * invalid `offers` mean no offer; an invalid `billing` becomes
 * `canManage: false`.
 */
export function parseCloudUsage(body: unknown): CloudUsage {
  const record =
    body !== null && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  const cloudWords = CloudWordsAllowanceSchema.safeParse(record.cloudWords);
  const offers = UsageOffersSchema.safeParse(record.offers);
  const billing = UsageBillingSchema.safeParse(record.billing);
  return {
    cloudWords: cloudWords.success ? cloudWords.data : null,
    offers: offers.success ? offers.data : { premiumUpgrade: false },
    billing: billing.success ? billing.data : { canManage: false },
  };
}
