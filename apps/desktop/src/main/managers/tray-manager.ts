import {
  app,
  Tray,
  Menu,
  nativeImage,
  type MenuItemConstructorOptions,
  type BrowserWindow,
  type WebContents,
} from "electron";
import * as path from "path";
import { logger } from "../logger";
import type { WindowManager } from "../core/window-manager";
import type { SettingsService } from "../../services/settings-service";
import { isMacOS, isWindows } from "../../utils/platform";

interface TrayAudioInputDevice {
  label: string;
  isDefault: boolean;
}

const AUDIO_DEVICE_DISCOVERY_SCRIPT = `
  (async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return [];
      }

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      let detectedDefaultName = "";

      const defaultDevice = allDevices.find((device) =>
        device.kind === "audioinput" &&
        typeof device.label === "string" &&
        device.label.toLowerCase().startsWith("default")
      );

      if (defaultDevice && defaultDevice.label) {
        const match = defaultDevice.label.match(/Default\\s*-\\s*(.+)|Default\\s*\\((.+)\\)/i);
        if (match) {
          detectedDefaultName = match[1] || match[2] || "";
        }
      }

      const seenLabels = new Set();
      const microphones = allDevices
        .filter((device) => device.kind === "audioinput")
        .filter((device) => {
          const label = (device.label || "").trim();
          if (!label) return false;
          if (label.toLowerCase().startsWith("default")) return false;
          if (seenLabels.has(label)) return false;
          seenLabels.add(label);
          return true;
        })
        .map((device) => ({
          label: device.label,
          isDefault: false,
        }));

      return [
        {
          label: detectedDefaultName
            ? "System Default (" + detectedDefaultName + ")"
            : "System Default",
          isDefault: true,
        },
        ...microphones,
      ];
    } catch (_error) {
      return [];
    }
  })();
`;

export class TrayManager {
  private static instance: TrayManager | null = null;
  private tray: Tray | null = null;
  private windowManager: WindowManager | null = null;
  private settingsService: SettingsService | null = null;
  private isShowingContextMenu = false;

  private constructor() {}

  static getInstance(): TrayManager {
    if (!TrayManager.instance) {
      TrayManager.instance = new TrayManager();
    }
    return TrayManager.instance;
  }

  initialize(
    windowManager: WindowManager,
    settingsService: SettingsService,
  ): void {
    this.windowManager = windowManager;
    this.settingsService = settingsService;
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
    this.tray.setToolTip("Grizzo");

    this.setupTrayEventHandlers();

    logger.main.info("Tray initialized successfully");
  }

  private setupTrayEventHandlers(): void {
    if (!this.tray) {
      return;
    }

    const showContextMenu = () => {
      void this.showContextMenu();
    };

    if (isMacOS()) {
      this.tray.on("click", showContextMenu);
      return;
    }

    this.tray.on("right-click", showContextMenu);
  }

  private async showContextMenu(): Promise<void> {
    if (!this.tray || this.isShowingContextMenu) {
      return;
    }

    this.isShowingContextMenu = true;

    try {
      const contextMenu = await this.buildContextMenu();
      this.tray.popUpContextMenu(contextMenu);
    } catch (error) {
      logger.main.error("Failed to show tray context menu", { error });
    } finally {
      this.isShowingContextMenu = false;
    }
  }

  private async buildContextMenu(): Promise<Menu> {
    const microphoneSection = await this.buildMicrophoneSection();
    const modeSection = await this.buildModeSection();

    const template: MenuItemConstructorOptions[] = [
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
      microphoneSection,
      modeSection,
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
    ];

    return Menu.buildFromTemplate(template);
  }

  private async buildMicrophoneSection(): Promise<MenuItemConstructorOptions> {
    if (!this.settingsService) {
      return {
        label: "Microphone",
        enabled: false,
      };
    }

    const recordingSettings = await this.settingsService.getRecordingSettings();
    const preferredMicrophoneName = recordingSettings?.preferredMicrophoneName;
    const availableDevices = await this.getAvailableAudioInputDevices();
    const devices =
      availableDevices.length > 0
        ? availableDevices
        : [{ label: "System Default", isDefault: true }];

    const selectedDeviceExists =
      !!preferredMicrophoneName &&
      devices.some(
        (device) => !device.isDefault && device.label === preferredMicrophoneName,
      );

    const activeMicrophoneLabel = preferredMicrophoneName
      ? selectedDeviceExists
        ? preferredMicrophoneName
        : `${preferredMicrophoneName} (Unavailable)`
      : (devices.find((device) => device.isDefault)?.label ?? "System Default");

    const microphoneItems: MenuItemConstructorOptions[] = [];

    if (preferredMicrophoneName && !selectedDeviceExists) {
      microphoneItems.push({
        label: `${preferredMicrophoneName} (Unavailable)`,
        type: "radio",
        checked: true,
        enabled: false,
      });
      microphoneItems.push({ type: "separator" as const });
    }

    for (const device of devices) {
      microphoneItems.push({
        label: device.label,
        type: "radio",
        checked: device.isDefault
          ? !preferredMicrophoneName
          : device.label === preferredMicrophoneName,
        click: () => {
          void this.setPreferredMicrophoneName(
            device.isDefault ? undefined : device.label,
          );
        },
      });
    }

    return {
      label: activeMicrophoneLabel,
      submenu: microphoneItems,
    };
  }

