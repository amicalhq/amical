import { EventEmitter } from "node:events";
import { Effect } from "effect";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import {
  activityMaterializationState,
  activityOutbox,
  transcriptions,
} from "../../src/db/schema";
import {
  createProvisionalTranscription,
  enrichTranscriptionBySession,
  stampTranscriptionDisposition,
} from "../../src/db/transcriptions";
import type { AuthService, AuthState } from "../../src/services/auth-service";
import type { ActivitySubmissionResult } from "../../src/services/activity-reporting-client";
import type { ActivityReportingClientError } from "../../src/services/activity-reporting-errors";
import {
  ActivityReportingService,
  buildActivityBatch,
} from "../../src/services/activity-reporting-service";
import {
  AccessForbidden,
  AuthenticationRequired,
  CloudNetworkFailure,
} from "../../src/types/errors";
import {
  ACTIVITY_MAX_REQUEST_BYTES,
  activityRequestBytes,
  transcriptionActivityModel,
  type DictationActivity,
} from "../../src/types/activity";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

function activity(
  activityId = ids[0],
  overrides: Partial<DictationActivity> = {},
): DictationActivity {
  return {
    activityId,
    occurredAt: "2026-08-28T08:30:00.000Z",
    wordCount: 3,
    audioDurationMs: 2_000,
    appType: "email",
    skills: null,
    transcription: {
      provider: "whisper-cpp",
      model: "whisper-tiny",
      execution: "local",
    },
    formatting: null,
    ...overrides,
  };
}

class FakeAuth extends EventEmitter {
  state: AuthState | null = null;
  private handlers = new Set<() => Effect.Effect<void, unknown>>();

  getAuthState = vi.fn(() => Effect.succeed(this.state));
  getIdToken = vi.fn(() => Effect.succeed("token"));
  refreshTokenIfNeeded = vi.fn(() => Effect.void);

  registerBeforeLogoutHandler(
    handler: () => Effect.Effect<void, unknown>,
  ): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async runBeforeLogoutHandlers(): Promise<void> {
    for (const handler of this.handlers) await Effect.runPromise(handler());
  }
}

