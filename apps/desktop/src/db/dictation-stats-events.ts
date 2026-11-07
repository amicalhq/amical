import { EventEmitter } from "node:events";

export const dictationStatsEvents = new EventEmitter();

export function notifyDictationStatsChanged(): void {
  queueMicrotask(() => dictationStatsEvents.emit("changed"));
}
