import { VOCABULARY_CLASSIFY_LIMITS } from "@amical/api-contracts/apps/v1";
import type { HelperEvent, StartEditWatchResult } from "@amical/types";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { v4 as uuid } from "uuid";

import { getAllSnippets } from "../../db/snippets";
import { getTranscriptionBySessionId } from "../../db/transcriptions";
import { getAllVocabulary, insertLearnedVocabulary } from "../../db/vocabulary";
import type { Vocabulary } from "../../db/schema";
import { getApplicationLocale } from "../../i18n/application-locale";
import type { DesktopRecordingLifecycle } from "../../main/lifecycle/live";
import { logger } from "../../main/logger";
import { addRelease, up } from "../../main/runtime/layer-helpers";
import {
  AppScopeTag,
  AuthServiceTag,
  NativeBridgeTag,
  RecordingLifecycleTag,
  RemoteConfigServiceTag,
  TelemetryServiceTag,
  VocabularyLearningServiceTag,
} from "../../main/runtime/tags";
import { activityAppTypeOf } from "../../types/activity";
import { CloudNetworkFailure } from "../../types/errors/cloud-request";
import type {
  TranscriptionEditWatchCompletedEvent,
  VocabularyClassifierOutcome,
  VocabularyLearningCompletedEvent,
} from "../../types/telemetry-events";
import type { WidgetNotification } from "../../types/widget-notification";
import {
  normalizeVocabularyKey,
  vocabularyKeys,
} from "../../utils/vocabulary-keys";
import {
  NativeBridgeTimeoutError,
  type NativeBridge,
} from "../platform/native-bridge-service";
import {
  DESKTOP_AUTO_VOCABULARY_FLAG,
  DESKTOP_EDIT_METRICS_FLAG,
  type RemoteConfigService,
} from "../remote-config-service";
import type { TelemetryService } from "../telemetry-service";
import { extractCandidates, filterCandidates } from "./candidates";
import { measureEdits, pastedSize } from "./edit-metrics";
import { createEditTracker } from "./edit-tracker";
import { vocabularyLearningNotifications } from "./notifications";
import {
  VocabularyTermCheckClient,
  VocabularyTermCheckContractFailure,
} from "./term-check-client";
import type {
  EditTracker,
  EditTrackerResult,
  TimerHandle,
  TrackerPlatform,
  WatchRead,
} from "./types";

/** After a "disabled" answer from the term check, no watch starts for 24 h. */
const DISABLED_PAUSE_MS = 24 * 60 * 60 * 1000;

type LearningBridge = Pick<
  NativeBridge,
  "startEditWatch" | "readEditWatch" | "stopEditWatch" | "on" | "off"
>;

type LearningLifecycle = Pick<
  DesktopRecordingLifecycle,
  "onSessionPasteConfirmed" | "onOtherPaste" | "onSnapshot" | "getSnapshot"
>;

export interface LearningTimers {
  /** Monotonic clock in milliseconds (drives the tracker and the pause). */
  now(): number;
  setTimer(ms: number, callback: () => void): TimerHandle;
}

const REAL_TIMERS: LearningTimers = {
  now: () => performance.now(),
  setTimer: (ms, callback) => {
    const handle = setTimeout(callback, ms);
    return { cancel: () => clearTimeout(handle) };
  },
};

export interface VocabularyLearningServiceDeps {
  bridge: LearningBridge | null;
  lifecycle: LearningLifecycle;
  remoteConfig: Pick<RemoteConfigService, "getConfig">;
  telemetry: Pick<
    TelemetryService,
    | "trackTranscriptionEditWatchCompleted"
    | "trackVocabularyLearningCompleted"
    | "isEnabled"
  >;
  client: Pick<VocabularyTermCheckClient, "classify">;
  platform?: TrackerPlatform | null;
  timers?: LearningTimers;
}

/** Event properties known when the watch starts. */
type WatchEventBase = Pick<
  TranscriptionEditWatchCompletedEvent,
  | "session_id"
  | "app_type"
  | "provider"
  | "model_id"
  | "formatting_model"
  | "language"
  | "detected_language"
