import { useRef, useEffect, useState, useCallback } from "react";
import audioWorkletUrl from "@/assets/audio-recorder-processor.js?url";
import { api } from "@/trpc/react";
import type { CaptureFailure } from "@/types/recording";
import type { CaptureTimingsBatch } from "@/types/capture-timings";
import { AudioCaptureTimings } from "./audioCaptureTimings";
import {
  DESKTOP_REFRESH_AUDIO_DEVICES_ON_START_FLAG,
  DESKTOP_STEREO_MIC_DOWNMIX_FLAG,
  type AudioCaptureInfo,
} from "@/types/audio-capture";
import { Mutex } from "async-mutex";
import { audioCaptureDiagnostics } from "./audioCaptureDiagnostics";
import { createAudioCaptureSource } from "./audioCaptureContext";
import { AudioCaptureContextLifetime } from "./audioCaptureContextLifetime";
import {
  acquireMicrophoneStream,
  type AcquiredMicrophoneMetadata,
} from "./audioCaptureDevice";
import { useAudioInputDeviceCache } from "./useAudioInputDeviceCache";
import { monitorAudioContextRecovery } from "./audioContextRecovery";
import {
  attachAudioWorkletFrameHandler,
  createWorkletFlushRequest,
  type WorkletFlushRequest,
} from "./audioCaptureWorklet";

const SAMPLE_RATE = 16000;
const AUDIO_WORKLET_FLUSH_TIMEOUT_MS = 1_000;

// Scrolling level history. One overall loudness value per frame is pushed into
// a history buffer, and each bar reads a different time-lag of it, so a loud
// moment enters at bar 0 and ripples across the row (all bars move; the wave
// "carries over"). A fixed-frequency spectrum can't do that — bands are pinned
// in place and voice energy is lopsided toward the low ones.
const WAVEFORM_BAR_SLOTS = 6;
const BAR_STRIDE = 3; // frames of lag between adjacent bars (~96ms @ 31fps)
const LEVEL_HISTORY_LEN = (WAVEFORM_BAR_SLOTS - 1) * BAR_STRIDE + 1;
const LEVEL_GAIN = 2.2; // lift averaged band energy into a usable 0..1 range
const VOICE_BIN_LOW = 2; // ~125 Hz
const VOICE_BIN_HIGH = 30; // ~1.9 kHz (speech-dominant band)
const ANALYSER_FFT_SIZE = 256; // 128 bins @ ~62.5 Hz each at 16 kHz
const ANALYSER_SMOOTHING = 0.3; // light so syllables stay sharp enough to travel
const ANALYSER_MIN_DB = -70; // bottom of the byte range (quiet)
const ANALYSER_MAX_DB = -30; // top of the byte range (loud)
const EMPTY_BARS: number[] = new Array(WAVEFORM_BAR_SLOTS).fill(0);

const normalizeCaptureFailure = (
  error: unknown,
): Omit<CaptureFailure, "sessionId"> => {
  if (typeof error === "object" && error !== null) {
    const errorLike = error as { name?: unknown; message?: unknown };
    const name =
      typeof errorLike.name === "string" && errorLike.name
        ? errorLike.name
        : undefined;
    const message =
      typeof errorLike.message === "string" && errorLike.message
        ? errorLike.message
        : name;

    if (message) {
      return { name, message };
    }
  }

  return { message: String(error) || "Microphone capture failed" };
};

export interface UseAudioCaptureParams {
  onAudioChunk: (
    sessionId: string,
    arrayBuffer: ArrayBuffer,
    speechProbability: number,
    isFinalChunk: boolean,
    captureInfo?: AudioCaptureInfo,
  ) => Promise<void> | void;
  onCaptureStarted?: (
    microphone: AcquiredMicrophoneMetadata,
    sessionId: string,
    timings?: CaptureTimingsBatch,
  ) => Promise<void> | void;
  onCaptureFailure?: (
    failure: CaptureFailure,
    timings?: CaptureTimingsBatch,
  ) => void;
  onCaptureTimings?: (
    sessionId: string,
    timings: CaptureTimingsBatch,
    complete: boolean,
  ) => void;
  sessionId: string | null;
  enabled: boolean;
  idle: boolean;
}

export interface UseAudioCaptureOutput {
  /** Per-bar levels (0..1): a scrolling history of mic loudness, newest first. */
  audioLevels: number[];
}

