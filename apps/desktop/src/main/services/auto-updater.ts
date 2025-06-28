import { autoUpdater } from 'electron-updater';
import { app, dialog, BrowserWindow } from 'electron';
import { logger } from '../logger';

export class AutoUpdaterService {
  private checkingForUpdate = false;
  private updateAvailable = false;
  private mainWindow: BrowserWindow | null = null;

  constructor() {
    this.setupAutoUpdater();
  }

  setMainWindow(window: BrowserWindow | null) {
    this.mainWindow = window;
  }

  private setupAutoUpdater() {
    // Configure updater
    autoUpdater.autoDownload = false; // Don't auto-download, ask user first
    autoUpdater.autoInstallOnAppQuit = true;

    // Development settings
    if (process.env.NODE_ENV === 'development') {
      // In development, you can test with a local update server
      // autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml');
      autoUpdater.forceDevUpdateConfig = true;
    }

    // Event handlers
    autoUpdater.on('checking-for-update', () => {
      logger.updater.info('Checking for update...');
      this.checkingForUpdate = true;
    });

    autoUpdater.on('update-available', (info) => {
      logger.updater.info('Update available', {
        version: info.version,
        releaseDate: info.releaseDate,
      });
      this.checkingForUpdate = false;
      this.updateAvailable = true;
      this.showUpdateDialog(info);
    });

    autoUpdater.on('update-not-available', (info) => {
      logger.updater.info('Update not available', { version: info.version });
      this.checkingForUpdate = false;
      this.updateAvailable = false;
    });

    autoUpdater.on('error', (err) => {
      logger.updater.error('Error in auto-updater', { error: err.message });
      this.checkingForUpdate = false;
      
      // Show error dialog only if user manually checked for updates
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        dialog.showErrorBox('Update Error', `Error checking for updates: ${err.message}`);
      }
    });

    autoUpdater.on('download-progress', (progressObj) => {
      logger.updater.info('Download progress', {
        bytesPerSecond: progressObj.bytesPerSecond,
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
      });
      
      // Send progress to renderer if window exists
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('update-download-progress', progressObj);
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      logger.updater.info('Update downloaded', { version: info.version });
      this.showInstallDialog(info);
    });
  }

  private async showUpdateDialog(info: any) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    const result = await dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `A new version (${info.version}) is available.`,
      detail: 'Would you like to download it now? The update will be installed when you restart the app.',
      buttons: ['Download Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      logger.updater.info('User chose to download update');
      autoUpdater.downloadUpdate();
    } else {
      logger.updater.info('User chose to skip update');
    }
  }

  private async showInstallDialog(info: any) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    const result = await dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `Update ${info.version} has been downloaded.`,
      detail: 'The update will be installed when you restart the app. Would you like to restart now?',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      logger.updater.info('User chose to restart and install update');
      autoUpdater.quitAndInstall();
    } else {
      logger.updater.info('User chose to install update later');
    }
  }

  async checkForUpdates(userInitiated = false): Promise<void> {
    if (this.checkingForUpdate) {
      logger.updater.info('Already checking for updates');
      return;
    }

    try {
      logger.updater.info('Starting update check', { userInitiated });
      await autoUpdater.checkForUpdates();
    } catch (error) {
      logger.updater.error('Failed to check for updates', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      if (userInitiated && this.mainWindow && !this.mainWindow.isDestroyed()) {
        dialog.showErrorBox('Update Check Failed', 'Failed to check for updates. Please try again later.');
      }
    }
  }

  async checkForUpdatesAndNotify(): Promise<void> {
    try {
      await autoUpdater.checkForUpdatesAndNotify();
    } catch (error) {
      logger.updater.error('Failed to check for updates and notify', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  isCheckingForUpdate(): boolean {
    return this.checkingForUpdate;
  }

  isUpdateAvailable(): boolean {
    return this.updateAvailable;
  }

  async downloadUpdate(): Promise<void> {
    if (!this.updateAvailable) {
      throw new Error('No update available to download');
    }

    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      logger.updater.error('Failed to download update', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall();
  }
}