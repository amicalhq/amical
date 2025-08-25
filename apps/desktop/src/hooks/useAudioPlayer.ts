import { useRef, useState, useCallback, useEffect } from "react";

interface UseAudioPlayerReturn {
  isPlaying: boolean;
  currentPlayingId: number | null;
  play: (
    audioData: ArrayBuffer,
    transcriptionId: number,
    mimeType?: string,
  ) => void;
  pause: () => void;
  stop: () => void;
  toggle: (
    audioData: ArrayBuffer,
    transcriptionId: number,
    mimeType?: string,
  ) => void;
}

export function useAudioPlayer(): UseAudioPlayerReturn {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPlayingId, setCurrentPlayingId] = useState<number | null>(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }
    setIsPlaying(false);
    setCurrentPlayingId(null);
  }, []);

  const play = useCallback(
    (
      audioData: ArrayBuffer,
      transcriptionId: number,
      mimeType: string = "audio/wav",
    ) => {
      cleanup();

      const blob = new Blob([audioData], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);
      currentBlobUrlRef.current = blobUrl;

      if (!audioRef.current) {
        audioRef.current = new Audio();
      }

      audioRef.current.src = blobUrl;
      audioRef.current.onended = () => {
        setIsPlaying(false);
        setCurrentPlayingId(null);
      };

      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
          setCurrentPlayingId(transcriptionId);
        })
        .catch((error) => {
          console.error("Failed to play audio:", error);
          cleanup();
        });
    },
    [cleanup],
  );

  const pause = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const stop = useCallback(() => {
    cleanup();
  }, [cleanup]);

  const toggle = useCallback(
    (audioData: ArrayBuffer, transcriptionId: number, mimeType?: string) => {
      if (currentPlayingId === transcriptionId && isPlaying) {
        pause();
      } else {
        play(audioData, transcriptionId, mimeType);
      }
    },
    [currentPlayingId, isPlaying, pause, play],
  );

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    isPlaying,
    currentPlayingId,
    play,
    pause,
    stop,
    toggle,
  };
}