describe("ActivityReportingService", () => {
  let testDb: TestDatabase;
  let auth: FakeAuth;
  let submit: Mock<
    (
      activities: DictationActivity[],
    ) => Effect.Effect<ActivitySubmissionResult, ActivityReportingClientError>
  >;
  let service: ActivityReportingService;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
    auth = new FakeAuth();
    submit = vi.fn();
    service = ActivityReportingService.createForTests(
      auth as unknown as AuthService,
      { submit },
    );
    await Effect.runPromise(service.initialize());
  });

  afterEach(async () => {
    await Effect.runPromise(service.shutdown());
    await testDb.close();
  });

  function authenticate(accountId: string) {
    auth.state = {
      isAuthenticated: true,
      idToken: "token",
      refreshToken: "refresh",
      accessToken: "access",
      expiresAt: Date.now() + 60_000,
      userInfo: { sub: accountId },
    };
    auth.emit("authenticated", auth.state);
  }

  function enqueue(item: DictationActivity) {
    testDb.db
      .insert(activityOutbox)
      .values({
        activityId: item.activityId,
        payload: item,
        createdAt: new Date(),
      })
      .run();
    service.wake();
  }

  it("removes complete 200 and terminal 400 batches", async () => {
    authenticate("user-1");
    submit.mockReturnValueOnce(Effect.succeed("success"));
    enqueue(activity(ids[0]));
    await vi.waitFor(async () => {
      expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
    });

    submit.mockReturnValueOnce(Effect.succeed("invalid"));
    enqueue(activity(ids[1]));
    enqueue(activity(ids[2]));
    await vi.waitFor(async () => {
      expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
    });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0].map((item) => item.activityId)).toEqual([
      ids[1],
      ids[2],
    ]);
  });

  it("materializes historical rows when an account becomes active", async () => {
    await testDb.db.insert(transcriptions).values({
      disposition: "success",
      text: "historical words",
      timestamp: new Date("2024-01-02T03:04:05.000Z"),
    });
    submit.mockReturnValueOnce(Effect.succeed("success"));

    authenticate("user-1");

    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]![0][0]).toMatchObject({
      wordCount: 2,
      audioDurationMs: null,
      appType: null,
      transcription: null,
    });
    expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
  });

  it("materializes a new settled dictation directly", async () => {
    authenticate("user-1");
    submit.mockReturnValueOnce(Effect.succeed("success"));
    await createProvisionalTranscription({ sessionId: ids[0]! });
    await enrichTranscriptionBySession(ids[0]!, {
      audioDurationMs: 2_000,
      metaPatch: {
        activity: {
          wordCount: 2,
          appType: " Email ",
          skills: [],
          transcription: transcriptionActivityModel("whisper-tiny", false),
          formatting: null,
        },
      },
    });

    await stampTranscriptionDisposition(ids[0]!, {
      disposition: "success",
      text: "new words",
    });

    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]![0][0]).toMatchObject({
      activityId: ids[0],
      wordCount: 2,
      audioDurationMs: 2_000,
      appType: "email",
      skills: [],
    });
  });

  it("materializes an earlier row when it settles after the cursor advanced", async () => {
    submit.mockReturnValue(Effect.succeed("success"));
    authenticate("user-1");
    await vi.waitFor(async () => {
      expect(
        (await testDb.db.select().from(activityMaterializationState))[0]
          ?.accountId,
      ).toBe("user-1");
    });

    await createProvisionalTranscription({ sessionId: ids[0]! });
    await testDb.db.insert(transcriptions).values({
      sessionId: ids[1],
      disposition: "success",
      text: "later completion",
    });
    service.wake();

    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0][0][0].activityId).toBe(ids[1]);

    await stampTranscriptionDisposition(ids[0]!, {
      disposition: "success",
      text: "earlier completion",
    });

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][0][0].activityId).toBe(ids[0]);
  });

  it("materializes while logged out and uploads after authentication", async () => {
    await createProvisionalTranscription({ sessionId: ids[0]! });
    await stampTranscriptionDisposition(ids[0]!, {
      disposition: "success",
      text: "offline words",
    });

    await vi.waitFor(async () => {
      expect(await testDb.db.select().from(activityOutbox)).toHaveLength(1);
    });
    expect(submit).not.toHaveBeenCalled();

    submit.mockReturnValueOnce(Effect.succeed("success"));
    authenticate("user-1");
    await vi.waitFor(async () => {
      expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
    });
    expect(submit).toHaveBeenCalled();
    expect(
      submit.mock.calls.flatMap(([activities]) =>
        activities.map((item) => item.activityId),
      ),
    ).toEqual(expect.arrayContaining([ids[0]]));
    expect(
      submit.mock.calls.every(([activities]) =>
        activities.every((item) => item.activityId === ids[0]),
      ),
    ).toBe(true);
  });

  it("retains retryable failures and reuses the immutable activity ID", async () => {
    authenticate("user-1");
    submit.mockReturnValueOnce(
      Effect.fail(
        new CloudNetworkFailure({
          message: "network unavailable",
          cause: new TypeError("network unavailable"),
        }),
      ),
    );
    enqueue(activity());

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(await testDb.db.select().from(activityOutbox)).toHaveLength(1);

    submit.mockReturnValueOnce(Effect.succeed("success"));
    service.wake();
    await vi.waitFor(async () => {
      expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
    });
    expect(submit.mock.calls[0][0][0].activityId).toBe(ids[0]);
    expect(submit.mock.calls[1][0][0].activityId).toBe(ids[0]);
  });

  it("forces one token refresh after AuthenticationRequired and retries with the same activity", async () => {
    authenticate("user-1");
    submit
      .mockReturnValueOnce(
        Effect.fail(
          new AuthenticationRequired({
            message: "expired",
          }),
        ),
      )
      .mockReturnValueOnce(Effect.succeed("success"));
    enqueue(activity());

    await vi.waitFor(async () => {
      expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
    });
    expect(auth.refreshTokenIfNeeded).toHaveBeenCalledOnce();
    expect(auth.refreshTokenIfNeeded).toHaveBeenCalledWith(true);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0][0][0].activityId).toBe(ids[0]);
    expect(submit.mock.calls[1][0][0].activityId).toBe(ids[0]);
  });

  it("does not force a second refresh after another AuthenticationRequired", async () => {
    authenticate("user-1");
    submit.mockReturnValue(
      Effect.fail(
        new AuthenticationRequired({
          message: "expired",
        }),
      ),
    );
    enqueue(activity());

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(auth.refreshTokenIfNeeded).toHaveBeenCalledOnce();
    expect(auth.refreshTokenIfNeeded).toHaveBeenCalledWith(true);
    expect(await testDb.db.select().from(activityOutbox)).toHaveLength(1);

    service.wake();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("retains a 403 until the authenticated token changes", async () => {
    authenticate("user-1");
    submit.mockReturnValueOnce(
      Effect.fail(
        new AccessForbidden({
          message: "forbidden",
          meta: { httpStatus: 403 },
        }),
      ),
    );
    enqueue(activity());

    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(await testDb.db.select().from(activityOutbox)).toHaveLength(1);
    service.wake();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(submit).toHaveBeenCalledOnce();
    expect(auth.refreshTokenIfNeeded).not.toHaveBeenCalled();

    submit.mockReturnValueOnce(Effect.succeed("success"));
    auth.emit("token-refreshed", auth.state);
    await vi.waitFor(async () => {
      expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
    });
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("replays retained transcription history after an account switch", async () => {
    await testDb.db.insert(transcriptions).values({
      sessionId: ids[0],
      disposition: "success",
      text: "shared device history",
    });
    submit.mockReturnValue(Effect.succeed("success"));
    authenticate("user-1");
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0][0].activityId).toBe(ids[0]);
    expect(await testDb.db.select().from(activityOutbox)).toEqual([]);

    authenticate("user-2");
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][0][0].activityId).toBe(ids[0]);
  });

  it("resumes the saved cursor when the same account restarts", async () => {
    await testDb.db.insert(transcriptions).values({
      sessionId: ids[0],
      disposition: "success",
      text: "already reported history",
    });
    submit.mockReturnValue(Effect.succeed("success"));
    authenticate("user-1");
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    await vi.waitFor(async () => {
      expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
    });
    expect(await testDb.db.select().from(activityMaterializationState)).toEqual(
      [expect.objectContaining({ accountId: "user-1" })],
    );

    await Effect.runPromise(service.shutdown());
    submit.mockClear();
    await Effect.runPromise(service.initialize());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(submit).not.toHaveBeenCalled();
  });

  it("interrupts work started after the same service instance restarts", async () => {
    await Effect.runPromise(service.shutdown());
    authenticate("user-1");
    let interrupted = false;
    submit.mockImplementationOnce(() =>
      Effect.never.pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          }),
        ),
      ),
    );

    await Effect.runPromise(service.initialize());
    enqueue(activity());
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());

    await Effect.runPromise(service.shutdown());
    expect(interrupted).toBe(true);
  });

  it("transfers a retryable pending row to the next authenticated account", async () => {
    authenticate("user-1");
    submit.mockReturnValueOnce(
      Effect.fail(
        new CloudNetworkFailure({
          message: "network unavailable",
          cause: new TypeError("network unavailable"),
        }),
      ),
    );
    enqueue(activity(ids[0]));
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(await testDb.db.select().from(activityOutbox)).toHaveLength(1);

    submit.mockReturnValueOnce(Effect.succeed("success"));
    authenticate("user-2");
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][0][0].activityId).toBe(ids[0]);
    expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
  });

  it("aborts an in-flight submission at logout and retries it for the next account", async () => {
    let firstInterrupted = false;
    submit
      .mockImplementationOnce(() =>
        Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              firstInterrupted = true;
            }),
          ),
        ),
      )
      .mockReturnValueOnce(Effect.succeed("success"));

    authenticate("user-1");
    enqueue(activity(ids[0]));
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());

    await auth.runBeforeLogoutHandlers();
    expect(firstInterrupted).toBe(true);
    expect(await testDb.db.select().from(activityOutbox)).toHaveLength(1);

    authenticate("user-2");
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][0][0].activityId).toBe(ids[0]);
    await vi.waitFor(async () => {
      expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
    });
  });

  it("does not let a stale account completion remove an outbox-only row", async () => {
    submit
      .mockImplementationOnce(() =>
        Effect.sync(() => {
          authenticate("user-2");
          return "success" as const;
        }),
      )
      .mockReturnValueOnce(Effect.succeed("success"));

    authenticate("user-1");
    enqueue(activity(ids[0]));

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[0][0][0].activityId).toBe(ids[0]);
    expect(submit.mock.calls[1][0][0].activityId).toBe(ids[0]);
    await vi.waitFor(async () => {
      expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
    });
  });

  it("does not refresh the new account for a stale AuthenticationRequired", async () => {
    submit
      .mockImplementationOnce(() =>
        Effect.sync(() => {
          authenticate("user-2");
        }).pipe(
          Effect.zipRight(
            Effect.fail(
              new AuthenticationRequired({ message: "stale account" }),
            ),
          ),
        ),
      )
      .mockReturnValueOnce(Effect.succeed("success"));

    authenticate("user-1");
    enqueue(activity(ids[0]));

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(auth.refreshTokenIfNeeded).not.toHaveBeenCalled();
    await vi.waitFor(async () => {
      expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
    });
  });

  it("enforces both server batch limits", () => {
    const many = Array.from({ length: 501 }, (_, index) =>
      activity(`${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`),
    );
    expect(buildActivityBatch(many)).toHaveLength(500);

    const largeModel = "x".repeat(300_000);
    const largeActivities = [
      activity(ids[0], {
        transcription: {
          provider: "whisper-cpp",
          model: largeModel,
          execution: "local",
        },
      }),
      activity(ids[1], {
        transcription: {
          provider: "whisper-cpp",
          model: largeModel,
          execution: "local",
        },
      }),
    ];
    const batch = buildActivityBatch(largeActivities);
    expect(batch).toHaveLength(1);
    expect(activityRequestBytes(batch)).toBeLessThanOrEqual(
      ACTIVITY_MAX_REQUEST_BYTES,
    );
  });
});
