import { app, Tray, Menu, nativeImage } from "electron";
import * as path from "path";
import { logger } from "../logger";
import type { WindowManager } from "../core/window-manager";
import { isMacOS, isWindows } from "../../utils/platform";

export class TrayManager {
  private static instance: TrayManager | null = null;
  private tray: Tray | null = null;
  private windowManager: WindowManager | null = null;

  private constructor() {}

  static getInstance(): TrayManager {
    if (!TrayManager.instance) {
      TrayManager.instance = new TrayManager();
    }
    return TrayManager.instance;
  }

  initialize(windowManager: WindowManager): void {
    this.windowManager = windowManager;
    // Create tray icon
    const iconPath = this.getIconPath();
    logger.main.info(`Loading tray icon from: ${iconPath}`);

    const icon = nativeImage.createFromPath(iconPath);

    // Log icon details for debugging
    const size = icon.getSize();
    logger.main.info(
      `Icon loaded - Width: ${size.width}, Height: ${size.height}, Empty: ${icon.isEmpty()}`,
    );

    // On macOS, mark as template image for proper light/dark mode support
    // Use guid to persist menu bar position between app launches
    if (isMacOS()) {
      icon.setTemplateImage(true);
    }
    this.tray = new Tray(icon);

    // Set tooltip
    this.tray.setToolTip("Vox");

    // Create context menu
    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Open Console",
        click: async () => {
          logger.main.info("Open console requested from tray");
          if (this.windowManager) {
            await this.windowManager.createOrShowMainWindow();
          }
        },
      },
      { type: "separator" as const },
      ...(isMacOS()
        ? [{ role: "about" as const }]
        : [
            {
              label: "About",
              click: () => {
                app.showAboutPanel();
              },
            },
          ]),
      {
        label: `Version ${app.getVersion()}`,
        enabled: false,
      },
      { type: "separator" as const },
      {
        label: "Quit",
        click: () => {
          logger.main.info("Quit requested from tray");
          app.quit();
        },
      },
    ]);

    // Set the context menu
    this.tray.setContextMenu(contextMenu);

    logger.main.info("Tray initialized successfully");
  }

  private getIconPath(): string {
    // Use appropriate icon based on platform
    const iconName = isWindows()
      ? "icon-256x256.png" // Windows uses standard icon
      : "iconTemplate.png"; // macOS uses template naming convention

    if (app.isPackaged) {
      // When packaged, assets are placed next to the bundled resources path
      return path.join(process.resourcesPath, "assets", iconName);
    }

    // In development, rely on the project root returned by Electron
    // This avoids brittle relative traversals from the transpiled directory structure
    return path.join(app.getAppPath(), "assets", iconName);
  }

  cleanup(): void {
    //! DO NOT MANUALLY DESTROY, THIS RESETS THE TRAY POSITION
    //! EVEN IF IT SHOULDN'T
    /* if (this.tray && !this.tray.isDestroyed()) {
      this.tray.destroy();
      this.tray = null;
      logger.main.info("Tray cleaned up");
    } */
  }
}
