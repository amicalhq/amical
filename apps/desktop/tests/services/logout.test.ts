import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "electron";
import { Effect } from "effect";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";
import { AuthService } from "../../src/services/auth-service";
import {
  getLogoutStatus,
  logoutAndClearUserData,
  syncBeforeLogout,
} from "../../src/services/logout";
import {
  getSettingsSection,
  updateSettingsSection,
} from "../../src/db/app-settings";
import { beginUserSyncSession, pauseSyncSession } from "../../src/db/sync";
import { createNote } from "../../src/db/notes";
import { saveNoteBody } from "../../src/db/note-body";
import { createSnippet } from "../../src/db/snippets";
import { createVocabularyWord } from "../../src/db/vocabulary";
import { hasPendingUserData } from "../../src/db/user-data";
import * as schema from "../../src/db/schema";

const { deleteAudio } = vi.hoisted(() => ({
  deleteAudio: vi.fn(async () => 0),
}));
vi.mock("../../src/utils/audio-file-cleanup", () => ({
  deleteAudioFilesForTranscriptions: deleteAudio,
}));

describe("logout sync and restart", () => {
  let testDb: TestDatabase;
  let auth: AuthService;
  let services: Parameters<typeof syncBeforeLogout>[0];
  const sync = vi.fn<() => Effect.Effect<void, Error>>(() => Effect.void);
  const activity = vi.fn<() => Effect.Effect<void, Error>>(() => Effect.void);
  const packaged = app.isPackaged;

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
    pauseSyncSession();
    auth = AuthService.createForTests();
    auth.registerBeforeLogoutHandler(() => Effect.sync(pauseSyncSession));
    await updateSettingsSection("auth", {
      isAuthenticated: true,
      idToken: "token",
      accessToken: "token",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3_600_000,
      userInfo: { sub: "alice" },
    });
    await beginUserSyncSession("alice");
    sync.mockReset().mockReturnValue(Effect.void);
    activity.mockReset().mockReturnValue(Effect.void);
    services = {
      authService: auth,
      settingsSyncService: { flush: sync },
      activityReportingService: { flush: activity },
    } as unknown as typeof services;
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    Object.defineProperty(app, "isPackaged", {
      value: packaged,
      configurable: true,
    });
    pauseSyncSession();
    await Effect.runPromise(auth.shutdown());
    await testDb.close();
  });

  it("checks persisted pending data without waiting for uploads", async () => {
    expect(getLogoutStatus()).toEqual({ hasPendingChanges: false });
    await createNote({ title: "Pending upload" });
    expect(getLogoutStatus()).toEqual({ hasPendingChanges: true });
    expect(sync).not.toHaveBeenCalled();
    expect(activity).not.toHaveBeenCalled();
  });

  it("uploads pending data and reports completion without logging out", async () => {
    await createNote({ title: "Pending upload" });
    sync.mockReturnValue(
      Effect.sync(() => {
        testDb.db.delete(schema.syncOutbox).run();
      }),
    );
    expect(await syncBeforeLogout(services)).toEqual({ synced: true });
    expect(sync).toHaveBeenCalledOnce();
    expect(activity).toHaveBeenCalledOnce();
    expect((await getSettingsSection("auth"))?.isAuthenticated).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("reports unsynced changes after an upload failure without clearing data", async () => {
    const note = await createNote({ title: "Offline note" });
    sync.mockReturnValue(Effect.fail(new Error("offline")));
    expect(await syncBeforeLogout(services)).toEqual({ synced: false });
    expect(testDb.db.select().from(schema.notes).get()?.id).toBe(note.id);
    expect((await getSettingsSection("auth"))?.isAuthenticated).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("keeps blocked uploads pending even when workers finish", async () => {
    await createNote({ title: "Blocked" });
    testDb.db
      .update(schema.syncOutbox)
      .set({ blockedReason: "too large" })
      .run();
    expect(await syncBeforeLogout(services)).toEqual({ synced: false });
  });

  it("starts both outbox flushes immediately under one 15-second deadline", async () => {
    await createNote({ title: "Pending" });
    vi.useFakeTimers();
    const started = vi.fn();
    sync.mockReturnValue(
      Effect.sync(() => started("settings")).pipe(Effect.andThen(Effect.never)),
    );
    activity.mockReturnValue(
      Effect.sync(() => started("activity")).pipe(Effect.andThen(Effect.never)),
    );
    const finished = vi.fn();
    const attempt = syncBeforeLogout(services).then(finished);
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveBeenCalledWith("settings");
    expect(started).toHaveBeenCalledWith("activity");
    await vi.advanceTimersByTimeAsync(14_999);
    expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await attempt;
    expect(finished).toHaveBeenCalledWith({ synced: false });
    expect(hasPendingUserData()).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("does not block new edits while syncing for logout", async () => {
    await createNote({ title: "First" });
    const upload = Promise.withResolvers<void>();
    sync.mockReturnValue(Effect.promise(() => upload.promise));
    const attempt = syncBeforeLogout(services);
    await vi.waitFor(() => expect(sync).toHaveBeenCalled());
    await expect(
      createNote({ title: "Still editable" }),
    ).resolves.toBeDefined();
    upload.resolve();
    expect(await attempt).toEqual({ synced: false });
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("reports success at the deadline if uploads finished but a later sync step stalled", async () => {
    await createNote({ title: "Uploaded" });
    vi.useFakeTimers();
    sync.mockReturnValue(
      Effect.sync(() => {
        testDb.db.delete(schema.syncOutbox).run();
      }).pipe(Effect.andThen(Effect.never)),
    );

    const attempt = syncBeforeLogout(services);
    await vi.advanceTimersByTimeAsync(15_000);

    expect(await attempt).toEqual({ synced: true });
    expect(hasPendingUserData()).toBe(false);
    expect(app.quit).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "restarts after clearing the account (packaged: %s)",
    async (isPackaged) => {
      Object.defineProperty(app, "isPackaged", {
        value: isPackaged,
        configurable: true,
      });
      vi.stubEnv("NODE_ENV", "production");
      expect(await logoutAndClearUserData(services)).toEqual({ success: true });
      expect(await getSettingsSection("auth")).toBeUndefined();
      expect(app.relaunch).toHaveBeenCalledTimes(isPackaged ? 1 : 0);
      expect(app.quit).toHaveBeenCalledOnce();
      expect(sync).not.toHaveBeenCalled();
      expect(activity).not.toHaveBeenCalled();
    },
  );

  it("clears pending local user data on confirmation and preserves device configuration", async () => {
    const recording = {
      defaultFormat: "wav" as const,
      sampleRate: 16000 as const,
      autoStopSilence: false,
      silenceThreshold: 0.1,
      maxRecordingDuration: 60,
      microphonePriority: [{ deviceId: "elgato", name: "Elgato" }],
    };
    await updateSettingsSection("recording", recording);
    const beforeSettings = (
      await testDb.db.select().from(schema.appSettings)
    )[0].data;
    await createVocabularyWord({ word: "Amical" });
    await createSnippet({ trigger: "sig", content: "Regards" });
    const note = await createNote({ title: "Notes" });
    saveNoteBody(note.id, "saved text");
    testDb.db
      .insert(schema.yjsUpdates)
      .values({ noteId: note.id, updateData: Buffer.from("backup") })
      .run();
    const [history] = testDb.db
      .insert(schema.transcriptions)
      .values({
        text: "local history",
        disposition: "success",
        audioFile: "/tmp/amical-audio/audio-logout.wav",
      })
      .returning()
      .all();
    testDb.db
      .insert(schema.activityMaterializationState)
      .values({ id: 1, accountId: "alice" })
      .run();
    testDb.db
      .insert(schema.dictationStats)
      .values({ scope: "account:alice", totalWords: 10 })
      .run();
    testDb.db
      .insert(schema.dailyStatsBackup)
      .values({
        id: "backup",
        date: "2026-09-18",
        wordCount: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    testDb.db
      .insert(schema.models)
      .values({
        id: "local",
        providerType: "local-whisper",
        providerInstanceId: "local",
        provider: "Whisper",
        name: "Downloaded model",
        type: "speech",
        localPath: "/models/local.bin",
      })
      .run();
    const models = testDb.db.select().from(schema.models).all();
    const skills = testDb.db.select().from(schema.skills).all();

    expect(await logoutAndClearUserData(services)).toEqual({ success: true });

    for (const table of [
      schema.transcriptions,
      schema.dictationStats,
      schema.dailyStatsBackup,
      schema.notes,
      schema.yjsUpdates,
      schema.vocabulary,
      schema.snippets,
      schema.syncOutbox,
      schema.syncItemState,
      schema.syncCollectionState,
      schema.syncScopeState,
      schema.syncClientState,
      schema.activityOutbox,
      schema.activityMaterializationState,
    ]) {
      expect(testDb.db.select().from(table).all()).toEqual([]);
    }
    const settings = {
      ...testDb.db.select().from(schema.appSettings).get()!.data,
    };
    const expectedSettings = { ...beforeSettings };
    delete settings.auth;
    delete expectedSettings.auth;
    expect(settings).toEqual(expectedSettings);
    expect(testDb.db.select().from(schema.models).all()).toEqual(models);
    expect(testDb.db.select().from(schema.skills).all()).toEqual(skills);
    expect(await getSettingsSection("auth")).toBeUndefined();
    expect(deleteAudio).toHaveBeenCalledWith([
      { id: history.id, audioFile: history.audioFile },
    ]);
    expect(sync).not.toHaveBeenCalled();
    expect(app.quit).toHaveBeenCalledOnce();
  });

  it.each(["notes", "app_settings"])(
    "retains the database and account if %s fails",
    async (table) => {
      await createNote({ title: "Keep me" });
      testDb.db.delete(schema.syncOutbox).run();
      testDb.db.run(
        table === "notes"
          ? sql`CREATE TRIGGER fail_logout BEFORE DELETE ON notes BEGIN SELECT RAISE(ABORT, 'disk failure'); END`
          : sql`CREATE TRIGGER fail_logout BEFORE UPDATE ON app_settings BEGIN SELECT RAISE(ABORT, 'disk failure'); END`,
      );
      await expect(logoutAndClearUserData(services)).rejects.toThrow(
        "disk failure",
      );
      expect(testDb.db.select().from(schema.notes).get()?.title).toBe(
        "Keep me",
      );
      expect(testDb.db.select().from(schema.syncItemState).all()).toHaveLength(
        1,
      );
      expect((await getSettingsSection("auth"))?.userInfo?.sub).toBe("alice");
      expect(app.quit).not.toHaveBeenCalled();
      expect(app.relaunch).not.toHaveBeenCalled();
    },
  );

  it("preserves the owner and queued edits on credential expiry", async () => {
    await createVocabularyWord({ word: "Before expiry" });
    await Effect.runPromise(auth.logout(true));
    const word = await createVocabularyWord({ word: "After expiry" });
    const note = await createNote({ title: "After expiry" });
    expect(note.accountId).toBe("alice");
    expect(testDb.db.select().from(schema.syncOutbox).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ syncId: word.id, scopeId: "alice" }),
        expect.objectContaining({ syncId: note.id, scopeId: "alice" }),
      ]),
    );
    expect((await getSettingsSection("auth"))?.isAuthenticated).toBe(false);
    expect(hasPendingUserData()).toBe(true);
  });

  it.each(["note", "recording"])(
    "warns about unfinished %s recovery without treating reported history as pending",
    async (kind) => {
      testDb.db
        .insert(schema.transcriptions)
        .values({
          text: "already reported",
          disposition: "success",
          activityPending: false,
        })
        .run();
      expect(hasPendingUserData()).toBe(false);
      if (kind === "note") {
        testDb.db
          .insert(schema.notes)
          .values({
            title: "Recovery needed",
            contentFormat: "blocked",
            accountId: "alice",
          })
          .run();
      } else {
        testDb.db
          .insert(schema.transcriptions)
          .values({
            sessionId: "failed-commit",
            text: "",
            disposition: null,
            audioFile: "/audio/recoverable.wav",
          })
          .run();
      }
      expect(hasPendingUserData()).toBe(true);
      expect(getLogoutStatus()).toEqual({ hasPendingChanges: true });
      expect((await getSettingsSection("auth"))?.isAuthenticated).toBe(true);
    },
  );

  it.each(["vocabulary", "snippet"])(
    "warns for guest %s before login adoption runs",
    async (collection) => {
      if (collection === "vocabulary")
        testDb.db
          .insert(schema.vocabulary)
          .values({ word: "Guest word" })
          .run();
      else
        testDb.db
          .insert(schema.snippets)
          .values({ trigger: "guest", content: "Guest snippet" })
          .run();
      expect(testDb.db.select().from(schema.syncOutbox).all()).toEqual([]);
      expect(getLogoutStatus()).toEqual({ hasPendingChanges: true });
      expect(hasPendingUserData()).toBe(true);
    },
  );
});
