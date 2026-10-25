import { EventEmitter } from "node:events";
import type { ReadEditWatchResult, StartEditWatchResult } from "@amical/types";
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

import { vocabulary } from "../../../src/db/schema";
import { pauseSyncSession } from "../../../src/db/sync";
import {
  createProvisionalTranscription,
  enrichTranscriptionBySession,
  stampTranscriptionDisposition,
} from "../../../src/db/transcriptions";
import type { LifecycleSnapshot } from "../../../src/main/lifecycle/shell";
import type { LifecycleSessionMeta } from "../../../src/main/lifecycle/metadata";
import type { PublicState } from "../../../src/main/lifecycle/projection";
import { NativeBridgeTimeoutError } from "../../../src/services/platform/native-bridge-service";
import { DESKTOP_AUTO_VOCABULARY_FLAG } from "../../../src/services/remote-config-service";
import { vocabularyLearningNotifications } from "../../../src/services/vocabulary-learning/notifications";
import { VocabularyTermCheckContractFailure } from "../../../src/services/vocabulary-learning/term-check-client";
import {
  VocabularyLearningService,
  type LearningTimers,
  type VocabularyLearningServiceDeps,
} from "../../../src/services/vocabulary-learning/service";
import { CloudNetworkFailure } from "../../../src/types/errors/cloud-request";
import type { WidgetNotification } from "../../../src/types/widget-notification";
import { createTestDatabase, type TestDatabase } from "../../helpers/test-db";
import { setTestDatabase } from "../../setup";

type Snapshot = LifecycleSnapshot<LifecycleSessionMeta>;

const PASTED = "open cloud code and run it";
const EDITED = "open Claude Code and run it";
const DAY_MS = 24 * 60 * 60 * 1000;

const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

class FakeClock implements LearningTimers {
  private t = 0;
  private timers: { at: number; cb: () => void; cancelled: boolean }[] = [];

  now = () => this.t;

  setTimer = (ms: number, cb: () => void) => {
    const timer = { at: this.t + ms, cb, cancelled: false };
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.cancelled = true;
      },
    };
  };

  /** Run due timers in order, letting async work settle after each. */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      const due = this.timers
        .filter((timer) => !timer.cancelled && timer.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.t = due.at;
      due.cb();
      await settle();
    }
    this.t = target;
    await settle();
  }
}

class FakeLifecycle {
  private pasteListeners = new Set<(session: string, text: string) => void>();
  private otherPasteListeners = new Set<() => void>();
  private snapshotListeners = new Set<(snapshot: Snapshot) => void>();
  private snapshot: Snapshot = {
    sessionId: null,
    projection: {
      publicState: "idle",
      stopKind: "none",
      stopOrigin: "none",
      terminal: null,
    },
    metadata: null,
  };

