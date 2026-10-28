import { EventEmitter } from "node:events";

// Emitted when cloud dictation may have changed the server's word count: a
// successful cloud result or a quota rejection.
export const cloudUsageEvents = new EventEmitter();

export function notifyCloudUsageChanged(quotaExceeded = false): void {
  queueMicrotask(() => cloudUsageEvents.emit("changed", quotaExceeded));
}