  private async buildModeSection(): Promise<MenuItemConstructorOptions> {
    if (!this.settingsService) {
      return {
        label: "Mode",
        enabled: false,
      };
    }

    try {
      const { items, activeModeId } = await this.settingsService.getModes();

      if (items.length === 0) {
        return {
          label: "Mode",
          enabled: false,
        };
      }

      const activeMode = items.find((mode) => mode.id === activeModeId);
      const activeModeLabel = activeMode?.name ?? items[0].name;

      return {
        label: activeModeLabel,
        submenu: items.map((mode) => ({
          label: mode.name,
          type: "radio",
          checked: mode.id === activeModeId,
          click: () => {
            void this.setActiveMode(mode.id);
          },
        })),
      };
    } catch (error) {
      logger.main.error("Failed to build mode tray menu", { error });
      return {
        label: "Mode",
        enabled: false,
      };
    }
  }

  private async setActiveMode(modeId: string): Promise<void> {
    if (!this.settingsService) {
      return;
    }

    try {
      await this.settingsService.setActiveMode(modeId);
      logger.main.info("Active mode changed from tray", { modeId });
    } catch (error) {
      logger.main.error("Failed to set active mode from tray", {
        modeId,
        error,
      });
    }
  }

  private async setPreferredMicrophoneName(
    deviceName: string | undefined,
  ): Promise<void> {
    if (!this.settingsService) {
      return;
    }

    try {
      const currentSettings = await this.settingsService.getRecordingSettings();
      const updatedSettings = {
        defaultFormat: "wav" as const,
        sampleRate: 16000 as const,
        autoStopSilence: false,
        silenceThreshold: 0.1,
        maxRecordingDuration: 300,
        ...currentSettings,
        preferredMicrophoneName: deviceName,
      };
      await this.settingsService.setRecordingSettings(updatedSettings);
      logger.main.info("Preferred microphone changed from tray", {
        microphone: deviceName ?? "System Default",
      });
    } catch (error) {
      logger.main.error("Failed to set preferred microphone from tray", {
        deviceName,
        error,
      });
    }
  }

  private async getAvailableAudioInputDevices(): Promise<TrayAudioInputDevice[]> {
    const webContentsCandidates = this.getWebContentsCandidates();

    for (const webContents of webContentsCandidates) {
      try {
        const rawDevices = await webContents.executeJavaScript(
          AUDIO_DEVICE_DISCOVERY_SCRIPT,
          true,
        );
        const devices = this.normalizeAudioDevices(rawDevices);
        if (devices.length > 0) {
          return devices;
        }
      } catch (error) {
        logger.main.debug("Failed to query audio devices from renderer", {
          error,
        });
      }
    }

    return [{ label: "System Default", isDefault: true }];
  }

  private getWebContentsCandidates(): WebContents[] {
    if (!this.windowManager) {
      return [];
    }

    const windows = [
      this.windowManager.getMainWindow(),
      this.windowManager.getWidgetWindow(),
      this.windowManager.getOnboardingWindow(),
    ].filter(
      (window): window is BrowserWindow =>
        !!window &&
        !window.isDestroyed() &&
        !!window.webContents &&
        !window.webContents.isDestroyed(),
    );

    return windows.map((window) => window.webContents);
  }

  private normalizeAudioDevices(rawDevices: unknown): TrayAudioInputDevice[] {
    if (!Array.isArray(rawDevices)) {
      return [];
    }

    const seenLabels = new Set<string>();
    const devices: TrayAudioInputDevice[] = [];

    for (const rawDevice of rawDevices) {
      if (!rawDevice || typeof rawDevice !== "object") {
        continue;
      }

      const labelValue = (rawDevice as { label?: unknown }).label;
      const isDefaultValue = (rawDevice as { isDefault?: unknown }).isDefault;
      if (typeof labelValue !== "string") {
        continue;
      }

      const label = labelValue.trim();
      if (!label || seenLabels.has(label)) {
        continue;
      }

      seenLabels.add(label);
      devices.push({
        label,
        isDefault: isDefaultValue === true,
      });
    }

    return devices;
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
