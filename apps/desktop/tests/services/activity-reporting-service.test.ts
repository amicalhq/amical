import { EventEmitter } from "node:events";
import { eq } from "drizzle-orm";
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
  appSettings,
  activityMaterializationState,
  activityOutbox,
  dictationStats,
  transcriptions,
} from "../../src/db/schema";
import {
  createProvisionalTranscription,
  deleteTranscription,
  enrichTranscriptionBySession,
  stampTranscriptionDisposition,
} from "../../src/db/transcriptions";
import type { AuthService, AuthState } from "../../src/services/auth-service";
import * as activityStore from "../../src/db/activity-outbox";
import { logger } from "../../src/main/logger";
import type { ActivityReportingClientError } from "../../src/services/activity-reporting-errors";
import {
  ActivityReportingService,
  buildActivityBatch,
} from "../../src/services/activity-reporting-service";
import {
  AccessForbidden,
  AuthenticationRequired,
  BadRequest,
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
import { db } from "../../src/db";
import { getAppSettings } from "../../src/db/app-settings";
import {
  getLifetimeStats,
  incrementDictationStats,
} from "../../src/db/dictation-stats";
import type { getAccountSummary } from "../../src/services/account-summary";

const summary = {
  totals: {
    activities: 150,
    words: 12000,
    wordsWithAudioDuration: 0,
    audioDurationMs: null,
  },
};

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
    ) => Effect.Effect<void, ActivityReportingClientError>
  >;
  let service: ActivityReportingService;
  let readSummary: Mock<typeof getAccountSummary>;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
    await getAppSettings();
    auth = new FakeAuth();
    readSummary = vi.fn().mockResolvedValue(summary);
    submit = vi.fn();
    service = ActivityReportingService.createForTests(
      auth as unknown as AuthService,
      { submit },
      readSummary,
    );
    await Effect.runPromise(service.initialize());
  });

  afterEach(async () => {
    await Effect.runPromise(service.shutdown());
    await testDb.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
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
    const settings = testDb.db.select().from(appSettings).get()!;
    testDb.db
      .update(appSettings)
      .set({ data: { ...settings.data, auth: auth.state } })
      .run();
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

  it("removes complete 200 batches and retains HTTP 400 batches", async () => {
    authenticate("user-1");
    submit.mockReturnValueOnce(Effect.void);
    enqueue(activity(ids[0]));
    await vi.waitFor(async () => {
      expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
    });

    submit.mockReturnValueOnce(
      Effect.fail(
        new BadRequest({
          message: "Invalid activity batch",
          meta: { httpStatus: 400 },
        }),
      ),
    );
    enqueue(activity(ids[1]));
    enqueue(activity(ids[2]));
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(await testDb.db.select().from(activityOutbox)).toHaveLength(2);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0].map((item) => item.activityId)).toEqual([
      ids[1],
      ids[2],
    ]);

    submit.mockReturnValueOnce(Effect.void);
    service.wake();
    await vi.waitFor(async () => {
      expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
    });
    expect(submit).toHaveBeenCalledTimes(3);
    expect(submit.mock.calls[2][0].map((item) => item.activityId)).toEqual([
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
    submit.mockReturnValueOnce(Effect.void);

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

  it("stages a new settlement during an upload before its history can be deleted", async () => {
    let finishUpload!: () => void;
    const uploading = new Promise<void>((resolve) => {
      finishUpload = resolve;
    });
    submit
      .mockReturnValueOnce(Effect.promise(() => uploading))
      .mockReturnValue(Effect.void);
    authenticate("user-1");
    enqueue(activity(ids[1]));
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());

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

    const settled = await stampTranscriptionDisposition(ids[0]!, {
      disposition: "success",
      text: "new words",
    });

    await vi.waitFor(async () => {
      expect(await testDb.db.select().from(activityOutbox)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ activityId: ids[0] }),
        ]),
      );
    });
    await deleteTranscription(settled!.id);
    finishUpload();

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1]![0][0]).toMatchObject({
      activityId: ids[0],
      wordCount: 2,
      audioDurationMs: 2_000,
      appType: "email",
      skills: [],
    });
  });

  it("finds a late completion on the next wake even without its settlement notification", async () => {
    submit.mockReturnValue(Effect.void);
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

    // Simulate a committed settlement whose notification was missed.
    await testDb.db
      .update(transcriptions)
      .set({ disposition: "success", text: "earlier completion" })
      .where(eq(transcriptions.sessionId, ids[0]!));
    service.wake();

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

    submit.mockReturnValueOnce(Effect.void);
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

    submit.mockReturnValueOnce(Effect.void);
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
      .mockReturnValueOnce(Effect.void);
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

  it("reports a submission cleanup defect without refreshing or dropping its batch", async () => {
    const error = new AuthenticationRequired({ message: "expired" });
    const defect = new Error("submission cleanup failed");
    const logError = vi.spyOn(logger.main, "error");
    submit.mockReturnValueOnce(
      Effect.fail(error).pipe(Effect.ensuring(Effect.die(defect))),
    );
    authenticate("user-1");
    enqueue(activity(ids[0]));

    await vi.waitFor(() =>
      expect(logError).toHaveBeenCalledWith(
        "Activity reporting worker failed",
        {
          error,
          defects: [defect],
        },
      ),
    );
    expect(
      logError.mock.calls.filter(
        ([message]) => message === "Activity reporting worker failed",
      ),
    ).toHaveLength(1);
    expect(auth.refreshTokenIfNeeded).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledOnce();
    expect(await testDb.db.select().from(activityOutbox)).toHaveLength(1);
  });

  it("waits for account activation when its callback starts shutdown", async () => {
    let finishActivation!: () => void;
    let shutdown: Promise<void> | undefined;
    let stopped = false;
    vi.spyOn(
      activityStore,
      "activateActivityMaterializationAccount",
    ).mockImplementationOnce(() => {
      shutdown = Effect.runPromise(service.shutdown()).then(() => {
        stopped = true;
      });
      return new Promise<"resume">((resolve) => {
        finishActivation = () => resolve("resume");
      });
    });

    authenticate("user-1");
    await vi.waitFor(() => expect(shutdown).toBeDefined());
    await Promise.resolve();
    expect(stopped).toBe(false);

    finishActivation();
    await shutdown;
    expect(stopped).toBe(true);
    expect(submit).not.toHaveBeenCalled();
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

    submit.mockReturnValueOnce(Effect.void);
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
    submit.mockReturnValue(Effect.void);
    authenticate("user-1");
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0][0].activityId).toBe(ids[0]);
    expect(await testDb.db.select().from(activityOutbox)).toEqual([]);

    authenticate("user-2");
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][0][0].activityId).toBe(ids[0]);
  });

  it("preserves consumed activity flags when the same account restarts", async () => {
    await testDb.db.insert(transcriptions).values({
      sessionId: ids[0],
      disposition: "success",
      text: "already reported history",
    });
    submit.mockReturnValue(Effect.void);
    authenticate("user-1");
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    await vi.waitFor(async () => {
      expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
    });
    expect(await testDb.db.select().from(activityMaterializationState)).toEqual(
      [expect.objectContaining({ accountId: "user-1" })],
    );
    expect(await testDb.db.select().from(transcriptions)).toEqual([
      expect.objectContaining({ activityPending: false }),
    ]);

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

    submit.mockReturnValueOnce(Effect.void);
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
      .mockReturnValueOnce(Effect.void);

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
          return undefined;
        }),
      )
      .mockReturnValueOnce(Effect.void);

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
          Effect.andThen(
            Effect.fail(
              new AuthenticationRequired({ message: "stale account" }),
            ),
          ),
        ),
      )
      .mockReturnValueOnce(Effect.void);

    authenticate("user-1");
    enqueue(activity(ids[0]));

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(auth.refreshTokenIfNeeded).not.toHaveBeenCalled();
    await vi.waitFor(async () => {
      expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
    });
  });

  it("does not fetch summaries for startup, uploads, or empty wakes without a request", async () => {
    submit.mockReturnValue(Effect.void);
    authenticate("user-1");
    enqueue(activity());
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(testDb.db.select().from(activityOutbox).all()).toEqual([]),
    );
    service.wake();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(readSummary).not.toHaveBeenCalled();
  });

  it("preserves and coalesces refresh requests during account activation, including an empty drain", async () => {
    service.requestSummaryRefresh();
    service.requestSummaryRefresh();
    authenticate("user-1");
    await vi.waitFor(() =>
      expect(getLifetimeStats()).toEqual({
        totalWords: 12000,
        totalTranscriptions: 150,
      }),
    );
    expect(readSummary).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });

  it("waits for pending uploads before fetching a requested summary", async () => {
    let finishUpload!: () => void;
    submit.mockReturnValue(
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            finishUpload = resolve;
          }),
      ),
    );
    authenticate("user-1");
    service.requestSummaryRefresh();
    enqueue(activity());
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(readSummary).not.toHaveBeenCalled();
    finishUpload();
    await vi.waitFor(() => expect(getLifetimeStats()?.totalWords).toBe(12000));
    expect(testDb.db.select().from(activityOutbox).all()).toEqual([]);
  });

  it("does not fetch after failed uploads and preserves a newer request for another pass", async () => {
    let failUpload!: (error: unknown) => void;
    submit
      .mockReturnValueOnce(
        Effect.tryPromise({
          try: () =>
            new Promise<void>((_resolve, reject) => {
              failUpload = reject;
            }),
          catch: () =>
            new CloudNetworkFailure({ message: "offline", cause: undefined }),
        }),
      )
      .mockReturnValue(Effect.void);
    authenticate("user-1");
    service.requestSummaryRefresh();
    enqueue(activity());
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    service.requestSummaryRefresh();
    failUpload(new Error("offline"));
    await vi.waitFor(() => expect(getLifetimeStats()?.totalWords).toBe(12000));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(readSummary).toHaveBeenCalledOnce();
  });

  it("skips the GET when local totals change during the requested drain", async () => {
    let finishUpload!: () => void;
    submit.mockReturnValue(
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            finishUpload = resolve;
          }),
      ),
    );
    authenticate("user-1");
    await vi.waitFor(() =>
      expect(
        testDb.db.select().from(activityMaterializationState).get()?.accountId,
      ).toBe("user-1"),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const item = activity();
    testDb.db
      .insert(activityOutbox)
      .values({
        activityId: item.activityId,
        payload: item,
        createdAt: new Date(),
      })
      .run();
    service.requestSummaryRefresh();
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    db.transaction((tx) => incrementDictationStats(3, 1, tx));
    finishUpload();
    await vi.waitFor(() =>
      expect(testDb.db.select().from(activityOutbox).all()).toEqual([]),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(readSummary).not.toHaveBeenCalled();
    expect(getLifetimeStats()?.totalWords).toBe(3);
  });

  it("preserves local increments made during a summary GET", async () => {
    let finishSummary!: (value: typeof summary) => void;
    readSummary.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSummary = resolve;
        }),
    );
    authenticate("user-1");
    service.requestSummaryRefresh();
    await vi.waitFor(() => expect(readSummary).toHaveBeenCalledOnce());
    db.transaction((tx) => incrementDictationStats(3, 1, tx));
    finishSummary(summary);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getLifetimeStats()?.totalWords).toBe(3);
    expect(readSummary).toHaveBeenCalledOnce();
  });

  it("retains requests arriving during a summary GET for one later pass", async () => {
    let finishSummary!: (value: typeof summary) => void;
    readSummary.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSummary = resolve;
        }),
    );
    authenticate("user-1");
    service.requestSummaryRefresh();
    await vi.waitFor(() => expect(readSummary).toHaveBeenCalledOnce());
    service.requestSummaryRefresh();
    service.requestSummaryRefresh();
    finishSummary(summary);
    await vi.waitFor(() => expect(readSummary).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(readSummary).toHaveBeenCalledTimes(2);
  });

  it("keeps summary authentication failures separate from uploader authorization", async () => {
    readSummary.mockRejectedValueOnce(
      new AuthenticationRequired({ message: "summary unauthorized" }),
    );
    authenticate("user-1");
    service.requestSummaryRefresh();
    await vi.waitFor(() => expect(readSummary).toHaveBeenCalledOnce());
    submit.mockReturnValue(Effect.void);
    enqueue(activity());
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(readSummary).toHaveBeenCalledOnce();
    service.requestSummaryRefresh();
    await vi.waitFor(() => expect(getLifetimeStats()?.totalWords).toBe(12000));
  });

  it.each(["logout", "shutdown", "account switch"])(
    "aborts a summary on %s and ignores its late result",
    async (boundary) => {
      let finishSummary!: (value: typeof summary) => void;
      let signal: AbortSignal | undefined;
      readSummary.mockImplementationOnce((_auth, _id, requestSignal) => {
        signal = requestSignal;
        return new Promise((resolve) => {
          finishSummary = resolve;
        });
      });
      authenticate("user-1");
      service.requestSummaryRefresh();
      await vi.waitFor(() => expect(signal).toBeDefined());
      if (boundary === "logout") await auth.runBeforeLogoutHandlers();
      else if (boundary === "shutdown")
        await Effect.runPromise(service.shutdown());
      else authenticate("user-2");
      await vi.waitFor(() => expect(signal?.aborted).toBe(true));
      finishSummary(summary);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(
        testDb.db
          .select()
          .from(dictationStats)
          .where(eq(dictationStats.scope, "account:user-1"))
          .get(),
      ).toBeUndefined();
    },
  );

  describe("summary scheduling", () => {
    beforeEach(async () => {
      await Effect.runPromise(service.shutdown());
      vi.useFakeTimers();
      await Effect.runPromise(service.initialize());
    });

    it("fetches hourly without History, and never while signed out", async () => {
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(readSummary).not.toHaveBeenCalled();
      authenticate("user-1");
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(3_599_999);
      expect(readSummary).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(readSummary).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(readSummary).toHaveBeenCalledTimes(2);
    });

    it("refreshes on opening, uses fresh short jitter, and returns to hourly on closing", async () => {
      const random = vi.spyOn(Math, "random").mockReturnValue(0);
      authenticate("user-1");
      await vi.advanceTimersByTimeAsync(0);
      const close = service.watchSummary();
      service.requestSummaryRefresh();
      await vi.advanceTimersByTimeAsync(0);
      expect(readSummary).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(readSummary).toHaveBeenCalledTimes(1);
      random.mockReturnValue(0.999);
      await vi.advanceTimersByTimeAsync(1000);
      expect(readSummary).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(359_999);
      expect(readSummary).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(readSummary).toHaveBeenCalledTimes(3);
      close();
      await vi.advanceTimersByTimeAsync(3_599_999);
      expect(readSummary).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(readSummary).toHaveBeenCalledTimes(4);
    });

    it("keeps the short cadence until the last visible subscription closes", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      authenticate("user-1");
      await vi.advanceTimersByTimeAsync(0);
      const closeFirst = service.watchSummary();
      const closeSecond = service.watchSummary();
      await vi.advanceTimersByTimeAsync(0);
      expect(readSummary).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100_000);
      closeFirst();
      closeFirst();
      await vi.advanceTimersByTimeAsync(201_000);
      expect(readSummary).toHaveBeenCalledTimes(1);
      closeSecond();
      await vi.advanceTimersByTimeAsync(301_000);
      expect(readSummary).toHaveBeenCalledTimes(1);
    });

    it("keeps the visible cadence across account changes", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const close = service.watchSummary();
      service.requestSummaryRefresh();
      authenticate("user-1");
      await vi.advanceTimersByTimeAsync(0);
      expect(readSummary).toHaveBeenCalledTimes(1);
      authenticate("user-2");
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(301_000);
      expect(readSummary).toHaveBeenCalledTimes(2);
      expect(readSummary.mock.lastCall![1]).toBe("user-2");
      close();
      await vi.advanceTimersByTimeAsync(3_599_999);
      expect(readSummary).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(readSummary).toHaveBeenCalledTimes(3);
      expect(readSummary.mock.lastCall![1]).toBe("user-2");
    });

    it("refreshes the current account after switching accounts", async () => {
      authenticate("user-1");
      await vi.advanceTimersByTimeAsync(0);
      authenticate("user-2");
      service.requestSummaryRefresh();
      await vi.advanceTimersByTimeAsync(0);
      expect(readSummary).toHaveBeenCalledTimes(1);
      expect(readSummary.mock.lastCall![1]).toBe("user-2");
      expect(getLifetimeStats()?.totalWords).toBe(12000);
    });

    it.each(["logout", "shutdown"])(
      "stops scheduling on %s",
      async (boundary) => {
        authenticate("user-1");
        await vi.advanceTimersByTimeAsync(0);
        if (boundary === "logout") await auth.runBeforeLogoutHandlers();
        else await Effect.runPromise(service.shutdown());
        await vi.advanceTimersByTimeAsync(7_200_000);
        expect(readSummary).not.toHaveBeenCalled();
      },
    );

    it("does not interrupt an active refresh when the cadence changes", async () => {
      let finishSummary!: (value: typeof summary) => void;
      let signal: AbortSignal | undefined;
      readSummary.mockImplementationOnce((_auth, _id, requestSignal) => {
        signal = requestSignal;
        return new Promise((resolve) => {
          finishSummary = resolve;
        });
      });
      authenticate("user-1");
      await vi.advanceTimersByTimeAsync(0);
      const close = service.watchSummary();
      service.requestSummaryRefresh();
      await vi.advanceTimersByTimeAsync(0);
      expect(readSummary).toHaveBeenCalledTimes(1);
      close();
      expect(signal?.aborted).toBe(false);
      finishSummary(summary);
      await vi.advanceTimersByTimeAsync(0);
      expect(getLifetimeStats()?.totalWords).toBe(12000);
    });

    it("changes cadence on hide and restore without requesting an immediate refresh", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      authenticate("user-1");
      await vi.advanceTimersByTimeAsync(0);
      const hide = service.watchSummary();
      service.requestSummaryRefresh();
      await vi.advanceTimersByTimeAsync(0);
      expect(readSummary).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(100_000);
      hide();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(readSummary).toHaveBeenCalledTimes(1);
      service.watchSummary();
      await vi.advanceTimersByTimeAsync(300_999);
      expect(readSummary).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(readSummary).toHaveBeenCalledTimes(2);
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