  onSessionPasteConfirmed = (
    listener: (session: string, text: string) => void,
  ) => {
    this.pasteListeners.add(listener);
    return () => this.pasteListeners.delete(listener);
  };
  onOtherPaste = (listener: () => void) => {
    this.otherPasteListeners.add(listener);
    return () => this.otherPasteListeners.delete(listener);
  };
  onSnapshot = (listener: (snapshot: Snapshot) => void) => {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;

  publish(sessionId: string | null, publicState: PublicState): void {
    this.snapshot = {
      ...this.snapshot,
      sessionId,
      projection: { ...this.snapshot.projection, publicState },
    };
    for (const listener of this.snapshotListeners) listener(this.snapshot);
  }
  pasteConfirmed(session: string, text: string): void {
    for (const listener of this.pasteListeners) listener(session, text);
  }
  otherPaste(): void {
    for (const listener of this.otherPasteListeners) listener();
  }
  /** A session that started and settled, so the paste answer can follow. */
  session(sessionId: string): void {
    this.publish(sessionId, "starting");
    this.publish(sessionId, "recording");
    this.publish(null, "idle");
  }
}

class FakeBridge extends EventEmitter {
  fieldText = PASTED;
  startEditWatch = vi.fn(
    async (): Promise<StartEditWatchResult> => ({
      watchId: "w1",
      startStatus: "ok",
    }),
  );
  readEditWatch = vi.fn(
    async (): Promise<ReadEditWatchResult> => ({
      readStatus: "ok",
      text: this.fieldText,
      selection: { location: this.fieldText.length, length: 0 },
      readMs: 2,
    }),
  );
  stopEditWatch = vi.fn(async () => {});
  getAccessibilityContext = () => null;
}

async function committedRow(sessionId: string, speechModel: string) {
  await createProvisionalTranscription({ sessionId });
  await enrichTranscriptionBySession(sessionId, {
    speechModel,
    detectedLanguage: "en",
  });
  await stampTranscriptionDisposition(sessionId, {
    disposition: "success",
    text: PASTED,
  });
}

describe("VocabularyLearningService", () => {
  let testDb: TestDatabase;
  let clock: FakeClock;
  let lifecycle: FakeLifecycle;
  let bridge: FakeBridge;
  let classify: Mock<VocabularyLearningServiceDeps["client"]["classify"]>;
  let track: Mock<
    VocabularyLearningServiceDeps["telemetry"]["trackVocabularyEditWatchCompleted"]
  >;
  let flagOn: boolean;
  let service: VocabularyLearningService;
  let toasts: WidgetNotification[];
  let unsubscribeToasts: () => void;

  beforeEach(async () => {
    pauseSyncSession();
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
    clock = new FakeClock();
    lifecycle = new FakeLifecycle();
    bridge = new FakeBridge();
    classify = vi.fn(() => Effect.succeed({ accepted: ["Claude Code"] }));
    track = vi.fn();
    flagOn = true;
    toasts = [];
    unsubscribeToasts = vocabularyLearningNotifications.onLearned((toast) =>
      toasts.push(toast),
    );
    service = new VocabularyLearningService({
      bridge: bridge as unknown as VocabularyLearningServiceDeps["bridge"],
      lifecycle:
        lifecycle as unknown as VocabularyLearningServiceDeps["lifecycle"],
      remoteConfig: {
        getConfig: () =>
          ({
            flags: { [DESKTOP_AUTO_VOCABULARY_FLAG]: flagOn },
          }) as never,
      },
      telemetry: { trackVocabularyEditWatchCompleted: track },
      client: { classify },
      platform: "darwin",
      timers: clock,
    });
    service.initialize();
  });

  afterEach(async () => {
    service.shutdown();
    unsubscribeToasts();
    await testDb.close();
  });

  /** Paste, locate, two equal edited reads, then the next session ends it. */
  async function runCorrectedWatch(session: string, next: string) {
    lifecycle.session(session);
    bridge.fieldText = PASTED;
    lifecycle.pasteConfirmed(session, PASTED);
    await settle();
    await clock.advance(250);
    bridge.fieldText = EDITED;
    await clock.advance(1000);
    await clock.advance(1000);
    lifecycle.publish(next, "starting");
    await settle();
  }

  it("learns the corrected term and shows the toast once the lifecycle is idle", async () => {
    await committedRow("s1", "amical-cloud");

    await runCorrectedWatch("s1", "s2");

    expect(bridge.startEditWatch).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledWith({
      candidates: [{ term: "Claude Code", heard: "cloud code" }],
      language: "en",
    });
    const rows = testDb.db.select().from(vocabulary).all();
    expect(rows).toEqual([
      expect.objectContaining({
        word: "Claude Code",
        source: "auto",
        observedSource: "cloud code",
      }),
    ]);
    expect(bridge.stopEditWatch).toHaveBeenCalledWith("w1");
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({
        start_status: "ok",
        end_reason: "superseded",
        app_type: "default",
        changed: true,
        key_events_seen: false,
        stable_final_state: true,
        candidate_count: 1,
        sent_count: 1,
        accepted_count: 1,
        added_count: 1,
        multiword_count: 1,
        classifier_outcome: "ok",
      }),
    );

    // A recording is active: the toast waits for idle.
    expect(toasts).toHaveLength(0);
    lifecycle.publish(null, "idle");
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      type: "vocabulary_learned",
      tone: "success",
      title: {
        key: "widget.notifications.type.vocabularyLearned.title",
        params: { terms: "Claude Code" },
      },
      primaryAction: {
        command: {
          kind: "undoLearnedVocabulary",
          entries: [{ id: rows[0].id, word: "Claude Code" }],
        },
      },
      secondaryAction: { navigateTo: "/settings/vocabulary" },
    });
  });

  it("starts no watch when the flag is off, the model is local, or a newer session started", async () => {
    await committedRow("s1", "amical-cloud");
    await committedRow("s2", "whisper-tiny");

    flagOn = false;
    lifecycle.session("s1");
    lifecycle.pasteConfirmed("s1", PASTED);
    await settle();
    flagOn = true;

    lifecycle.session("s2");
    lifecycle.pasteConfirmed("s2", PASTED);
    await settle();

    lifecycle.session("s1");
    lifecycle.publish("s3", "starting");
    lifecycle.pasteConfirmed("s1", PASTED);
    await settle();

    expect(bridge.startEditWatch).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("reports no_row without a committed transcription row", async () => {
    lifecycle.session("s1");
    lifecycle.pasteConfirmed("s1", PASTED);
    await settle();

    expect(bridge.startEditWatch).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith({
      end_reason: "no_row",
      app_type: "default",
    });
  });

  it("pauses watches for 24 h after a disabled answer", async () => {
    await committedRow("s1", "amical-cloud");
    await committedRow("s3", "amical-cloud");
    await committedRow("s4", "amical-cloud");
    classify.mockImplementation(() =>
      Effect.succeed({ accepted: [], disabled: true }),
    );

    await runCorrectedWatch("s1", "s2");
    expect(testDb.db.select().from(vocabulary).all()).toEqual([]);
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({ classifier_outcome: "disabled" }),
    );

    lifecycle.session("s3");
    lifecycle.pasteConfirmed("s3", PASTED);
    await settle();
    expect(bridge.startEditWatch).toHaveBeenCalledTimes(1);

    await clock.advance(DAY_MS + 1);
    lifecycle.session("s4");
    lifecycle.pasteConfirmed("s4", PASTED);
    await settle();
    expect(bridge.startEditWatch).toHaveBeenCalledTimes(2);
  });

  it("reports a refused start without reading the field", async () => {
    await committedRow("s1", "amical-cloud");
    bridge.startEditWatch.mockResolvedValueOnce({
      watchId: null,
      startStatus: "secure",
    });

    lifecycle.session("s1");
    lifecycle.pasteConfirmed("s1", PASTED);
    await settle();
    await clock.advance(2000);

    expect(bridge.readEditWatch).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith({
      start_status: "secure",
      end_reason: "start_refused",
      app_type: "default",
    });
  });

  it("counts a failed read as an error read and ends the watch on a read timeout", async () => {
    await committedRow("s1", "amical-cloud");
    bridge.readEditWatch
      .mockRejectedValueOnce(new Error("helper not running"))
      .mockRejectedValueOnce(
        new NativeBridgeTimeoutError(
          "timed out",
          "readEditWatch",
          "r2",
          2000,
          2000,
        ),
      );

    lifecycle.session("s1");
    lifecycle.pasteConfirmed("s1", PASTED);
    await settle();
    await clock.advance(1000);

    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({
        end_reason: "read_failed",
        read_count: 2,
        read_error_count: 2,
      }),
    );
  });

  it.each([
    ["close", "helper_restart"],
    ["otherPaste", "superseded"],
  ] as const)(
    "ends the watch without another read on %s",
    async (trigger, endReason) => {
      await committedRow("s1", "amical-cloud");
      lifecycle.session("s1");
      lifecycle.pasteConfirmed("s1", PASTED);
      await settle();
      await clock.advance(250);
      const reads = bridge.readEditWatch.mock.calls.length;

      if (trigger === "close") bridge.emit("close");
      else lifecycle.otherPaste();
      await settle();

      expect(bridge.readEditWatch).toHaveBeenCalledTimes(reads);
      expect(bridge.stopEditWatch).toHaveBeenCalledWith("w1");
      expect(track).toHaveBeenCalledWith(
        expect.objectContaining({ end_reason: endReason }),
      );
      expect(classify).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "timeout",
      new CloudNetworkFailure({
        message: "timed out",
        cause: Object.assign(new Error("timed out"), { name: "TimeoutError" }),
      }),
    ],
    [
      "invalid",
      new VocabularyTermCheckContractFailure({
        message: "bad response",
        phase: "response",
        cause: null,
      }),
    ],
    [
      "http_error",
      new CloudNetworkFailure({ message: "offline", cause: new Error("x") }),
    ],
  ] as const)(
    "learns nothing when the term check fails (%s)",
    async (outcome, error) => {
      await committedRow("s1", "amical-cloud");
      classify.mockImplementation(() => Effect.fail(error));

      await runCorrectedWatch("s1", "s2");

      expect(testDb.db.select().from(vocabulary).all()).toEqual([]);
      expect(track).toHaveBeenCalledWith(
        expect.objectContaining({ sent_count: 1, classifier_outcome: outcome }),
      );
    },
  );

  it("ignores accepted terms that were not sent", async () => {
    await committedRow("s1", "amical-cloud");
    classify.mockImplementation(() => Effect.succeed({ accepted: ["Other"] }));

    await runCorrectedWatch("s1", "s2");
    lifecycle.publish(null, "idle");

    expect(testDb.db.select().from(vocabulary).all()).toEqual([]);
    expect(toasts).toHaveLength(0);
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({ classifier_outcome: "ok", accepted_count: 0 }),
    );
  });
});