>;

interface ActiveWatch {
  watchId: string;
  pastedText: string;
  eventBase: WatchEventBase;
  tracker: EditTracker;
}

function currentPlatform(): TrackerPlatform | null {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "win32";
  return null;
}

/**
 * Edit watch: after a confirmed session paste, hold the pasted-into element
 * through the native helper and track the user's edits (edit tracker). At
 * the end, report edit metrics (counts only) and, for auto vocabulary,
 * extract correction candidates, ask the term check, and store accepted
 * terms as learned vocabulary with a toast that offers Undo.
 *
 * App-scope (the paste answer lands after the lifecycle is idle). Logs
 * status, lengths and timings only: no field text, no candidates, no terms.
 */
export class VocabularyLearningService {
  private readonly bridge: LearningBridge | null;
  private readonly lifecycle: LearningLifecycle;
  private readonly remoteConfig: Pick<RemoteConfigService, "getConfig">;
  private readonly telemetry: VocabularyLearningServiceDeps["telemetry"];
  private readonly client: Pick<VocabularyTermCheckClient, "classify">;
  private readonly platform: TrackerPlatform | null;
  private readonly timers: LearningTimers;

  private watch: ActiveWatch | null = null;
  private lastSessionId: string | null = null;
  private pausedUntil = 0;
  private pendingToasts: WidgetNotification[] = [];
  private unsubscribers: (() => void)[] = [];
  private disposed = false;

  constructor(deps: VocabularyLearningServiceDeps) {
    this.bridge = deps.bridge;
    this.lifecycle = deps.lifecycle;
    this.remoteConfig = deps.remoteConfig;
    this.telemetry = deps.telemetry;
    this.client = deps.client;
    this.platform =
      deps.platform === undefined ? currentPlatform() : deps.platform;
    this.timers = deps.timers ?? REAL_TIMERS;
  }

  static readonly Live: Layer.Layer<
    VocabularyLearningServiceTag,
    never,
    | NativeBridgeTag
    | RecordingLifecycleTag
    | RemoteConfigServiceTag
    | AuthServiceTag
    | TelemetryServiceTag
    | AppScopeTag
  > = Layer.effect(
    VocabularyLearningServiceTag,
    Effect.gen(function* () {
      const bridge = yield* NativeBridgeTag;
      const lifecycle = yield* RecordingLifecycleTag;
      const remoteConfig = yield* RemoteConfigServiceTag;
      const authService = yield* AuthServiceTag;
      const telemetry = yield* TelemetryServiceTag;
      const appScope = yield* AppScopeTag;
      const service = new VocabularyLearningService({
        bridge,
        lifecycle,
        remoteConfig,
        telemetry,
        client: new VocabularyTermCheckClient(authService),
      });
      yield* addRelease(
        appScope,
        "Stopping vocabulary learning...",
        "vocabularyLearningService",
        () => service.shutdown(),
      );
      service.initialize();
      up("vocabularyLearningService");
      return service;
    }),
  );

  initialize(): void {
    this.disposed = false;
    this.unsubscribers = [
      this.lifecycle.onSessionPasteConfirmed(this.onSessionPasteConfirmed),
      this.lifecycle.onOtherPaste(this.onOtherPaste),
      this.lifecycle.onSnapshot(this.onSnapshot),
    ];
    if (this.bridge) {
      this.bridge.on("helperEvent", this.onHelperEvent);
      this.bridge.on("close", this.onBridgeClose);
      const bridge = this.bridge;
      this.unsubscribers.push(() => {
        bridge.off("helperEvent", this.onHelperEvent);
        bridge.off("close", this.onBridgeClose);
      });
    }
  }

  shutdown(): void {
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.pendingToasts = [];
    // Ends the watch (timers cancelled); the end handler only releases it.
    this.watch?.tracker.onOtherPaste();
  }

