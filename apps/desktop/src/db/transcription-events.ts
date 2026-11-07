import { EventEmitter } from "node:events";

export const transcriptionEvents = new EventEmitter();

export function notifyTranscriptionSettled(transcriptionId: number): void {
  queueMicrotask(() =>
    transcriptionEvents.emit("transcription-settled", transcriptionId),
  );
}
