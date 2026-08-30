import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  activateActivityMaterializationAccount,
  captureActivityRows,
  materializeCompletedDictationActivity,
  materializeCompletedDictationActivities,
} from "../../src/db/activity-outbox";
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
import { createStorageAdapter } from "../../src/main/lifecycle/adapters/storage";
import { transcriptionActivityModel } from "../../src/types/activity";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("activity durable outbox", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("materializes normalized immutable metadata after successful completion", async () => {
    await createProvisionalTranscription({ sessionId: SESSION_ID });
    await enrichTranscriptionBySession(SESSION_ID, {
      audioDurationMs: 2_048,
      metaPatch: {
        activity: {
          wordCount: 3,
          appType: "  EMail  ",
          skills: [
            { kind: "preset", presetId: "instruct" },
            { kind: "custom" },
          ],
          transcription: transcriptionActivityModel("whisper-tiny", false),
          formatting: null,
        },
      },
    });

    await stampTranscriptionDisposition(SESSION_ID, {
      disposition: "success",
      text: "three canonical words",
    });

    expect(await testDb.db.select().from(activityOutbox)).toEqual([]);
    await materializeCompletedDictationActivities(500, testDb.db as never);
    const rows = await captureActivityRows(500, testDb.db as never);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      activityId: SESSION_ID,
      payload: {
        activityId: SESSION_ID,
        wordCount: 3,
        audioDurationMs: 2_048,
        appType: "email",
        skills: [{ kind: "preset", presetId: "instruct" }, { kind: "custom" }],
        formatting: null,
      },
    });

    await stampTranscriptionDisposition(SESSION_ID, {
      disposition: "success",
      text: "changed",
    });
    await materializeCompletedDictationActivities(500, testDb.db as never);
    expect(await testDb.db.select().from(activityOutbox)).toHaveLength(1);
  });

  it("materializes a device-global row without an authenticated account", async () => {
    await createProvisionalTranscription({ sessionId: SESSION_ID });
    await enrichTranscriptionBySession(SESSION_ID, {
      audioDurationMs: 1_000,
      metaPatch: {
        activity: {
          wordCount: 1,
          appType: "default",
          skills: null,
          transcription: transcriptionActivityModel("whisper-tiny", false),
          formatting: null,
        },
      },
    });
    await stampTranscriptionDisposition(SESSION_ID, {
      disposition: "success",
      text: "hello",
    });
    await materializeCompletedDictationActivities(500, testDb.db as never);

    expect(await captureActivityRows(500, testDb.db as never)).toEqual([
      expect.objectContaining({ activityId: SESSION_ID }),
    ]);
  });

  it("uses the finalized text count and captured audio duration", async () => {
    const facts: string[] = [];
    const adapter = createStorageAdapter((fact) => facts.push(fact.type), {
      awaitCustodySettled: async () => ({
        audioFile: null,
        wavOk: true,
        audioDurationMs: 2_048,
      }),
      completionMetaFor: () => ({
        activity: {
          wordCount: 1,
          appType: "default",
          skills: [],
          transcription: transcriptionActivityModel("whisper-tiny", false),
          formatting: null,
        },
      }),
    });
    await createProvisionalTranscription({ sessionId: SESSION_ID });

    adapter.commit(SESSION_ID, {
      kind: "success",
      text: "three finalized words",
    });
    await vi.waitFor(() => expect(facts).toContain("storageFinished"));
    await materializeCompletedDictationActivities(500, testDb.db as never);

    const rows = await captureActivityRows(500, testDb.db as never);
    expect(rows[0]?.payload).toMatchObject({
      wordCount: 3,
      audioDurationMs: 2_048,
      skills: [],
    });
  });

  it("preserves complete Amical Cloud model metadata", async () => {
    await createProvisionalTranscription({ sessionId: SESSION_ID });
    await enrichTranscriptionBySession(SESSION_ID, {
      audioDurationMs: 1_500,
      metaPatch: {
        activity: {
          wordCount: 2,
          appType: "document",
          skills: [{ kind: "preset", presetId: "instruct" }],
          transcription: transcriptionActivityModel("amical-cloud", true),
          formatting: transcriptionActivityModel("amical-cloud", true),
        },
      },
    });
    await stampTranscriptionDisposition(SESSION_ID, {
      disposition: "success",
      text: "cloud words",
    });

    await materializeCompletedDictationActivities(500, testDb.db as never);
    const [row] = await captureActivityRows(500, testDb.db as never);
    expect(row?.payload).toMatchObject({
      transcription: {
        provider: "amical",
        model: "amical-cloud",
        execution: "amical_cloud",
      },
      formatting: {
        provider: "amical",
        model: "amical-cloud",
        execution: "amical_cloud",
      },
    });
  });

  it("backfills unavailable metadata as null without using generic duration", async () => {
    const occurredAt = new Date("2024-01-02T03:04:05.000Z");
    const legacyTimestamp = new Date("2024-02-03T04:05:06.000Z");
    await testDb.db.insert(transcriptions).values({
      sessionId: null,
      disposition: "success",
      text: "legacy canonical words",
      timestamp: legacyTimestamp,
      duration: 999,
      audioDurationMs: null,
      meta: null,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });

    await materializeCompletedDictationActivities(500, testDb.db as never);
    const rows = await captureActivityRows(500, testDb.db as never);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toMatchObject({
      occurredAt: occurredAt.toISOString(),
      wordCount: 3,
      audioDurationMs: null,
      appType: null,
      skills: null,
      transcription: null,
      formatting: null,
    });
    expect(rows[0]?.activityId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect((await testDb.db.select().from(transcriptions))[0]?.sessionId).toBe(
      rows[0]?.activityId,
    );
  });

  it("backfills unambiguous stored model metadata", async () => {
    await testDb.db.insert(transcriptions).values({
      disposition: "success",
      text: "legacy model metadata",
      speechModel: "whisper-base",
      formattingModel: "system-amical::speech::amical-cloud",
      meta: null,
    });

    await materializeCompletedDictationActivities(500, testDb.db as never);
    const [row] = await captureActivityRows(500, testDb.db as never);
    expect(row?.payload).toMatchObject({
      transcription: {
        provider: "whisper-cpp",
        model: "whisper-base",
        execution: "local",
      },
      formatting: {
        provider: "amical",
        model: "amical-cloud",
        execution: "amical_cloud",
      },
    });
  });

  it("advances the cursor with the outbox insert and never regenerates an activity", async () => {
    const occurredAt = new Date("2024-01-02T03:04:05.000Z");
    const inserted = await testDb.db
      .insert(transcriptions)
      .values({
        disposition: "success",
        text: "once only",
        timestamp: occurredAt,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      })
      .returning();

    await materializeCompletedDictationActivities(500, testDb.db as never);
    const [first] = await testDb.db.select().from(activityOutbox);
    expect(first).toBeDefined();
    expect(await testDb.db.select().from(activityMaterializationState)).toEqual(
      [expect.objectContaining({ transcriptionCursor: inserted[0]!.id })],
    );

    await testDb.db.delete(activityOutbox);
    await materializeCompletedDictationActivities(500, testDb.db as never);
    expect(await testDb.db.select().from(activityOutbox)).toEqual([]);

    await activateActivityMaterializationAccount(
      "replay-user",
      testDb.db as never,
    );
    await materializeCompletedDictationActivities(500, testDb.db as never);
    expect(await testDb.db.select().from(activityOutbox)).toEqual([
      expect.objectContaining({ activityId: first!.activityId }),
    ]);
  });

  it("rolls back the cursor when the outbox insert fails", async () => {
    await testDb.db.insert(transcriptions).values({
      sessionId: SESSION_ID,
      disposition: "success",
      text: "retry me",
    });
    testDb.db.$client.exec(`
      CREATE TRIGGER fail_activity_outbox_insert
      BEFORE INSERT ON activity_outbox
      BEGIN
        SELECT RAISE(ABORT, 'simulated insert failure');
      END;
    `);

    await expect(
      materializeCompletedDictationActivities(500, testDb.db as never),
    ).rejects.toThrow("simulated insert failure");
    expect(await testDb.db.select().from(activityMaterializationState)).toEqual(
      [],
    );

    testDb.db.$client.exec("DROP TRIGGER fail_activity_outbox_insert");
    await materializeCompletedDictationActivities(500, testDb.db as never);
    expect(await testDb.db.select().from(activityOutbox)).toHaveLength(1);
  });

  it("keeps all newly materialized ranges in the same device outbox", async () => {
    await testDb.db.insert(transcriptions).values({
      sessionId: SESSION_ID,
      disposition: "success",
      text: "first account",
    });
    await materializeCompletedDictationActivities(500, testDb.db as never);

    const secondId = "22222222-2222-4222-8222-222222222222";
    await testDb.db.insert(transcriptions).values({
      sessionId: secondId,
      disposition: "success",
      text: "second account",
    });
    await materializeCompletedDictationActivities(500, testDb.db as never);

    expect(
      (await testDb.db.select().from(activityOutbox)).map(
        (row) => row.activityId,
      ),
    ).toEqual([SESSION_ID, secondId]);
  });

  it("resumes the cursor for the same account and resets it for a new account", async () => {
    expect(
      await activateActivityMaterializationAccount(
        "user-1",
        testDb.db as never,
      ),
    ).toBe("replay");
    await testDb.db
      .update(activityMaterializationState)
      .set({ transcriptionCursor: 42 });

    expect(
      await activateActivityMaterializationAccount(
        "user-1",
        testDb.db as never,
      ),
    ).toBe("resume");
    expect(await testDb.db.select().from(activityMaterializationState)).toEqual(
      [
        expect.objectContaining({
          accountId: "user-1",
          transcriptionCursor: 42,
        }),
      ],
    );

    expect(
      await activateActivityMaterializationAccount(
        "user-2",
        testDb.db as never,
      ),
    ).toBe("replay");
    expect(await testDb.db.select().from(activityMaterializationState)).toEqual(
      [
        expect.objectContaining({
          accountId: "user-2",
          transcriptionCursor: 0,
        }),
      ],
    );
  });

  it("materializes a later settlement directly without rewinding the cursor", async () => {
    await createProvisionalTranscription({ sessionId: SESSION_ID });
    const laterId = "22222222-2222-4222-8222-222222222222";
    const [later] = await testDb.db
      .insert(transcriptions)
      .values({
        sessionId: laterId,
        disposition: "success",
        text: "later success",
      })
      .returning();

    const skipped = await materializeCompletedDictationActivities(
      500,
      testDb.db as never,
    );
    expect(skipped).toMatchObject({ advanced: true, enqueued: 1, scanned: 2 });
    expect(
      (await testDb.db.select().from(activityOutbox)).map(
        (row) => row.activityId,
      ),
    ).toEqual([laterId]);

    const settled = await stampTranscriptionDisposition(SESSION_ID, {
      disposition: "success",
      text: "first success",
    });
    await materializeCompletedDictationActivity(
      settled!.id,
      testDb.db as never,
    );
    expect(
      (await testDb.db.select().from(activityOutbox)).map(
        (row) => row.activityId,
      ),
    ).toEqual([laterId, SESSION_ID]);
    expect(await testDb.db.select().from(activityMaterializationState)).toEqual(
      [expect.objectContaining({ transcriptionCursor: later!.id })],
    );
  });
});
