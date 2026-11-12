import { ReferralWidgetTokenResponseSchema } from "@amical/api-contracts/apps/v1";
import { AccessForbidden } from "../types/errors/cloud-request";
import type { AuthService } from "./auth-service";
import { getAccountResource } from "./account-request";

/**
 * A RefRef Widget token for the signed-in account, or null when referrals are
 * not available to it (403).
 */
export async function getReferralWidgetToken(
  authService: AuthService,
  accountId: string,
): Promise<string | null> {
  try {
    const { token } = await getAccountResource(authService, accountId, {
      path: "/apps/v1/me/referral-widget-token",
      parse: (body) => ReferralWidgetTokenResponseSchema.parse(body),
      accountChangedMessage: "Account changed while loading the referral token",
      fallbackMessage: "Unable to load the referral token",
    });
    return token;
  } catch (error) {
    if (error instanceof AccessForbidden) return null;
    throw error;
  }
}
