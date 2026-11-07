import { EventEmitter } from "node:events";
import type { WidgetNotification } from "../../types/widget-notification";

// Main-to-widget channel for learned-word toasts. The recording router's
// widgetNotifications subscription forwards these next to the lifecycle's own
// notifications, so the widget needs no second subscription.
const emitter = new EventEmitter();

export const vocabularyLearningNotifications = {
  emit(notification: WidgetNotification): void {
    emitter.emit("learned", notification);
  },
  onLearned(listener: (notification: WidgetNotification) => void): () => void {
    emitter.on("learned", listener);
    return () => {
      emitter.off("learned", listener);
    };
  },
};
