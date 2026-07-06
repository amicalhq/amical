import { useRef, useEffect, useState, useCallback } from "react";
import audioWorkletUrl from "@/assets/audio-recorder-processor.js?url";
import { api } from "@/trpc/react";
import { Mutex } from "async-mutex";
import { audioCaptureDiagnostics } from "./audioCaptureDiagnostics";
import {
  createAudioCaptureGraph,
  createOrResumeAudioContext,
} from "./audioCaptureContext";
import {
  acquireMicrophoneStream,
  type AcquiredMicrophoneMetadata,
} from "./audioCaptureDevice";
import { computeIdleRecycleDelayMs } from "./audioCaptureRecycle";
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

export interface UseAudioCaptureParams {
  onAudioChunk: (
    arrayBuffer: ArrayBuffer,
    speechProbability: number,
    isFinalChunk: boolean,
  ) => Promise<void> | void;
  onCaptureStarted?: (
    microphone: AcquiredMicrophoneMetadata,
  ) => Promise<void> | void;
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
  enabled,
  idle,
}: UseAudioCaptureParams): UseAudioCaptureOutput => {
  const [audioLevels, setAudioLevels] = useState<number[]>(EMPTY_BARS);
  // Analyser tap, reused byte buffer, and the rolling level history — kept in
  // refs so the frame handler doesn't depend on state.
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqDataRef = useRef<Uint8Array | null>(null);
  const levelHistoryRef = useRef<number[]>(
    new Array(LEVEL_HISTORY_LEN).fill(0),
  );
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackDiagnosticsCleanupRef = useRef<(() => void) | null>(null);
  const mutexRef = useRef(new Mutex());
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleRef = useRef(idle);
  const onCaptureStartedRef = useRef(onCaptureStarted);
  const pendingWorkletFlushRef = useRef<WorkletFlushRequest | null>(null);
  // performance.now() when the current AudioContext was constructed (for max-age).
  const contextCreatedAtRef = useRef(0);
  // Set true once the hook unmounts so deferred mutex bodies stop touching state.
  const disposedRef = useRef(false);
  // Set synchronously the instant a start is requested, so a just-fired idle
  // timer keeps the context warm instead of closing it out from under the start.
  const pendingStartRef = useRef(false);

  idleRef.current = idle;
  onCaptureStartedRef.current = onCaptureStarted;

  // Get the user's microphone fallback chain from settings.
  const { data: settings } = api.settings.getSettings.useQuery();
  const microphonePriority = settings?.recording?.microphonePriority;
  // Stable key so the memoized startCapture re-creates on any chain change
  // (incl. reorders that keep the top entry), not on every settings refetch.
  const microphonePriorityKey = JSON.stringify(microphonePriority ?? []);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

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
    pendingWorkletFlushRef.current?.finish();
    pendingWorkletFlushRef.current = null;
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
    }
    trackDiagnosticsCleanupRef.current?.();
    trackDiagnosticsCleanupRef.current = null;
    if (sourceRef.current && workletNodeRef.current) {
      try {
        sourceRef.current.disconnect(workletNodeRef.current);
      } catch {
        // Nodes may already be detached or on a closed context.
      }
    }
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    freqDataRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => {});
    }
    sourceRef.current = null;
    workletNodeRef.current = null;
    audioContextRef.current = null;
    streamRef.current = null;
    resetBars();
  }, [resetBars]);

  const startCapture = useCallback(async () => {
    // StrictMode can remount and call us before the teardown effect's cleanup is
    // reverted, so clear disposed here. pendingStartRef is read by closeIdleContext.
    disposedRef.current = false;
    pendingStartRef.current = true;
    await mutexRef.current
      .runExclusive(async () => {
        try {
          const overallStartTime = performance.now();
          console.log("AudioCapture: Starting audio capture");

          // A new dictation started — cancel any pending idle teardown so the
          // warm AudioContext is resumed rather than closed out from under us.
          clearIdleTimer();

          const { stream, audioTrack, microphone } =
            await acquireMicrophoneStream({
              microphonePriority,
              sampleRate: SAMPLE_RATE,
            });
          streamRef.current = stream;
          audioCaptureDiagnostics.logTrackState(audioTrack);
          trackDiagnosticsCleanupRef.current?.();
          trackDiagnosticsCleanupRef.current =
            audioCaptureDiagnostics.registerTrack(audioTrack);

          // Bail if the hook was disposed while we awaited the microphone, so we
          // don't build a graph (or resurrect a context) after unmount.
          if (disposedRef.current) {
            await releaseAll();
            return;
          }

          const reportCaptureStarted = onCaptureStartedRef.current;
          if (reportCaptureStarted) {
            void Promise.resolve(reportCaptureStarted(microphone)).catch(
              (error) => {
                console.warn(
                  "AudioCapture: Failed to report active microphone:",
                  error,
                );
              },
            );
          }

          const { audioContext, createdAt } = await createOrResumeAudioContext({
            currentAudioContext: audioContextRef.current,
            sampleRate: SAMPLE_RATE,
            audioWorkletUrl,
          });
          audioContextRef.current = audioContext;
          if (createdAt !== undefined) {
            contextCreatedAtRef.current = createdAt;
          }

          // Bail if disposed while resuming or loading the worklet module.
          if (disposedRef.current) {
            await releaseAll();
            return;
          }

          const { source, workletNode } = createAudioCaptureGraph(
            audioContextRef.current,
            streamRef.current,
          );
          sourceRef.current = source;
          workletNodeRef.current = workletNode;
          attachAudioWorkletFrameHandler({
            workletNode,
            onAudioChunk: (arrayBuffer, speechProbability, isFinalChunk) => {
              try {
                updateBars();
              } catch (error) {
                console.error(
                  "AudioCapture: Failed to update waveform bars:",
                  error,
                );
              }
              return onAudioChunk(arrayBuffer, speechProbability, isFinalChunk);
            },
            finishPendingFlush: (didFlush) =>
              pendingWorkletFlushRef.current?.finish(didFlush),
          });

          // Connect audio graph
          sourceRef.current.connect(workletNodeRef.current);

          // Tap the source with an analyser for the spectrum visualiser. It's a
          // passive branch (no downstream connection) and doesn't touch the
          // worklet capture path.
          const analyser = audioContextRef.current.createAnalyser();
          analyser.fftSize = ANALYSER_FFT_SIZE;
          analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
          analyser.minDecibels = ANALYSER_MIN_DB;
          analyser.maxDecibels = ANALYSER_MAX_DB;
          sourceRef.current.connect(analyser);
          analyserRef.current = analyser;
          freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);

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
  }, [
    onAudioChunk,
    microphonePriorityKey,
    releaseAll,
    clearIdleTimer,
    updateBars,
  ]);

  // Device-change diagnostics are only attached while dictation is active, so
  // they don't enumerate/log in the background when not recording.
  useEffect(() => {
    if (!enabled || !navigator.mediaDevices?.addEventListener) {
      return;
    }

    const handleDeviceChange = async () => {
      const audioTrack = streamRef.current?.getAudioTracks()[0];
      audioCaptureDiagnostics.logDeviceChange(
        Boolean(streamRef.current),
        audioTrack,
      );

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        audioCaptureDiagnostics.logAudioInputDevices(
          "Audio input devices after devicechange",
          devices,
        );
      } catch (error) {
        audioCaptureDiagnostics.logDeviceEnumerationFailure(
          "Failed to enumerate devices after devicechange",
          error,
        );
      }
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
    };
  }, [enabled]);

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
      if (!canRecycleWhileIdle()) {
        return;
      }
      if (audioContextRef.current) {
        await releaseAll();
        console.log("AudioCapture: AudioContext recycled while idle");
      }
    });
  }, [releaseAll, canRecycleWhileIdle]);

  const scheduleIdleContextRecycle = useCallback(() => {
    clearIdleTimer();

    if (
      disposedRef.current ||
      !canRecycleWhileIdle() ||
      !audioContextRef.current
    ) {
      return;
    }

    const idleRecycleDelayMs = computeIdleRecycleDelayMs(
      performance.now() - contextCreatedAtRef.current,
    );

    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      closeIdleContext().catch((error) => {
        console.error("AudioCapture: Error recycling idle context:", error);
      });
    }, idleRecycleDelayMs);
  }, [clearIdleTimer, closeIdleContext, canRecycleWhileIdle]);

  // Resolves true once the worklet's final buffer has been flushed (or there is
  // nothing to flush), false if the flush request failed or timed out — in which
  // case the caller must force a full release rather than just suspend.
  const waitForWorkletFlush = useCallback(async (): Promise<boolean> => {
    const workletNode = workletNodeRef.current;
    if (!workletNode) {
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
  }, []);

  const stopCapture = useCallback(async () => {
    await mutexRef.current.runExclusive(async () => {
      console.log("AudioCapture: Stopping audio capture");
      try {
        // Flush while still connected so the worklet remains pulled by the
        // render graph. Any post-flush samples are harmless because this node is
        // per-dictation and is dropped before the next recording.
        const didFlush = await waitForWorkletFlush();
        if (!didFlush) {
          await releaseAll();
          return;
        }
        // Suspend (not close) so the next dictation can resume it. The source's
        // edges are dropped in the finally, so every stop path cleans them up.
        if (audioContextRef.current?.state === "running") {
          await audioContextRef.current.suspend().catch(() => {});
        }
      } catch (error) {
        console.error("AudioCapture: Error during stop:", error);
      } finally {
        // Always release the mic, even if the steps above threw — otherwise the
        // microphone could stay live.
        trackDiagnosticsCleanupRef.current?.();
        trackDiagnosticsCleanupRef.current = null;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        // Keep the suspended AudioContext for reuse; drop per-dictation nodes and
        // stream. Fully disconnect the source first so its worklet + analyser-tap
        // edges don't leave stopped nodes attached to the retained context.
        if (sourceRef.current) {
          try {
            sourceRef.current.disconnect();
          } catch {
            // Already detached or on a closed context.
          }
        }
        sourceRef.current = null;
        workletNodeRef.current = null;
        streamRef.current = null;
        analyserRef.current = null;
        freqDataRef.current = null;
        resetBars();

        // Context/worklet recycling is scheduled only once the main recording
        // state is idle, so the final flush can complete while stopping.
        scheduleIdleContextRecycle();

        console.log("AudioCapture: Audio capture stopped");
      }
    });
  }, [
    releaseAll,
    scheduleIdleContextRecycle,
    waitForWorkletFlush,
    resetBars,
  ]);

  // Start/stop based on enabled state
  useEffect(() => {
    if (!enabled) {
      return;
    }

    startCapture().catch((error) => {
      console.error("AudioCapture: Failed to start:", error);
    });

    return () => {
      stopCapture().catch((error) => {
        console.error("AudioCapture: Failed to stop:", error);
      });
    };
  }, [enabled, startCapture, stopCapture]);

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

  // Final teardown on unmount: mark disposed, cancel the idle timer, and release
  // the AudioContext through the mutex so it runs strictly after any in-flight
  // start/stopCapture rather than racing them (which could orphan a context or
  // leave the mic live).
  useEffect(() => {
    return () => {
      disposedRef.current = true;
      clearIdleTimer();
      void mutexRef.current.runExclusive(() => releaseAll());
    };
  }, [releaseAll, clearIdleTimer]);

  return {
    audioLevels,
  };
};
