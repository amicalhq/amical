import { Effect } from "effect";
import type { NativeBridge } from "../../../services/platform/native-bridge-service";
import type { SettingsService } from "../../../services/settings-service";
import { logger } from "../../logger";
import {
  expectObligation,
  recordPhase,
  recordPoint,
  tracePhase,
} from "../../telemetry/dictation-trace";
import type { SessionWork } from "../effect/session-work";
import type { ShellTimerHost } from "../shell";
import type { AmbianceContext, RecorderAmbiance } from "./recorder";

const START_RECORDING_SOUND_GATE_MS = 200;

interface AmbianceInFlight {
  done: Promise<AmbianceContext>;
  stopGate: () => void;
}

/** Owns native start/stop sounds, the chunk gate, and system-audio restoration. */
export function createRecorderAmbiance({
  nativeBridge,
  settingsService,
  sessionWork,
  timers,
}: {
  nativeBridge: NativeBridge | null;
  settingsService: SettingsService;
  sessionWork: SessionWork;
  timers: ShellTimerHost;
}): RecorderAmbiance {
  // The begin-side promise is joined at end() so a stop that lands before
  // the native start call resolves still unmutes with the truthful context.
  const ambianceInFlight = new Map<string, AmbianceInFlight>();

  return {
    begin(session) {
      let gateTimer: unknown = null;
      let gateStopped = false;
      const { promise: beepGate, resolve: releaseGate } =
        Promise.withResolvers<void>();
      if (!nativeBridge) releaseGate();
      const clearGateTimer = () => {
        if (gateTimer !== null) {
          timers.clear(gateTimer);
          gateTimer = null;
        }
      };
      const stopGate = () => {
        gateStopped = true;
        clearGateTimer();
      };
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
          recordPoint(session, "lifecycle.ambiance-config", {
            dictationSoundsEnabled: !muteSounds,
            systemAudioMuteEnabled: muteSystemAudio,
          });
          // No beep when dictation sounds are muted: frames are clean at once.
          if (muteSounds) releaseGate();
          if (nativeBridge) {
            const result = await tracePhase(
              session,
              "native.start-recording.rpc",
              () => {
                if (!muteSounds && !gateStopped) {
                  gateTimer = timers.set(START_RECORDING_SOUND_GATE_MS, () => {
                    gateTimer = null;
                    if (!gateStopped) releaseGate();
                  });
                }
                return nativeBridge.call("startRecording", {
                  muteSystemAudio,
                  muteSounds,
                });
              },
            );
            systemAudioMuted = muteSystemAudio && !!result?.success;
          }
        } finally {
          clearGateTimer();
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
      ambianceInFlight.set(session, { done, stopGate });
      if (nativeBridge) {
        // The matching unmute obligation is owed from this moment; the
        // expect must land before the root trace closes at the IDLE edge.
        // Guarded like end()'s fork: no bridge, no unmute, no expect. An
        // expectation whose fork never comes waits out the full grace window.
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
      const inFlight = ambianceInFlight.get(session);
      inFlight?.stopGate();
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
              context ??
              (inFlight ? await inFlight.done.catch(() => null) : null);
            await tracePhase(session, "native.stop-recording.rpc", () =>
              nativeBridge.call("stopRecording", {
                wasMuted: resolved?.systemAudioMuted ?? false,
                muteSounds: resolved?.soundsMuted ?? false,
              }),
            );
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
}
