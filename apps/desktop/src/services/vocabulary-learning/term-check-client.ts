import {
  VocabularyClassifyRequestSchema,
  VocabularyClassifyResponseSchema,
  type VocabularyClassifyRequest,
  type VocabularyClassifyResponse,
} from "@amical/types";
import { Cause, Data, Effect } from "effect";

import type { AuthService } from "../auth-service";
import {
  getAmicalClientHeaders,
  getCoreApiUrl,
  getUserAgent,
} from "../../utils/http-client";
import {
  AuthenticationRequired,
  CloudNetworkFailure,
  decodeCloudHttpFailure,
  type CloudRequestError,
} from "../../types/errors/cloud-request";

const TERM_CHECK_TIMEOUT_MS = 10_000;

export class VocabularyTermCheckContractFailure extends Data.TaggedError(
  "VocabularyTermCheckContractFailure",
)<{
  message: string;
  phase: "request" | "response";
  cause: unknown;
}> {}

export class VocabularyTermCheckDependencyFailure extends Data.TaggedError(
  "VocabularyTermCheckDependencyFailure",
)<{
  message: string;
  dependency: "authentication";
  cause: unknown;
}> {}

export type VocabularyTermCheckError =
  | CloudRequestError
  | VocabularyTermCheckContractFailure
  | VocabularyTermCheckDependencyFailure;

/**
 * Term check: asks the server which correction candidates are worth adding
 * to the vocabulary. Same shape as the activity reporting client: id token
 * from the auth service, tagged errors, one bounded request. Only candidate
 * terms and heard forms are sent, never field text.
 */
export class VocabularyTermCheckClient {
  constructor(private readonly authService: AuthService) {}

  classify(
    request: VocabularyClassifyRequest,
  ): Effect.Effect<VocabularyClassifyResponse, VocabularyTermCheckError> {
    return Effect.gen({ self: this }, function* () {
      const body = yield* Effect.try({
        try: () => VocabularyClassifyRequestSchema.parse(request),
        catch: (cause) =>
          new VocabularyTermCheckContractFailure({
            message:
              cause instanceof Error
                ? cause.message
                : "Invalid vocabulary term check request",
            phase: "request",
            cause,
          }),
      });
      const token = yield* this.authService.getIdToken().pipe(
        Effect.catchCause((cause) =>
          Effect.failCause(
            Cause.map(
              cause,
              (cause) =>
                new VocabularyTermCheckDependencyFailure({
                  message:
                    "Unable to read the vocabulary term check authentication token",
                  dependency: "authentication",
                  cause,
                }),
            ),
          ),
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
          try: () => getCoreApiUrl("/apps/v1/vocabulary/classify"),
          catch: (cause) =>
            new VocabularyTermCheckContractFailure({
              message:
                cause instanceof Error
                  ? cause.message
                  : "Invalid vocabulary term check request URL",
              phase: "request",
              cause,
            }),
        });
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url, {
              method: "POST",
              signal: AbortSignal.any([
                requestController.signal,
                AbortSignal.timeout(TERM_CHECK_TIMEOUT_MS),
              ]),
              headers: {
                "Content-Type": "application/json",
                "User-Agent": getUserAgent(),
                ...getAmicalClientHeaders(),
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(body),
            }),
          catch: (cause) =>
            new CloudNetworkFailure({
              message:
                cause instanceof Error
                  ? cause.message
                  : "Vocabulary term check network request failed",
              cause,
            }),
        });

        const payload = yield* Effect.promise(async () => {
          try {
            return await response.json();
          } catch {
            return undefined;
          }
        });

        if (response.status === 200) {
          // Lenient parse: unknown fields are dropped, so the server can add
          // fields without breaking released desktops.
          return yield* Effect.try({
            try: () => VocabularyClassifyResponseSchema.parse(payload),
            catch: (cause) =>
              new VocabularyTermCheckContractFailure({
                message:
                  cause instanceof Error
                    ? cause.message
                    : "Invalid vocabulary term check response",
                phase: "response",
                cause,
              }),
          });
        }

        return yield* Effect.fail(
          decodeCloudHttpFailure({
            status: response.status,
            statusText: response.statusText,
            body: payload,
            fallbackMessage: `Vocabulary term check request failed with ${response.status}`,
            retryAfter: response.headers?.get("Retry-After") ?? undefined,
          }),
        );
      }).pipe(
        Effect.onInterrupt(() => Effect.sync(() => requestController.abort())),
      );
    });
  }
}
