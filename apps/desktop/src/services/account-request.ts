import { Effect } from "effect";
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

/**
 * GET an Apps V1 resource for one signed-in account. Fails if the account
 * changes during the request, and retries once after a token refresh.
 */
export async function getAccountResource<A>(
  authService: AuthService,
  accountId: string,
  options: {
    path: string;
    parse: (body: unknown) => A;
    accountChangedMessage: string;
    fallbackMessage: string;
  },
  signal?: AbortSignal,
): Promise<A> {
  const ensureAccount = async () => {
    signal?.throwIfAborted();
    const state = await runAuthEffect(authService.getAuthState());
    if (!state?.isAuthenticated || state.userInfo?.sub !== accountId) {
      throw new Error(options.accountChangedMessage);
    }
  };

  const request = async () => {
    await ensureAccount();
    const token = await runAuthEffect(authService.getIdToken());
    await ensureAccount();
    if (!token) {
      throw new AuthenticationRequired({ message: "Sign in required" });
    }

    const response = await fetch(getCoreApiUrl(options.path), {
      method: "GET",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": getUserAgent(),
        ...getAmicalClientHeaders(),
        Authorization: `Bearer ${token}`,
      },
    });
    const body: unknown = await response.json().catch(() => undefined);
    await ensureAccount();
    if (!response.ok) {
      throw decodeCloudHttpFailure({
        status: response.status,
        statusText: response.statusText,
        body,
        fallbackMessage: options.fallbackMessage,
        retryAfter: response.headers.get("Retry-After") ?? undefined,
      });
    }
    return options.parse(body);
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
