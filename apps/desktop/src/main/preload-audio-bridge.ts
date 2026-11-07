import { ipcRenderer } from "electron";
import type { AudioCaptureInfo } from "../types/audio-capture";

/**
 * The renderer→main audio-capture bridge for windows that stream microphone
 * PCM (the main and widget windows, via preload.ts). Owns the IPC channel
 * names and the Float32Array→ArrayBuffer transfer format.
 */
export const audioBridge = {
  sendAudioChunk: (
    sessionId: string,
    chunk: Float32Array,
    isFinalChunk: boolean = false,
    captureInfo?: AudioCaptureInfo,
  ): Promise<void> => {
    // Convert Float32Array to ArrayBuffer for IPC transfer
    const buffer = chunk.buffer.slice(
      chunk.byteOffset,
      chunk.byteOffset + chunk.byteLength,
    );
    return ipcRenderer.invoke(
      "audio-data-chunk",
      sessionId,
      buffer,
      isFinalChunk,
      captureInfo,
    );
  },

  onForceStopMediaRecorder: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("force-stop-mediarecorder", handler);
    return () => {
      ipcRenderer.removeListener("force-stop-mediarecorder", handler);
    };
  },
};
