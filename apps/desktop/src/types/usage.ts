import { UsageResponseSchema } from "@amical/api-contracts/apps/v1";
import type { z } from "zod";

const { billing: UsageBillingSchema, cloudWords: CloudWordsSchema } =
  UsageResponseSchema.shape;
// Only the offer this app reads, so a change to another offer cannot hide it.
const UsageOffersSchema = UsageResponseSchema.shape.offers.pick({
  premiumUpgrade: true,
});

export interface CloudUsage {
  /** null = draw no meter. */
  cloudWords: z.output<typeof CloudWordsSchema>;
  offers: z.output<typeof UsageOffersSchema>;
  billing: z.output<typeof UsageBillingSchema>;
}

/**
 * Parse each field separately, so one bad or newer field hides only its part.
 * An invalid `cloudWords` becomes null; invalid `offers` mean no offer; an
 * invalid `billing` becomes `canManage: false`.
 */
export function parseCloudUsage(body: unknown): CloudUsage {
  const record =
    body !== null && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  const cloudWords = CloudWordsSchema.safeParse(record.cloudWords);
  const offers = UsageOffersSchema.safeParse(record.offers);
  const billing = UsageBillingSchema.safeParse(record.billing);
  return {
    cloudWords: cloudWords.success ? cloudWords.data : null,
    offers: offers.success ? offers.data : { premiumUpgrade: false },
    billing: billing.success ? billing.data : { canManage: false },
  };
}
