import { app } from "electron";
import { EventEmitter } from "events";
import { logger } from "../logger";

export class AutoUpdaterService extends EventEmitter {
  constructor() {
    super();
  }

  // These methods are kept for compatibility with existing code
  // update-electron-app handles the actual update logic

  async checkForUpdates(userInitiated = false): Promise<void> {
    logger.updater.info(
      "Update check requested, handled by update-electron-app",
    );
  }

  async checkForUpdatesAndNotify(): Promise<void> {
    logger.updater.info(
      "Background update check requested, handled by update-electron-app",
    );
  }

  isCheckingForUpdate(): boolean {
    return false; // Handled by update-electron-app
  }

  isUpdateAvailable(): boolean {
    return false; // Handled by update-electron-app
  }

  async downloadUpdate(): Promise<void> {
    logger.updater.info(
      "Download update requested, handled by update-electron-app",
    );
  }

  quitAndInstall(): void {
    logger.updater.info(
      "Quit and install requested, handled by update-electron-app",
    );
    app.quit();
  }
}
