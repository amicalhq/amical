import { runPromise as runTelemetryPromise } from "../runtime/telemetry-runtime";
import {
  expectObligation,
  flushAllDictationTraces,
  recordPhase,
} from "../telemetry/dictation-trace";
import { ipcMain, app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { Deferred, Effect, Layer } from "effect";
import { v4 as uuid } from "uuid";
import type { GetAccessibilityContextResult } from "@amical/types";
import { logger } from "../logger";
import { AppError, ErrorCodes } from "../../types/error";
import { addRelease, up } from "../runtime/layer-helpers";
import {
  AppScopeTag,
  ModelServiceTag,
  NativeBridgeTag,
  RecordingLifecycleTag,
  SettingsServiceTag,
  TranscriptionServiceTag,
} from "../runtime/tags";
import type { NativeBridge } from "../../services/platform/native-bridge-service";
import type { SettingsService } from "../../services/settings-service";
import type { ModelService } from "../../services/model-service";
import type { TranscriptionService } from "../../services/transcription-service";
import type { ShortcutManager } from "../managers/shortcut-manager";
import type { AmbianceContext, RecorderAmbiance } from "./adapters/recorder";
import {
  createRecordingLifecycle,
  type RecordingLifecycle,
  type RecordingLifecycleDeps,
} from "./runtime";
import { createSessionWork } from "./effect/session-work";
import { REAL_TIMER_HOST } from "./shell";
import { runLifecycleRecovery } from "./startup-recovery";
import { DEFAULT_LIFECYCLE_TUNING } from "./tuning";

/**
 * Desktop binding of the recording lifecycle: real ambiance (native start/
 * stop sounds + system-audio mute), real paste bridge, chunk IPC, hotkey
 * wiring, the draft selected-text fallback, and startup recovery.
 */
export interface DesktopRecordingLifecycle extends RecordingLifecycle {
  /** Late binding: ShortcutManager builds after the lifecycle (its Live
   * wires the hotkey stream in, mirroring the v1 dependency direction). */
  bindShortcutManager(shortcutManager: ShortcutManager): void;
}

/** Substituted when transcription-service init failed at boot: the stream
 * fast-fails at open, so the session seals failure in STARTING and the user
 * learns at press time. Deviation from v1, which recorded the full session
 * and threw at finalize. */
function degradedTranscriptionService() {
  return {
    beginStreamingSession: (): boolean => {
      throw new AppError(
        "Transcription service failed to initialize",
        ErrorCodes.WORKER_INITIALIZATION_FAILED,
      );
    },
    processStreamingChunk: async () => "",
    resolveStreamingSession: async () => null,
    cancelStreamingSession: async () => undefined,
    resetVadForNewSession: async () => undefined,
    warmupActiveProvider: async () => undefined,
    isHistoryRetryInProgress: () => false,
    updateStreamingSession: async () => undefined,
  };
}

export function createDesktopRecordingLifecycle(deps: {
  transcriptionService: TranscriptionService | null;
  nativeBridge: NativeBridge | null;
  settingsService: SettingsService;
  modelService: ModelService;
}): DesktopRecordingLifecycle {
  const { nativeBridge, settingsService, modelService } = deps;
  const transcriptionService =
    deps.transcriptionService ?? degradedTranscriptionService();

  // One SessionWork instance for the whole binding: the runtime wires it to
  // the lifecycle edges, and the desktop glue below runs its own session
  // work (ambiance stop, draft barrier) through the same regions and
  // failure sink.
  const sessionWork = createSessionWork({ timers: REAL_TIMER_HOST });

  let shortcutManager: ShortcutManager | null = null;

  // The begin-side promise is joined at end() so a stop that lands before
  // the native start call resolves still unmutes with the truthful context.
  const ambianceInFlight = new Map<string, Promise<AmbianceContext>>();

  const ambiance: RecorderAmbiance = {
    begin(session) {
      let releaseGate!: () => void;
      const beepGate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      const done = (async () => {
        // Everything before the gate release sits inside try/finally: a
        // preferences or RPC failure must never leave the beep gate closed
        // (a closed gate drops every non-final frame).
        let muteSounds = false;
        let systemAudioMuted = false;
        try {
          const preferences = await settingsService.getPreferences();
          muteSounds = preferences.muteDictationSounds;
          const muteSystemAudio = preferences.muteSystemAudio;
          // No beep when dictation sounds are muted: frames are clean at once.
          if (muteSounds) releaseGate();
          if (nativeBridge) {
            const result = await nativeBridge.call("startRecording", {
              muteSystemAudio,
              muteSounds,
            });
            systemAudioMuted = muteSystemAudio && !!result?.success;
          }
        } finally {
          releaseGate();
        }
        return { systemAudioMuted, soundsMuted: muteSounds };
      })();
      done.catch((error) => {
        logger.audio.warn("Native recording ambiance failed", {
          sessionId: session,
          error,
        });
      });
      ambianceInFlight.set(session, done);
      if (nativeBridge) {
        // The matching unmute obligation is owed from this moment; the
        // expect must land before the root trace closes at the IDLE edge.
        // Guarded like end()'s fork: no bridge, no unmute, no expect
        // (review finding — an expect whose fork never comes waits out the
        // full grace window).
        expectObligation(session, "lifecycle.unmute-ambiance");
        const muteStartedAt = Date.now();
        void done
          .then(() =>
            recordPhase(
              session,
              "lifecycle.mute-ambiance",
              muteStartedAt,
              Date.now(),
            ),
          )
          .catch(() => undefined);
      }
      return { beepGate, done };
    },
    end(session, context) {
      const pending = ambianceInFlight.get(session);
      ambianceInFlight.delete(session);
      if (!nativeBridge) return;
      // The unmute is an obligation: it must land even though the session
      // is already retiring. (begin keeps its promise shape — the port
      // returns {beepGate, done} promises, so a begin fiber would be pure
      // ceremony around the same values.)
      sessionWork.runObligation(
        session,
        Effect.promise(async () => {
          try {
            const resolved =
              context ?? (pending ? await pending.catch(() => null) : null);
            await nativeBridge.call("stopRecording", {
              wasMuted: resolved?.systemAudioMuted ?? false,
              muteSounds: resolved?.soundsMuted ?? false,
            });
          } catch (error) {
            logger.audio.warn("Failed to end recording ambiance", {
              sessionId: session,
              error,
            });
          }
        }).pipe(
          Effect.withSpan("lifecycle.unmute-ambiance", {
            attributes: { sessionId: session },
          }),
        ),
      );
    },
  };

  // Draft copy-capture barrier (v1 semantics): the clipboard-copy fallback
  // starts when a draft session begins stopping, and resolve waits for it
  // (bounded) so the merged selection is in the stream context before the
  // final flush. One capture per session.
  const DRAFT_CAPTURE_BARRIER_MS = 2_500;
  const draftCaptures = new Map<string, Deferred.Deferred<void>>();

  const barrieredTranscriptionService: RecordingLifecycleDeps["transcriptionService"] =
    {
      beginStreamingSession: (sessionId, onTerminalFailure) =>
        transcriptionService.beginStreamingSession(
          sessionId,
          onTerminalFailure,
        ),
      processStreamingChunk: (options) =>
        transcriptionService.processStreamingChunk(options),
      resolveStreamingSession: async (options) => {
        // The entry stays in the map until idle clears it — deleting here
        // would let the still-stopping snapshots start a second capture
        // (a second synthetic copy chord) after transcription retired.
        const capture = draftCaptures.get(options.sessionId);
        if (capture) {
          // Bounded barrier: the losing side is interrupted, so a settled
          // capture no longer leaves a dangling timeout behind.
          await runTelemetryPromise(
            sessionWork.bounded<void>(
              Deferred.await(capture),
              DRAFT_CAPTURE_BARRIER_MS,
              undefined,
            ),
          );
        }
        return transcriptionService.resolveStreamingSession(options);
      },
      cancelStreamingSession: (sessionId) =>
        transcriptionService.cancelStreamingSession(sessionId),
      resetVadForNewSession: () => transcriptionService.resetVadForNewSession(),
      warmupActiveProvider: () => transcriptionService.warmupActiveProvider(),
      isHistoryRetryInProgress: () =>
        transcriptionService.isHistoryRetryInProgress(),
    };

  const lifecycle = createRecordingLifecycle({
    transcriptionService: barrieredTranscriptionService,
    ambiance,
    bridge: nativeBridge
      ? {
          pasteText: async (options) => {
            const result = await nativeBridge.call("pasteText", {
              transcript: options.transcript,
              preserveClipboard: options.preserveClipboard,
            });
            return { success: !!result?.success };
          },
          setDraftEnterCapture: async (armed) => {
            await nativeBridge.setDraftEnterCapture(armed);
          },
        }
      : null,
    getPreserveClipboard: async () =>
      (await settingsService.getPreferences()).preserveClipboard,
    hasSpeechModelSelected: async () =>
      Boolean(await modelService.getSelectedModel()),
    isDraftChordActive: () => shortcutManager?.isPTTDraftActive() ?? false,
    setDraftInputActive: (armed) => shortcutManager?.setDraftActive(armed),
    audioFilePathFor: (session) => {
      const audioDir = path.join(app.getPath("temp"), "amical-audio");
      fs.mkdirSync(audioDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      return path.join(audioDir, `audio-${session}-${timestamp}.wav`);
    },
    tuning: DEFAULT_LIFECYCLE_TUNING,
    mintSession: () => uuid(),
    sessionWork,
  });

  // Session-start context work: refresh the accessibility snapshot and push
  // it into the live stream when it lands (v1 doStart behavior).
  // Session-stop draft work: when the AX read failed or produced a phantom
  // empty selection, capture the selection via the helper's clipboard-copy
  // RPC and merge it in (v1 captureDraftSelectionViaCopy).
  lifecycle.onSnapshot((snapshot) => {
    // Idle snapshots carry no session — clean up before the session guard,
    // or the map keeps one settled promise per draft session forever.
    if (snapshot.projection.publicState === "idle") {
      draftCaptures.clear();
    }

    const session = snapshot.sessionId;
    if (!session || !nativeBridge) return;

    if (snapshot.projection.publicState === "starting") {
      void nativeBridge
        .refreshAccessibilityContext()
        .then(async () => {
          const accessibilityContext = nativeBridge.getAccessibilityContext();
          if (
            !accessibilityContext ||
            lifecycle.getSnapshot().sessionId !== session
          ) {
            return;
          }
          await transcriptionService.updateStreamingSession({
            sessionId: session,
            accessibilityContext,
          });
        })
        .catch((error) => {
          logger.audio.warn("Failed to propagate accessibility context", {
            error,
          });
        });
    }

    if (
      snapshot.projection.publicState === "stopping" &&
      snapshot.projection.stopKind === "finalize" &&
      snapshot.metadata?.isDraft &&
      !draftCaptures.has(session)
    ) {
      // Once per session: stopping publishes several snapshots (drain,
      // seal, settle) and the capture must not re-fire on each.
      const barrier = Effect.runSync(Deferred.make<void>());
      draftCaptures.set(session, barrier);
      void captureDraftSelectionViaCopy(session)
        .catch((error) => {
          logger.audio.warn("Draft copy-capture fallback failed", {
            sessionId: session,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => Deferred.unsafeDone(barrier, Effect.void));
    }
  });

  async function captureDraftSelectionViaCopy(session: string): Promise<void> {
    if (!nativeBridge) return;
    const cached = nativeBridge.getAccessibilityContext();
    const axSelectedText = cached?.context?.textSelection?.selectedText;
    if (axSelectedText && axSelectedText.trim() !== "") {
      return; // AX path already captured the selection
    }
    const baseContext = cached?.context;
    if (!baseContext) {
      logger.audio.warn(
        "Draft copy-capture skipped: no fresh accessibility context to merge into",
        { sessionId: session },
      );
      return;
    }

    const captured = await nativeBridge.getSelectedTextViaCopy();
    const selectedText = captured?.selectedText;
    if (!selectedText || selectedText.trim() === "") {
      logger.audio.info("Draft copy-capture found no selection", {
        sessionId: session,
        clipboardChanged: captured?.clipboardChanged ?? null,
        message: captured?.message,
      });
      return;
    }
    if (lifecycle.getSnapshot().sessionId !== session) {
      return; // session moved on while the capture was in flight
    }

    // clipboardCopy yields only the text; every other selection field would
    // describe the wrong location, so report null/false rather than junk.
    const merged: GetAccessibilityContextResult = {
      context: {
        ...baseContext,
        textSelection: {
          selectedText,
          fullContent: null,
          preSelectionText: null,
          postSelectionText: null,
          selectionRange: null,
          isEditable: false,
          extractionMethod: "clipboardCopy",
          hasMultipleRanges: false,
          isPlaceholder: false,
          isSecure: cached.context?.textSelection?.isSecure ?? false,
          fullContentTruncated: false,
        },
      },
    };
    await transcriptionService.updateStreamingSession({
      sessionId: session,
      accessibilityContext: merged,
    });
    logger.audio.info("Draft selection captured via clipboard copy", {
      sessionId: session,
      selectedTextLength: selectedText.length,
    });
  }

  return {
    ...lifecycle,
    bindShortcutManager(manager: ShortcutManager): void {
      shortcutManager = manager;
      manager.on("ptt-state-changed", (engaged: boolean) => {
        lifecycle.setPttLevel(engaged);
      });
      manager.on("toggle-recording-triggered", () => {
        lifecycle.toggleKey();
      });
      manager.on("paste-last-transcript-triggered", () => {
        void lifecycle.pasteLatestTranscription();
      });
      // ESC closes a pending draft review first, else dismisses the live
      // session; Enter confirms a reviewable draft (armed only while idle).
      manager.on("escape-pressed", () => {
        void lifecycle.dismiss();
      });
      manager.on("enter-pressed", () => {
        void lifecycle.confirmDraftFromInput();
      });
    },
  };
}

export const RecordingLifecycleLive: Layer.Layer<
  RecordingLifecycleTag,
  never,
  | SettingsServiceTag
  | ModelServiceTag
  | NativeBridgeTag
  | TranscriptionServiceTag
  | AppScopeTag
> = Layer.effect(
  RecordingLifecycleTag,
  Effect.gen(function* () {
    const settingsService = yield* SettingsServiceTag;
    const modelService = yield* ModelServiceTag;
    const nativeBridge = yield* NativeBridgeTag;
    const transcriptionService = yield* TranscriptionServiceTag;
    const appScope = yield* AppScopeTag;

    const lifecycle = createDesktopRecordingLifecycle({
      transcriptionService,
      nativeBridge,
      settingsService,
      modelService,
    });

    ipcMain.handle(
      "audio-data-chunk",
      async (
        _event,
        sessionId: string,
        chunk: ArrayBuffer,
        isFinalChunk: boolean,
      ) => {
        if (!(chunk instanceof ArrayBuffer)) {
          logger.audio.error("Received invalid audio chunk type", {
            type: typeof chunk,
          });
          throw new Error("Invalid audio chunk type received.");
        }
        await lifecycle.handleAudioChunk(
          sessionId,
          new Float32Array(chunk),
          isFinalChunk,
        );
      },
    );

    // Settle custody rows a previous run died on (never the live session).
    void runLifecycleRecovery({
      excludeSession: lifecycle.getSnapshot().sessionId,
    }).catch((error) => {
      logger.audio.error("Startup lifecycle recovery failed", { error });
    });

    yield* addRelease(
      appScope,
      "Cleaning up recording lifecycle...",
      "recordingLifecycle",
      () => {
        ipcMain.removeHandler("audio-data-chunk");
        lifecycle.dispose();
        // Ship whatever traces are still waiting before the process exits.
        flushAllDictationTraces();
      },
    );
    logger.main.info("Recording lifecycle initialized");
    up("recordingLifecycle");
    return lifecycle;
  }),
);
