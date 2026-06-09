import { useEffect, useRef, useState } from "react";

/**
 * Open a microphone stream for `deviceId` while `enabled` is true and report a
 * smoothed input level in the range 0..1. Used to preview the live audio level
 * of the device the user is configuring. The stream and AudioContext are torn
 * down whenever the device changes or the hook is disabled/unmounted.
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

        audioContext = new AudioContext();
        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0;
        source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);

        const tick = () => {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (let i = 0; i < samples.length; i++) {
            sum += samples[i] * samples[i];
          }
          const rms = Math.sqrt(sum / samples.length);
          // Speech RMS sits low, and a linear gain barely moves the meter unless
          // you shout. Map to a perceptual dB scale instead (like a real level
          // meter): ~[-52 dB, -14 dB] -> [0, 1], so normal talking fills most of
          // the bar and ambient noise stays near the floor.
          const db = 20 * Math.log10(rms || 1e-7);
          const target = Math.min(1, Math.max(0, (db + 52) / 38));
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
  }, [deviceId, enabled]);

  return level;
}