export const useAudioCapture = ({
  onAudioChunk,
  onCaptureStarted,
  onCaptureFailure,
  onCaptureTimings,
  sessionId,
  enabled,
  idle,
}: UseAudioCaptureParams): UseAudioCaptureOutput => {
  const utils = api.useUtils();
  const [audioLevels, setAudioLevels] = useState<number[]>(EMPTY_BARS);
  // Analyser tap, reused byte buffer, and the rolling level history — kept in
  // refs so the frame handler doesn't depend on state.
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const levelHistoryRef = useRef<number[]>(
    new Array(LEVEL_HISTORY_LEN).fill(0),
  );
  const contextLifetimeRef = useRef<AudioCaptureContextLifetime | null>(null);
  if (!contextLifetimeRef.current) {
    contextLifetimeRef.current = new AudioCaptureContextLifetime(
      SAMPLE_RATE,
      audioWorkletUrl,
    );
  }
  const contextLifetime = contextLifetimeRef.current;
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackCleanupRef = useRef<(() => void) | null>(null);
  const contextRecoveryCleanupRef = useRef<(() => void) | null>(null);
  const mutexRef = useRef(new Mutex());
  const idleRef = useRef(idle);
  const onCaptureStartedRef = useRef(onCaptureStarted);
  const onCaptureFailureRef = useRef(onCaptureFailure);
  const onCaptureTimingsRef = useRef(onCaptureTimings);
  const pendingWorkletFlushRef = useRef<WorkletFlushRequest | null>(null);
  const captureAttemptStartedAtRef = useRef<number | null>(null);
  // Set true once the hook unmounts so deferred mutex bodies stop touching state.
  const disposedRef = useRef(false);
  // Set synchronously the instant a start is requested, so a just-fired idle
  // timer keeps the context warm instead of closing it out from under the start.
  const pendingStartRef = useRef(false);
  const deviceCache = useAudioInputDeviceCache(streamRef);

  idleRef.current = idle;
  onCaptureStartedRef.current = onCaptureStarted;
  onCaptureFailureRef.current = onCaptureFailure;
  onCaptureTimingsRef.current = onCaptureTimings;

  const reportTimings = useCallback(
    (
      captureSessionId: string,
      timings: AudioCaptureTimings,
      complete: boolean,
    ) => {
      const batch = timings.takeBatch();
      if (complete || batch.phases.length > 0 || batch.audioContext) {
        onCaptureTimingsRef.current?.(captureSessionId, batch, complete);
      }
    },
    [],
  );

  // Get the user's microphone fallback chain from settings.
  const { data: settings } = api.settings.getSettings.useQuery();
  const microphonePriorityRef = useRef(settings?.recording?.microphonePriority);
  // Preference changes apply to the next capture, without restarting this one.
  microphonePriorityRef.current = settings?.recording?.microphonePriority;

  const clearIdleTimer = useCallback(() => {
    contextLifetime.cancelIdleClose();
  }, [contextLifetime]);

  // Compute one overall voice-band loudness (getByteFrequencyData already maps
  // [minDecibels, maxDecibels] -> 0..255 per bin, so this auto-windows), push it
  // into the history, then read each bar at a different lag so a loud moment
  // ripples from bar 0 across the row.
  const updateBars = useCallback(() => {
    const analyser = analyserRef.current;
    const data = freqDataRef.current;
    if (!analyser || !data) return;
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let k = VOICE_BIN_LOW; k < VOICE_BIN_HIGH; k++) {
      sum += data[k];
    }
    const level = Math.min(
      1,
      (sum / (VOICE_BIN_HIGH - VOICE_BIN_LOW) / 255) * LEVEL_GAIN,
    );

    const hist = levelHistoryRef.current;
    hist.unshift(level);
    hist.length = LEVEL_HISTORY_LEN; // drop the oldest, keep fixed length
    const bars = new Array<number>(WAVEFORM_BAR_SLOTS);
    for (let b = 0; b < WAVEFORM_BAR_SLOTS; b++) {
      bars[b] = hist[b * BAR_STRIDE];
    }
    if (!disposedRef.current) {
      setAudioLevels(bars);
    }
  }, []);

  const resetBars = useCallback(() => {
    levelHistoryRef.current = new Array(LEVEL_HISTORY_LEN).fill(0);
    if (!disposedRef.current) {
      setAudioLevels(EMPTY_BARS);
    }
  }, []);

  // Fully release every audio resource (mic stream, nodes, context). The caller
  // must hold the mutex. Safe to call with any subset already torn down.
  const releaseAll = useCallback(async () => {
    contextRecoveryCleanupRef.current?.();
    contextRecoveryCleanupRef.current = null;
    pendingWorkletFlushRef.current?.finish();
    pendingWorkletFlushRef.current = null;
    trackCleanupRef.current?.();
    trackCleanupRef.current = null;
    const workletNode = contextLifetime.workletNode;
    if (sourceRef.current && workletNode) {
      try {
        sourceRef.current.disconnect(workletNode);
      } catch {
        // Nodes may already be detached or on a closed context.
      }
    }
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    freqDataRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    await contextLifetime.close();
    sourceRef.current = null;
    streamRef.current = null;
    resetBars();
  }, [resetBars, contextLifetime]);

  const startCapture = useCallback(
    async (
      onFailure: (error: unknown) => void,
      timings: AudioCaptureTimings,
    ) => {
      const captureSessionId = sessionId!;
      const attemptStartedAt = Date.now();
      const microphonePriority = microphonePriorityRef.current;
      // StrictMode can remount and call us before the teardown effect's cleanup is
      // reverted, so clear disposed here. pendingStartRef is read by closeIdleContext.
      disposedRef.current = false;
      pendingStartRef.current = true;
      await mutexRef.current
        .runExclusive(async () => {
          try {
            captureAttemptStartedAtRef.current = attemptStartedAt;
            const overallStartTime = performance.now();
            console.log("AudioCapture: Starting audio capture");

            // A new dictation started — cancel any pending idle teardown so the
            // warm AudioContext can be reused without being closed during startup.
            clearIdleTimer();

            // Read main's cached config once per dictation so capture options
            // stay fixed throughout the utterance.
            const remoteConfig = await utils.client.remoteConfig.get
              .query()
              .catch((error) => {
                console.warn(
                  "AudioCapture: Failed to read remote config",
                  error,
                );
                return null;
              });
            if (disposedRef.current) return;
            const stereoDownmixEnabled =
              remoteConfig?.flags[DESKTOP_STEREO_MIC_DOWNMIX_FLAG] === true;

            const { stream, audioTrack, microphone } =
              await acquireMicrophoneStream({
                microphonePriority,
                deviceCache,
                refreshDeviceCache:
                  remoteConfig?.flags[
                    DESKTOP_REFRESH_AUDIO_DEVICES_ON_START_FLAG
                  ] === true,
                sampleRate: SAMPLE_RATE,
                timings,
              });
            streamRef.current = stream;
            audioCaptureDiagnostics.logTrackState(audioTrack);
            trackCleanupRef.current?.();
            const removeTrackDiagnostics =
              audioCaptureDiagnostics.registerTrack(audioTrack);
            const onEnded = () =>
              onFailure(
                new Error("Microphone capture track ended unexpectedly"),
              );
            audioTrack.addEventListener("ended", onEnded);
            trackCleanupRef.current = () => {
              audioTrack.removeEventListener("ended", onEnded);
              removeTrackDiagnostics();
            };

            // Bail if the hook was disposed while we awaited the microphone, so we
            // don't build a graph (or resurrect a context) after unmount.
            if (disposedRef.current) {
              await releaseAll();
              return;
            }

            const { audioContext, workletNode } = await contextLifetime.prepare(
              timings,
              captureSessionId,
            );

            // Bail if disposed while resuming or loading the worklet module.
            if (disposedRef.current) {
              await releaseAll();
              return;
            }

            const source = createAudioCaptureSource(
              audioContext,
              stream,
              captureSessionId,
              timings,
            );
            sourceRef.current = source;
            attachAudioWorkletFrameHandler({
              workletNode,
              captureConfig: {
                stereoDownmixEnabled,
                trackChannelCount: audioTrack.getSettings?.().channelCount,
              },
              onFirstFrame: () => {
                timings.finishFirstFrameWait();
                // Hand the PCM frame to main first; timing reports never await
                // or delay audio delivery.
                queueMicrotask(() =>
                  reportTimings(captureSessionId, timings, false),
                );
              },
              onAudioChunk: (
                arrayBuffer,
                speechProbability,
                isFinalChunk,
                captureInfo,
              ) => {
                try {
                  updateBars();
                } catch (error) {
                  console.error(
                    "AudioCapture: Failed to update waveform bars:",
                    error,
                  );
                }
                return onAudioChunk(
                  captureSessionId,
                  arrayBuffer,
                  speechProbability,
                  isFinalChunk,
                  captureInfo,
                );
              },
              finishPendingFlush: (didFlush) =>
                pendingWorkletFlushRef.current?.finish(didFlush),
            });

            contextRecoveryCleanupRef.current = monitorAudioContextRecovery(
              audioContext,
              captureSessionId,
              onFailure,
              timings,
            );

            // Start this session before connecting its input. The processor
            // stays inactive after the previous session's final flush.
            workletNode.port.postMessage({
              type: "start",
              stereoDownmixEnabled,
            });
            source.connect(workletNode);
            timings.startFirstFrameWait();

            // Tap the source with an analyser for the spectrum visualiser. It's a
            // passive branch (no downstream connection) and doesn't touch the
            // worklet capture path.
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = ANALYSER_FFT_SIZE;
            analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
            analyser.minDecibels = ANALYSER_MIN_DB;
            analyser.maxDecibels = ANALYSER_MAX_DB;
            sourceRef.current.connect(analyser);
            analyserRef.current = analyser;
            freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);

            // Recording readiness requires the capture graph to be connected.
            const reportCaptureStarted = onCaptureStartedRef.current;
            if (reportCaptureStarted) {
              void Promise.resolve(
                reportCaptureStarted(
                  microphone,
                  captureSessionId,
                  timings.takeBatch(),
                ),
              ).catch((error) => {
                console.warn(
                  "AudioCapture: Failed to report active microphone:",
                  error,
                );
              });
            }

            const overallDuration = performance.now() - overallStartTime;
            console.log(
              `AudioCapture: Total startup took ${overallDuration.toFixed(2)}ms`,
            );
            console.log("AudioCapture: Audio capture started successfully");
          } catch (error) {
            console.error("AudioCapture: Failed to start capture:", error);
            // Release whatever was acquired before the failure so the mic doesn't
            // stay open. (Can't call stopCapture here — same mutex would deadlock.)
            await releaseAll();
            throw error;
          }
        })
        .finally(() => {
          pendingStartRef.current = false;
        });
    },
    [
      onAudioChunk,
      releaseAll,
      clearIdleTimer,
      updateBars,
      sessionId,
      deviceCache,
      utils,
      reportTimings,
      contextLifetime,
    ],
  );

  // Safe to recycle only when the app is idle with no active dictation and none
  // about to start. Shared by the scheduler and the timer's deferred close.
  const canRecycleWhileIdle = useCallback(
    () => idleRef.current && !streamRef.current && !pendingStartRef.current,
    [],
  );

  // Recycle the warm AudioContext only while the app is truly idle. Guarded by
  // the mutex so it can't race a concurrent start.
  const closeIdleContext = useCallback(async () => {
    await mutexRef.current.runExclusive(async () => {
      if (!canRecycleWhileIdle() || !contextLifetime.isIdleExpired()) {
        return;
      }
      if (contextLifetime.audioContext) {
        await releaseAll();
        console.log("AudioCapture: AudioContext recycled while idle");
      }
    });
  }, [releaseAll, canRecycleWhileIdle, contextLifetime]);

  const scheduleIdleContextRecycle = useCallback(() => {
    clearIdleTimer();

    if (
      disposedRef.current ||
      !canRecycleWhileIdle() ||
      !contextLifetime.audioContext
    ) {
      return;
    }

    contextLifetime.scheduleIdleClose(() => {
      closeIdleContext().catch((error) => {
        console.error("AudioCapture: Error recycling idle context:", error);
      });
    });
  }, [clearIdleTimer, closeIdleContext, canRecycleWhileIdle, contextLifetime]);

  // Resolves true once the worklet's final buffer has been flushed (or there is
  // nothing to flush), false if the flush request failed or timed out — in which
  // case the caller must force a full release.
  const waitForWorkletFlush = useCallback(async (): Promise<boolean> => {
    const workletNode = contextLifetime.workletNode;
    if (!streamRef.current || !workletNode) {
      return true;
    }

    const flushRequest = createWorkletFlushRequest({
      workletNode,
      timeoutMs: AUDIO_WORKLET_FLUSH_TIMEOUT_MS,
    });
    pendingWorkletFlushRef.current = flushRequest;
    flushRequest.request();

    const didFlush = await flushRequest.promise;
    if (pendingWorkletFlushRef.current === flushRequest) {
      pendingWorkletFlushRef.current = null;
    }
    return didFlush;
  }, [contextLifetime]);

  const stopCapture = useCallback(async () => {
    contextRecoveryCleanupRef.current?.();
    contextRecoveryCleanupRef.current = null;
    await mutexRef.current.runExclusive(async () => {
      contextRecoveryCleanupRef.current?.();
      contextRecoveryCleanupRef.current = null;
      console.log("AudioCapture: Stopping audio capture");
      try {
        // Flush while still connected. The processor stops accepting input
        // before it sends its final frame.
        const didFlush = await waitForWorkletFlush();
        if (!didFlush) {
          await releaseAll();
        }
      } catch (error) {
        console.error("AudioCapture: Error during stop:", error);
      } finally {
        // Always release the mic, even if the steps above threw — otherwise the
        // microphone could stay live.
        trackCleanupRef.current?.();
        trackCleanupRef.current = null;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        // Drop this dictation's input and analyser. Keep the worklet connected
        // to the destination so it is ready for the next input.
        if (sourceRef.current) {
          try {
            sourceRef.current.disconnect();
          } catch {
            // Already detached or on a closed context.
          }
        }
        analyserRef.current?.disconnect();
        sourceRef.current = null;
        streamRef.current = null;
        analyserRef.current = null;
        freqDataRef.current = null;
        resetBars();

        const startedAt = captureAttemptStartedAtRef.current;
        captureAttemptStartedAtRef.current = null;
        const shouldRecycle =
          startedAt !== null && contextLifetime.finishAttempt(startedAt);
        if (startedAt !== null && !disposedRef.current) {
          // Refresh for the next dictation without delaying cleanup or graph replacement.
          void deviceCache.refresh();
        }
        if (shouldRecycle && !disposedRef.current) {
          await contextLifetime.close();
          if (!disposedRef.current && !contextLifetime.isIdleExpired()) {
            try {
              await contextLifetime.prepare();
            } catch (error) {
              // Setup already reports its specific failure; the next capture can retry.
              console.warn(
                "AudioCapture: Could not prepare replacement context",
                error,
              );
            }
          }
          if (disposedRef.current) await releaseAll();
        }

        scheduleIdleContextRecycle();

        console.log("AudioCapture: Audio capture stopped");
      }
    });
  }, [
    releaseAll,
    scheduleIdleContextRecycle,
    waitForWorkletFlush,
    resetBars,
    contextLifetime,
    deviceCache,
  ]);

  // Start/stop based on enabled state
  useEffect(() => {
    if (!enabled || !sessionId) {
      return;
    }

    // Retire both startup errors and track-loss reports before teardown.
    let isCurrentAttempt = true;
    let failureReported = false;
    // A collector belongs to this effect's capture attempt until it stops.
    // A later session cannot steal its pending phases.
    const timings = new AudioCaptureTimings();
    const reportFailure = (error: unknown) => {
      if (!isCurrentAttempt || failureReported) {
        return;
      }
      failureReported = true;

      const reportCaptureFailure = onCaptureFailureRef.current;
      if (reportCaptureFailure) {
        reportCaptureFailure(
          {
            sessionId,
            ...normalizeCaptureFailure(error),
          },
          timings.takeBatch(),
        );
      }
    };
    startCapture(reportFailure, timings).catch((error) => {
      console.error("AudioCapture: Failed to start:", error);
      reportFailure(error);
    });

    return () => {
      isCurrentAttempt = false;
      stopCapture()
        .catch((error) => {
          console.error("AudioCapture: Failed to stop:", error);
        })
        .finally(() => {
          reportTimings(sessionId, timings, true);
        });
      // Publish incidents before optional graph replacement delays completion.
      reportTimings(sessionId, timings, false);
    };
  }, [enabled, sessionId, startCapture, stopCapture, reportTimings]);

  useEffect(() => {
    if (!idle) {
      clearIdleTimer();
      return;
    }

    scheduleIdleContextRecycle();

    return () => {
      clearIdleTimer();
    };
  }, [idle, clearIdleTimer, scheduleIdleContextRecycle]);

  // Prepare at recorder mount without opening the mic. Keep this effect after
  // the capture effect so unmount queues the final flush before graph release.
  useEffect(() => {
    disposedRef.current = false;
    void mutexRef.current.runExclusive(async () => {
      if (disposedRef.current) return;
      try {
        await contextLifetime.prepare();
      } catch (error) {
        console.warn("AudioCapture: Could not prepare startup context", error);
      }
      if (disposedRef.current) {
        await releaseAll();
      } else {
        scheduleIdleContextRecycle();
      }
    });
    return () => {
      disposedRef.current = true;
      clearIdleTimer();
      void mutexRef.current.runExclusive(() => releaseAll());
    };
  }, [releaseAll, clearIdleTimer, contextLifetime, scheduleIdleContextRecycle]);

  return {
    audioLevels,
  };
};
