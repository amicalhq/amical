import { HelperEvent } from "@amical/types";
import { AppManager } from "./app-manager";
import { logger } from "../logger";

export class EventHandlers {
  private appManager: AppManager;

  constructor(appManager: AppManager) {
    this.appManager = appManager;
  }

  setupEventHandlers(): void {
    this.setupSwiftBridgeEventHandlers();
    // Note: Audio IPC handlers are now managed by RecordingService
  }

  private setupSwiftBridgeEventHandlers(): void {
    try {
      const swiftBridge = this.appManager.getSwiftIOBridge();
      const windowManager = this.appManager.getWindowManager();

      swiftBridge.on("helperEvent", (event: HelperEvent) => {
        logger.swift.debug("Received helperEvent from SwiftIOBridge", {
          event,
        });

        switch (event.type) {
          case "flagsChanged": {
            const payload = event.payload;
            if (payload?.fnKeyPressed !== undefined) {
              logger.swift.info("Setting recording state", {
                state: payload.fnKeyPressed,
              });
              const widgetWindow = windowManager.getWidgetWindow();
              if (widgetWindow) {
                widgetWindow.webContents.send(
                  "recording-state-changed",
                  payload.fnKeyPressed,
                );
              }
            }
            break;
          }
          case "keyDown":
          case "keyUp":
            break;
          default:
            break;
        }
      });

      swiftBridge.on("error", (error: Error) => {
        logger.main.error("SwiftIOBridge error:", error);
      });

      swiftBridge.on("close", (code: number | null) => {
        logger.swift.warn("Swift helper process closed", { code });
      });
    } catch (error) {
      logger.main.warn("Swift bridge not available for event handlers");
    }
  }
}