  private readonly onSessionPasteConfirmed = (
    session: string,
    text: string,
  ): void => {
    void this.startWatch(session, text).catch((error: unknown) => {
      logger.main.warn("Edit watch start failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  private readonly onOtherPaste = (): void => {
    this.watch?.tracker.onOtherPaste();
  };

  // Runs inside the lifecycle dispatch loop: it must not throw.
  private readonly onSnapshot: Parameters<LearningLifecycle["onSnapshot"]>[0] =
    (snapshot) => {
      try {
        if (snapshot.sessionId) this.lastSessionId = snapshot.sessionId;
        if (snapshot.projection.publicState === "starting") {
          this.watch?.tracker.onSessionStart();
        } else if (snapshot.projection.publicState === "idle") {
          this.flushToasts();
        }
      } catch (error) {
        logger.main.warn("Vocabulary learning snapshot handler failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

  private readonly onHelperEvent = (event: HelperEvent): void => {
    if (event.type !== "keyDown" || !this.watch) return;
    const payload = event.payload;
    this.watch.tracker.onKeyDown({
      keyCode: payload.keyCode,
      metaKey: payload.metaKey ?? false,
      ctrlKey: payload.ctrlKey ?? false,
    });
  };

  private readonly onBridgeClose = (): void => {
    this.watch?.tracker.onHelperRestart();
  };

  private newerSessionStarted(session: string): boolean {
    return this.lastSessionId !== null && this.lastSessionId !== session;
  }

  private async startWatch(session: string, text: string): Promise<void> {
    const bridge = this.bridge;
    const platform = this.platform;
    if (!bridge || !platform || this.disposed) return;
    const metricsWanted = this.metricsWanted();
    const learningAllowed = this.learningAllowed();
    if (!metricsWanted && !learningAllowed) return;

    const row = await getTranscriptionBySessionId(session);
    if (!row) {
      this.telemetry.trackTranscriptionEditWatchCompleted({
        session_id: session,
        end_reason: "no_row",
      });
      return;
    }
    // Amical Cloud dictations only, to start with. provider and model_id use
    // the dictation trace's values.
    if (row.speechModel !== "amical-cloud" || this.disposed) return;
    const eventBase: WatchEventBase = {
      session_id: session,
      app_type: activityAppTypeOf(row.meta),
      provider: "amical-cloud",
      model_id: "amical-cloud",
      // Absent when unknown, as on transcription_completed_v2.
      formatting_model: row.formattingModel ?? undefined,
      language: row.language ?? undefined,
      detected_language: row.detectedLanguage ?? undefined,
    };
    if (this.newerSessionStarted(session)) {
      this.telemetry.trackTranscriptionEditWatchCompleted({
        ...eventBase,
        end_reason: "not_started",
      });
      return;
    }

    // One watch at a time: a new confirmed paste supersedes the current one.
    this.watch?.tracker.onOtherPaste();

    let start: StartEditWatchResult;
    try {
      start = await bridge.startEditWatch();
    } catch (error) {
      logger.main.debug("startEditWatch failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.telemetry.trackTranscriptionEditWatchCompleted({
        ...eventBase,
        start_status: "error",
        end_reason: "start_refused",
      });
      return;
    }
    if (start.startStatus !== "ok" || start.watchId === null) {
      this.telemetry.trackTranscriptionEditWatchCompleted({
        ...eventBase,
        start_status: start.startStatus,
        end_reason: "start_refused",
      });
      return;
    }
    const watchId = start.watchId;
    if (this.disposed || this.newerSessionStarted(session)) {
      void bridge.stopEditWatch(watchId);
      if (!this.disposed) {
        this.telemetry.trackTranscriptionEditWatchCompleted({
          ...eventBase,
          end_reason: "not_started",
        });
      }
      return;
    }

    const watch: ActiveWatch = {
      watchId,
      pastedText: text,
      eventBase,
      tracker: createEditTracker({
        pastedText: text,
        platform,
        deps: {
          now: () => this.timers.now(),
          setTimer: (ms, callback) => this.timers.setTimer(ms, callback),
          read: () => readWatch(bridge, watchId),
        },
      }),
    };
    this.watch = watch;
    logger.main.debug("Edit watch started", {
      sessionId: session,
      appType: eventBase.app_type,
      metricsWanted,
      learningAllowed,
      pastedLength: text.length,
    });
    void watch.tracker.result.then(
      (result) => this.onWatchEnded(watch, result),
      (error: unknown) => {
        logger.main.warn("Edit tracker failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }

  private async onWatchEnded(
    watch: ActiveWatch,
    result: EditTrackerResult,
  ): Promise<void> {
    if (this.watch === watch) this.watch = null;
    void this.bridge?.stopEditWatch(watch.watchId);
    if (this.disposed) return;

    const event: TranscriptionEditWatchCompletedEvent = {
      ...watch.eventBase,
      start_status: "ok",
      end_reason: result.endReason,
      key_events_seen: result.keyEventsSeen,
      stable_final_state: result.stableFinalState,
      locate_duration_ms: result.locateMs ?? undefined,
      read_count: result.readCount,
      read_error_count: result.readErrorCount,
      read_duration_max_ms: result.readMsMax,
      changed: result.changed,
      watch_duration_ms: result.durationMs,
      reanchor_count: result.reanchorCount,
      rearranged_count: result.rearrangedCount,
      paste_reset_count: result.pasteResetCount,
      enter_mark_dropped_count: result.enterMarkDroppedCount,
      final_state: result.finalState,
    };
    // Checked again, like learning: the flag or the opt-out can change. A
    // metrics failure must not drop the event or block learning.
    if (this.metricsWanted()) {
      try {
        Object.assign(
          event,
          result.region === null
            ? pastedSize(watch.pastedText)
            : measureEdits(watch.pastedText, result.region),
        );
      } catch (error) {
        logger.main.warn("Edit metrics failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.telemetry.trackTranscriptionEditWatchCompleted(event);
    logger.main.debug("Edit watch ended", {
      sessionId: watch.eventBase.session_id,
      endReason: result.endReason,
      readCount: result.readCount,
      readErrorCount: result.readErrorCount,
      durationMs: result.durationMs,
    });

    // Checked again: the flag or the pause can change during the watch.
    if (result.finalRegion !== null && this.learningAllowed()) {
      await this.learn(watch, result.finalRegion);
    }
  }

  private metricsWanted(): boolean {
    return (
      this.remoteConfig.getConfig().flags[DESKTOP_EDIT_METRICS_FLAG] !==
        false && this.telemetry.isEnabled()
    );
  }

  private learningAllowed(): boolean {
    return (
      this.remoteConfig.getConfig().flags[DESKTOP_AUTO_VOCABULARY_FLAG] !==
        false && this.timers.now() >= this.pausedUntil
    );
  }

  private async learn(watch: ActiveWatch, finalRegion: string): Promise<void> {
    const event: VocabularyLearningCompletedEvent = {
      session_id: watch.eventBase.session_id,
    };
    try {
      const extraction = extractCandidates(watch.pastedText, finalRegion);
      event.rewrite = extraction.rewrite;
      event.candidate_count = extraction.candidates.length;
      if (extraction.rewrite || extraction.candidates.length === 0) return;

      const filtered = filterCandidates(
        extraction.candidates,
        await this.loadKnownKeys(),
      );
      event.drop_shape_count = filtered.dropped.shape;
      event.drop_length_count = filtered.dropped.length;
      event.drop_known_count = filtered.dropped.known;
      event.drop_cjk_count = filtered.dropped.cjk;
      event.drop_duplicate_count = filtered.dropped.duplicate;
      event.drop_cap_count = filtered.dropped.cap;
      if (filtered.kept.length === 0) return;

      event.sent_count = filtered.kept.length;
      const detected = watch.eventBase.detected_language;
      const language =
        detected &&
        detected.length <= VOCABULARY_CLASSIFY_LIMITS.maxLanguageLength
          ? detected
          : undefined;
      const started = this.timers.now();
      const exit = await Effect.runPromiseExit(
        this.client.classify({
          candidates: filtered.kept,
          language,
        }),
      );
      event.classifier_duration_ms = Math.round(this.timers.now() - started);
      if (Exit.isFailure(exit)) {
        event.classifier_outcome = classifierOutcomeOf(exit.cause);
        return;
      }
      if (exit.value.disabled) {
        event.classifier_outcome = "disabled";
        this.pausedUntil = this.timers.now() + DISABLED_PAUSE_MS;
        return;
      }
      event.classifier_outcome = "ok";

      const heardByTerm = new Map(
        filtered.kept.map((candidate) => [candidate.term, candidate.heard]),
      );
      const accepted = [...new Set(exit.value.accepted)].filter((term) =>
        heardByTerm.has(term),
      );
      event.accepted_count = accepted.length;
      if (accepted.length === 0) return;

      const added = await insertLearnedVocabulary(
        accepted.map((term) => ({
          word: term,
          observedSource: heardByTerm.get(term) ?? "",
        })),
      );
      event.added_count = added.length;
      event.multiword_count = added.filter((row) => /\s/.test(row.word)).length;
      if (added.length > 0) this.showToast(added);
    } catch (error) {
      logger.main.warn("Vocabulary learning pass failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.telemetry.trackVocabularyLearningCompleted(event);
      logger.main.debug("Vocabulary learning ended", {
        sessionId: event.session_id,
        candidateCount: event.candidate_count,
        sentCount: event.sent_count,
        addedCount: event.added_count,
        classifierOutcome: event.classifier_outcome,
      });
    }
  }

  private async loadKnownKeys(): Promise<Set<string>> {
    const [rows, snippets] = await Promise.all([
      getAllVocabulary(),
      getAllSnippets(),
    ]);
    const known = vocabularyKeys(rows);
    for (const snippet of snippets) {
      known.add(normalizeVocabularyKey(snippet.trigger));
    }
    return known;
  }

  private showToast(rows: Vocabulary[]): void {
    const terms = new Intl.ListFormat(getApplicationLocale(), {
      style: "long",
      type: "conjunction",
    }).format(rows.map((row) => row.word));
    const notification: WidgetNotification = {
      id: uuid(),
      type: "vocabulary_learned",
      tone: "success",
      title: {
        key: "widget.notifications.type.vocabularyLearned.title",
        params: { terms },
      },
      primaryAction: {
        label: { key: "widget.notifications.action.undo" },
        command: {
          kind: "undoLearnedVocabulary",
          entries: rows.map((row) => ({ id: row.id, word: row.word })),
        },
      },
      secondaryAction: {
        label: { key: "widget.notifications.action.view" },
        navigateTo: "/settings/vocabulary",
      },
      timestamp: Date.now(),
    };
    // A recording start dismisses open toasts: wait for idle.
    if (this.lifecycle.getSnapshot().projection.publicState === "idle") {
      vocabularyLearningNotifications.emit(notification);
    } else {
      this.pendingToasts.push(notification);
    }
  }

  private flushToasts(): void {
    if (this.pendingToasts.length === 0) return;
    const toasts = this.pendingToasts;
    this.pendingToasts = [];
    for (const toast of toasts) vocabularyLearningNotifications.emit(toast);
  }
}

/**
 * One readEditWatch call as a tracker read. Never rejects: an RPC timeout
 * ends the watch, any other failure counts as an "error" read.
 */
async function readWatch(
  bridge: LearningBridge,
  watchId: string,
): Promise<WatchRead> {
  try {
    const result = await bridge.readEditWatch(watchId);
    return {
      status: result.readStatus,
      text: result.text,
      selection: result.selection,
      readMs: result.readMs,
    };
  } catch (error) {
    if (error instanceof NativeBridgeTimeoutError) return { status: "timeout" };
    logger.main.warn("readEditWatch failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: "error", text: null, selection: null, readMs: 0 };
  }
}

function classifierOutcomeOf(
  cause: Cause.Cause<unknown>,
): VocabularyClassifierOutcome {
  const failure = Cause.findErrorOption(cause);
  if (Option.isNone(failure)) return "http_error";
  const error = failure.value;
  if (error instanceof VocabularyTermCheckContractFailure) return "invalid";
  if (
    error instanceof CloudNetworkFailure &&
    error.cause instanceof Error &&
    (error.cause.name === "TimeoutError" || error.cause.name === "AbortError")
  ) {
    return "timeout";
  }
  return "http_error";
}
