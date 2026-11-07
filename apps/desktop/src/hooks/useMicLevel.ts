import { useEffect, useRef, useState } from "react";
import {
  VOICE_LEVEL_SAMPLE_RATE,
  createVoiceLevelMeter,
  createVoiceLevelTap,
  type VoiceLevelMeter,
} from "./voiceLevelMeter";

/**
 * Open a microphone stream for `deviceId` while `enabled` is true and report a
 * smoothed voice level in the range 0..1, measured like the recording widget.
 * Used to preview the live audio level of the device the user is configuring.
 * The stream and AudioContext are torn down whenever the device changes or the
 * hook is disabled/unmounted.
 *
 * `deviceId` accepts the same values as the recording pipeline, including the
 * `"default"` sentinel for the system-default microphone.
 */
export function useMicLevel(
  deviceId: string | undefined,
  enabled: boolean,
): number {
  const [level, setLevel] = useState(0);
  // Smoothed level kept in a ref so the rAF loop doesn't depend on state.
  const smoothedRef = useRef(0);
  // One meter per preview, so the learned room-noise floor survives reopening
  // the preview or switching devices.
  const meterRef = useRef<VoiceLevelMeter | null>(null);
  meterRef.current ??= createVoiceLevelMeter(VOICE_LEVEL_SAMPLE_RATE);
  const measureLevel = meterRef.current;

  useEffect(() => {
    if (!enabled || !deviceId || !navigator.mediaDevices) {
      setLevel(0);
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let rafId = 0;
    smoothedRef.current = 0;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        // Meter at the widget's analysis rate, so the window and bins match.
        audioContext = new AudioContext({
          sampleRate: VOICE_LEVEL_SAMPLE_RATE,
        });
        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }
        const source = audioContext.createMediaStreamSource(stream);
        const tap = createVoiceLevelTap(audioContext, source, measureLevel);
        let lastMs = performance.now();

        const tick = (nowMs: number) => {
          const target = tap.read(
            Math.min(0.1, Math.max(0, nowMs - lastMs) / 1000),
          );
          lastMs = nowMs;
          // Fast attack, slow decay so the meter feels responsive but readable.
          const prev = smoothedRef.current;
          smoothedRef.current =
            target > prev ? target : prev * 0.82 + target * 0.18;
          setLevel(smoothedRef.current);
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } catch (err) {
        if (!cancelled) {
          console.error("useMicLevel: failed to open microphone stream", err);
          setLevel(0);
        }
      }
    };

    start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((track) => track.stop());
      audioContext?.close().catch(() => {});
      setLevel(0);
    };
  }, [deviceId, enabled, measureLevel]);

  return level;
}
