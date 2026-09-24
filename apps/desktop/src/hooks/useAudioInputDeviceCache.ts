import { useEffect, useRef, type RefObject } from "react";
import { api } from "@/trpc/react";
import { AudioInputDeviceCache } from "./audioCaptureDevice";
import { audioCaptureDiagnostics } from "./audioCaptureDiagnostics";

/** Keeps the recorder's device snapshot current across capture sessions. */
export function useAudioInputDeviceCache(
  streamRef: RefObject<MediaStream | null>,
): AudioInputDeviceCache {
  const cacheRef = useRef<AudioInputDeviceCache | null>(null);
  if (!cacheRef.current) cacheRef.current = new AudioInputDeviceCache();
  const cache = cacheRef.current;

  api.recording.systemResume.useSubscription(undefined, {
    onData: () => {
      void cache.refresh();
    },
  });

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const handleDeviceChange = () => {
      const stream = streamRef.current;
      audioCaptureDiagnostics.logDeviceChange(
        Boolean(stream),
        stream?.getAudioTracks()[0],
      );
      void cache.refresh();
    };

    navigator.mediaDevices.addEventListener?.(
      "devicechange",
      handleDeviceChange,
    );
    void cache.refresh();

    return () => {
      navigator.mediaDevices.removeEventListener?.(
        "devicechange",
        handleDeviceChange,
      );
    };
  }, [cache, streamRef]);

  return cache;
}
