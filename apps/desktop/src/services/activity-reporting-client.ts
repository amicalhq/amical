import type { AuthService } from "./auth-service";
import {
  ActivityReportingContractFailure,
  ActivityReportingDependencyFailure,
  type ActivityReportingClientError,
} from "./activity-reporting-errors";
import {
  getAmicalClientHeaders,
  getCoreApiUrl,
  getUserAgent,
} from "../utils/http-client";
import { ActivityBatchSchema, type DictationActivity } from "../types/activity";
import {
  AuthenticationRequired,
  CloudNetworkFailure,
  decodeCloudHttpFailure,
} from "../types/errors/cloud-request";
import { Effect } from "effect";

export class ActivityReportingClient {
  constructor(private readonly authService: AuthService) {}

  submit(
    activities: DictationActivity[],
  ): Effect.Effect<void, ActivityReportingClientError> {
    return Effect.gen(this, function* () {
      const request = yield* Effect.try({
        try: () => ActivityBatchSchema.parse({ activities }),
        catch: (cause) =>
          new ActivityReportingContractFailure({
            message:
              cause instanceof Error
                ? cause.message
                : "Invalid activity reporting request",
            phase: "request",
            cause,
          }),
      });
      const token = yield* this.authService.getIdToken().pipe(
        Effect.mapError(
          (cause) =>
            new ActivityReportingDependencyFailure({
              message:
                "Unable to read the activity reporting authentication token",
              dependency: "authentication",
              cause,
            }),
        ),
      );
      if (!token) {
        return yield* Effect.fail(
          new AuthenticationRequired({
            message: "Sign in required",
            meta: { httpStatus: 401 },
          }),
        );
      }

      const requestController = new AbortController();
      return yield* Effect.gen(function* () {
        const url = yield* Effect.try({
          try: () => getCoreApiUrl("/apps/v1/me/activities"),
          catch: (cause) =>
            new ActivityReportingContractFailure({
              message:
                cause instanceof Error
                  ? cause.message
                  : "Invalid activity reporting request URL",
              phase: "request",
              cause,
            }),
        });
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url, {
              method: "POST",
              signal: requestController.signal,
              headers: {
                "Content-Type": "application/json",
                "User-Agent": getUserAgent(),
                ...getAmicalClientHeaders(),
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(request),
            }),
          catch: (cause) =>
            new CloudNetworkFailure({
              message:
                cause instanceof Error
                  ? cause.message
                  : "Activity reporting network request failed",
              cause,
            }),
        });

        if (response.status === 200) return;

        const body = yield* Effect.promise(async () => {
          try {
            return await response.json();
          } catch {
            return undefined;
          }
        });
        return yield* Effect.fail(
          decodeCloudHttpFailure({
            status: response.status,
            statusText: response.statusText,
            body,
            fallbackMessage: `Activity reporting request failed with ${response.status}`,
            retryAfter: response.headers?.get("Retry-After") ?? undefined,
          }),
        );
      }).pipe(
        Effect.onInterrupt(() => Effect.sync(() => requestController.abort())),
      );
    });
  }
}
