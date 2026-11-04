import { DictationActivitySummarySchema } from "@amical/api-contracts/apps/v1";
import type { AuthService } from "./auth-service";
import { getAccountResource } from "./account-request";

export async function getAccountSummary(
  authService: AuthService,
  accountId: string,
  signal?: AbortSignal,
) {
  return getAccountResource(
    authService,
    accountId,
    {
      path: "/apps/v1/me/activities/summary",
      parse: (body) => DictationActivitySummarySchema.parse(body),
      accountChangedMessage: "Account changed while loading dictation stats",
      fallbackMessage: "Unable to load account dictation stats",
    },
    signal,
  );
}
