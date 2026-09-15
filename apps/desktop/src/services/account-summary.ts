import { Effect } from "effect";
import { DictationActivitySummarySchema } from "@amical/types";
import { runAuthEffect, type AuthService } from "./auth-service";
import { retryOnceAfterAuthenticationRequired } from "./auth-retry";
import { settleExit } from "../types/errors";
import {
  AuthenticationRequired,
  decodeCloudHttpFailure,
} from "../types/errors/cloud-request";
import {
  getAmicalClientHeaders,
  getCoreApiUrl,
  getUserAgent,
} from "../utils/http-client";

export async function getAccountSummary(
  authService: AuthService,
  accountId: string,
  signal?: AbortSignal,
) {
  const ensureAccount = async () => {
    signal?.throwIfAborted();
    const state = await runAuthEffect(authService.getAuthState());
    if (!state?.isAuthenticated || state.userInfo?.sub !== accountId) {
      throw new Error("Account changed while loading dictation stats");
    }
  };

  const request = async () => {
    await ensureAccount();
    const token = await runAuthEffect(authService.getIdToken());
    await ensureAccount();
    if (!token) {
      throw new AuthenticationRequired({ message: "Sign in required" });
    }

    const response = await fetch(
      getCoreApiUrl("/apps/v1/me/activities/summary"),
      {
        method: "GET",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
        headers: {
          "User-Agent": getUserAgent(),
          ...getAmicalClientHeaders(),
          Authorization: `Bearer ${token}`,
        },
      },
    );
    const body: unknown = await response.json().catch(() => undefined);
    await ensureAccount();
    if (!response.ok) {
      throw decodeCloudHttpFailure({
        status: response.status,
        statusText: response.statusText,
        body,
        fallbackMessage: "Unable to load account dictation stats",
        retryAfter: response.headers.get("Retry-After") ?? undefined,
      });
    }
    return DictationActivitySummarySchema.parse(body);
  };

  return Effect.runPromiseExit(
    retryOnceAfterAuthenticationRequired(
      () => Effect.tryPromise({ try: request, catch: (cause) => cause }),
      () =>
        Effect.tryPromise({
          try: async () => {
            await ensureAccount();
            await runAuthEffect(authService.refreshTokenIfNeeded(true));
          },
          catch: (cause) => cause,
        }),
    ),
  ).then(settleExit);
}
