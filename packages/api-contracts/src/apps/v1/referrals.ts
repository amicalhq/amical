import { z } from 'zod';

/**
 * `GET /apps/v1/me/referral-widget-token`: a short-lived RefRef Widget token for the caller's org.
 * 403 when referrals are not available to the caller.
 */
export const ReferralWidgetTokenResponseSchema = z.object({ token: z.string() }).strip();
export type ReferralWidgetTokenResponse = z.infer<typeof ReferralWidgetTokenResponseSchema>;
