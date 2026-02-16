import { BrowserWindow, screen } from "electron";
import { logger } from "../../logger";
import type { SettingsService } from "../../../services/settings-service";
import type { createIPCHandler } from "electron-trpc-experimental/main";

type NotesWindowLayout = {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

interface NotesWindowControllerOptions {
  settingsService: SettingsService;
  trpcHandler: ReturnType<typeof createIPCHandler>;
  getWidgetWindow: () => BrowserWindow | null;
  getActiveWidgetDisplayWorkArea: () => Electron.Rectangle;
  setWidgetIgnoreMouseEvents: (ignore: boolean) => void;
  getWidgetEdgeInset: () => number;
  setWidgetDisplayId: (displayId: number) => void;
  preloadPath: string;
  notesWidgetFilePath: string;
  mainWindowViteDevServerUrl: string | undefined;
}

export class NotesWindowController {
  private static readonly NOTES_WINDOW_DEFAULT_WIDTH = 480 as const;
  private static readonly NOTES_WINDOW_DEFAULT_HEIGHT = 640 as const;
  private static readonly NOTES_WINDOW_MIN_WIDTH = 380 as const;
  private static readonly NOTES_WINDOW_MIN_HEIGHT = 420 as const;
  private static readonly NOTES_WINDOW_EDGE_MARGIN = 16 as const;
  private static readonly NOTES_WINDOW_DEFAULT_GAP_FROM_WIDGET = 12 as const;

  private notesWindow: BrowserWindow | null = null;
  private notesWindowBoundsAnimationInterval: NodeJS.Timeout | null = null;
  private notesWindowBoundsPersistTimeout: NodeJS.Timeout | null = null;
  private pendingWindowEventsByChannel = new Map<string, unknown[]>();
  private hasPendingDidFinishLoadFlush = false;

  constructor(private readonly options: NotesWindowControllerOptions) {}

  private clampNotesWindowBounds(
    bounds: Electron.Rectangle,
    workArea: Electron.Rectangle,
  ): Electron.Rectangle {
    const inset = this.options.getWidgetEdgeInset();
    const edgeMargin = NotesWindowController.NOTES_WINDOW_EDGE_MARGIN;
    const horizontalPadding = (edgeMargin + inset) * 2;
    const verticalPadding = (edgeMargin + inset) * 2;

    const availableWidth = Math.max(120, workArea.width - horizontalPadding);
    const availableHeight = Math.max(120, workArea.height - verticalPadding);
    const minWidth = Math.min(
      NotesWindowController.NOTES_WINDOW_MIN_WIDTH,
      availableWidth,
    );
    const minHeight = Math.min(
      NotesWindowController.NOTES_WINDOW_MIN_HEIGHT,
      availableHeight,
    );

    const width = Math.round(
      Math.min(availableWidth, Math.max(minWidth, bounds.width)),
    );
    const height = Math.round(
      Math.min(availableHeight, Math.max(minHeight, bounds.height)),
    );

    const minX = workArea.x + edgeMargin + inset;
    const minY = workArea.y + edgeMargin + inset;
    const maxX = workArea.x + workArea.width - edgeMargin - inset - width;
    const maxY = workArea.y + workArea.height - edgeMargin - inset - height;

    return {
      x: Math.round(Math.min(Math.max(bounds.x, minX), maxX)),
      y: Math.round(Math.min(Math.max(bounds.y, minY), maxY)),
      width,
      height,
    };
  }

  private getDefaultNotesWindowBounds(
    workArea: Electron.Rectangle,
  ): Electron.Rectangle {
    const desiredBounds: Electron.Rectangle = {
      width: NotesWindowController.NOTES_WINDOW_DEFAULT_WIDTH,
      height: NotesWindowController.NOTES_WINDOW_DEFAULT_HEIGHT,
      x:
        workArea.x +
        workArea.width -
        NotesWindowController.NOTES_WINDOW_DEFAULT_WIDTH -
        NotesWindowController.NOTES_WINDOW_EDGE_MARGIN -
        this.options.getWidgetEdgeInset(),
      y:
        workArea.y +
        Math.round(
          (workArea.height -
            NotesWindowController.NOTES_WINDOW_DEFAULT_HEIGHT) /
            2,
        ),
    };

    const widgetWindow = this.options.getWidgetWindow();
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      const widgetBounds = widgetWindow.getBounds();
      desiredBounds.x = Math.round(
        widgetBounds.x + (widgetBounds.width - desiredBounds.width) / 2,
      );
      desiredBounds.y =
        widgetBounds.y -
        desiredBounds.height -
        NotesWindowController.NOTES_WINDOW_DEFAULT_GAP_FROM_WIDGET;
    }

    return this.clampNotesWindowBounds(desiredBounds, workArea);
  }

  private async getNotesWindowLayout(): Promise<NotesWindowLayout | null> {
    const uiSettings = await this.options.settingsService.getUISettings();
    const layout = uiSettings?.notesWindow;
    if (!layout) return null;

    if (
      !Number.isFinite(layout.xRatio) ||
      !Number.isFinite(layout.yRatio) ||
      !Number.isFinite(layout.widthRatio) ||
      !Number.isFinite(layout.heightRatio) ||
      layout.widthRatio <= 0 ||
      layout.heightRatio <= 0
    ) {
      return null;
    }

    return layout;
  }

  private getNotesWindowBoundsFromLayout(
    layout: NotesWindowLayout,
    workArea: Electron.Rectangle,
  ): Electron.Rectangle {
    const restoredBounds: Electron.Rectangle = {
      x: Math.round(workArea.x + workArea.width * layout.xRatio),
      y: Math.round(workArea.y + workArea.height * layout.yRatio),
      width: Math.round(workArea.width * layout.widthRatio),
      height: Math.round(workArea.height * layout.heightRatio),
    };

    return this.clampNotesWindowBounds(restoredBounds, workArea);
  }

  private async getNotesWindowBounds(
    workArea: Electron.Rectangle,
  ): Promise<Electron.Rectangle> {
    const savedLayout = await this.getNotesWindowLayout();
    if (savedLayout) {
      return this.getNotesWindowBoundsFromLayout(savedLayout, workArea);
    }
    return this.getDefaultNotesWindowBounds(workArea);
  }

  private clearNotesWindowBoundsAnimation(): void {
    if (this.notesWindowBoundsAnimationInterval) {
      clearInterval(this.notesWindowBoundsAnimationInterval);
      this.notesWindowBoundsAnimationInterval = null;
    }
  }

  private clearNotesWindowBoundsPersistTimeout(): void {
    if (this.notesWindowBoundsPersistTimeout) {
      clearTimeout(this.notesWindowBoundsPersistTimeout);
      this.notesWindowBoundsPersistTimeout = null;
    }
  }

  private schedulePersistNotesWindowBounds(): void {
    this.clearNotesWindowBoundsPersistTimeout();
    this.notesWindowBoundsPersistTimeout = setTimeout(() => {
      void this.persistNotesWindowBounds();
    }, 250);
  }

  private async persistNotesWindowBounds(): Promise<void> {
    if (!this.notesWindow || this.notesWindow.isDestroyed()) {
      return;
    }

    const bounds = this.notesWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const workArea = display.workArea;
    const clampedBounds = this.clampNotesWindowBounds(bounds, workArea);

    const layout: NotesWindowLayout = {
      xRatio: (clampedBounds.x - workArea.x) / workArea.width,
      yRatio: (clampedBounds.y - workArea.y) / workArea.height,
      widthRatio: clampedBounds.width / workArea.width,
      heightRatio: clampedBounds.height / workArea.height,
    };

    try {
      const currentUISettings =
        await this.options.settingsService.getUISettings();
      const nextUISettings = {
        ...currentUISettings,
        notesWindow: layout,
      };
      await this.options.settingsService.updateSettings({ ui: nextUISettings });
    } catch (error) {
      logger.main.warn("Failed to persist notes window bounds", { error });
    }
  }

  private animateNotesWindowBounds(
    startBounds: Electron.Rectangle,
    targetBounds: Electron.Rectangle,
  ): void {
    if (!this.notesWindow || this.notesWindow.isDestroyed()) {
      return;
    }

    const hasBoundsChanged =
      startBounds.x !== targetBounds.x ||
      startBounds.y !== targetBounds.y ||
      startBounds.width !== targetBounds.width ||
      startBounds.height !== targetBounds.height;

    if (!hasBoundsChanged) {
      this.notesWindow.setBounds(targetBounds);
      return;
    }

    this.clearNotesWindowBoundsAnimation();

    const durationMs = 180;
    const startTime = Date.now();
    this.notesWindowBoundsAnimationInterval = setInterval(() => {
      if (!this.notesWindow || this.notesWindow.isDestroyed()) {
        this.clearNotesWindowBoundsAnimation();
        return;
      }

      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);

      const nextBounds: Electron.Rectangle = {
        x: Math.round(
          startBounds.x + (targetBounds.x - startBounds.x) * easedProgress,
        ),
        y: Math.round(
          startBounds.y + (targetBounds.y - startBounds.y) * easedProgress,
        ),
        width: Math.round(
          startBounds.width +
            (targetBounds.width - startBounds.width) * easedProgress,
        ),
        height: Math.round(
          startBounds.height +
            (targetBounds.height - startBounds.height) * easedProgress,
        ),
      };

      this.notesWindow.setBounds(nextBounds);

      if (progress >= 1) {
        this.clearNotesWindowBoundsAnimation();
        if (this.notesWindow && !this.notesWindow.isDestroyed()) {
          this.notesWindow.setBounds(targetBounds);
        }
      }
    }, 1000 / 60);
  }

  private sendEventToNotesWindow(channel: string, ...args: unknown[]): void {
    if (!this.notesWindow || this.notesWindow.isDestroyed()) {
      return;
    }

    const sendRequest = () => {
      if (!this.notesWindow || this.notesWindow.isDestroyed()) {
        return;
      }
      this.notesWindow.webContents.send(channel, ...args);
    };

    if (this.notesWindow.webContents.isLoadingMainFrame()) {
      this.queuePendingEventToNotesWindow(channel, args);
      return;
    }

    sendRequest();
  }

  private queuePendingEventToNotesWindow(
    channel: string,
    args: unknown[],
  ): void {
    this.pendingWindowEventsByChannel.set(channel, args);

    if (this.hasPendingDidFinishLoadFlush) {
      return;
    }

    if (!this.notesWindow || this.notesWindow.isDestroyed()) {
      this.pendingWindowEventsByChannel.clear();
      return;
    }

    this.hasPendingDidFinishLoadFlush = true;
    this.notesWindow.webContents.once("did-finish-load", () => {
      this.hasPendingDidFinishLoadFlush = false;
      this.flushPendingWindowEvents();
    });
  }

  private flushPendingWindowEvents(): void {
    if (!this.notesWindow || this.notesWindow.isDestroyed()) {
      this.pendingWindowEventsByChannel.clear();
      return;
    }

    const pendingEvents = Array.from(
      this.pendingWindowEventsByChannel.entries(),
    );
    this.pendingWindowEventsByChannel.clear();

    pendingEvents.forEach(([channel, args]) => {
      this.notesWindow?.webContents.send(channel, ...args);
    });
  }

  private sendOpenRequestToNotesWindow(noteId?: number): void {
    this.sendEventToNotesWindow("notes-window:open-requested", noteId);
  }

  private handleNotesWindowBoundsChanged(): void {
    if (!this.notesWindow || this.notesWindow.isDestroyed()) {
      return;
    }

    const currentBounds = this.notesWindow.getBounds();
    const display = screen.getDisplayMatching(currentBounds);
    this.options.setWidgetDisplayId(display.id);

    const clampedBounds = this.clampNotesWindowBounds(
      currentBounds,
      display.workArea,
    );

    const wasClamped =
      clampedBounds.x !== currentBounds.x ||
      clampedBounds.y !== currentBounds.y ||
      clampedBounds.width !== currentBounds.width ||
      clampedBounds.height !== currentBounds.height;
    if (wasClamped) {
      this.notesWindow.setBounds(clampedBounds);
    }

    this.schedulePersistNotesWindowBounds();
  }

  private createNotesWindow(
    initialBounds: Electron.Rectangle,
    bootstrapNoteId?: number,
  ): BrowserWindow | null {
    if (this.notesWindow && !this.notesWindow.isDestroyed()) {
      return this.notesWindow;
    }

    this.notesWindow = new BrowserWindow({
      show: false,
      ...initialBounds,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: true,
      maximizable: false,
      skipTaskbar: true,
      focusable: true,
      hasShadow: false,
      minWidth: NotesWindowController.NOTES_WINDOW_MIN_WIDTH,
      minHeight: NotesWindowController.NOTES_WINDOW_MIN_HEIGHT,
      webPreferences: {
        preload: this.options.preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const bootstrapHash = new URLSearchParams({
      noteId: typeof bootstrapNoteId === "number" ? `${bootstrapNoteId}` : "",
    }).toString();

    if (this.options.mainWindowViteDevServerUrl) {
      const devUrl = new URL(this.options.mainWindowViteDevServerUrl);
      devUrl.pathname = "notes-widget.html";
      devUrl.hash = bootstrapHash;
      this.notesWindow.loadURL(devUrl.toString());
    } else {
      this.notesWindow.loadFile(this.options.notesWidgetFilePath, {
        hash: bootstrapHash,
      });
    }

    this.notesWindow.on("close", () => {
      this.clearNotesWindowBoundsPersistTimeout();
      this.pendingWindowEventsByChannel.clear();
      this.hasPendingDidFinishLoadFlush = false;
      void this.persistNotesWindowBounds();
      this.options.trpcHandler.detachWindow(this.notesWindow!);
    });

    this.notesWindow.on("closed", () => {
      this.clearNotesWindowBoundsAnimation();
      this.clearNotesWindowBoundsPersistTimeout();
      this.pendingWindowEventsByChannel.clear();
      this.hasPendingDidFinishLoadFlush = false;
      this.notesWindow = null;
    });

    this.notesWindow.on("moved", () => {
      this.handleNotesWindowBoundsChanged();
    });

    this.notesWindow.on("resized", () => {
      this.handleNotesWindowBoundsChanged();
    });

    if (process.platform === "darwin") {
      this.notesWindow.setAlwaysOnTop(true, "floating");
    } else if (process.platform === "win32") {
      this.notesWindow.setAlwaysOnTop(true, "screen-saver");
    }

    this.options.trpcHandler.attachWindow(this.notesWindow);
    return this.notesWindow;
  }

  private async showNotesWindow(noteId?: number): Promise<void> {
    this.options.setWidgetIgnoreMouseEvents(true);

    const targetBounds = await this.getNotesWindowBounds(
      this.options.getActiveWidgetDisplayWorkArea(),
    );
    const widgetWindow = this.options.getWidgetWindow();
    const sourceBounds =
      widgetWindow && !widgetWindow.isDestroyed()
        ? widgetWindow.getBounds()
        : targetBounds;

    const hasExistingWindow =
      this.notesWindow && !this.notesWindow.isDestroyed();
    const window = hasExistingWindow
      ? this.notesWindow
      : this.createNotesWindow(sourceBounds, noteId);

    if (!window || window.isDestroyed()) {
      return;
    }

    const wasVisible = window.isVisible();
    if (!wasVisible) {
      window.setBounds(sourceBounds);
      window.show();
      window.focus();
      this.animateNotesWindowBounds(sourceBounds, targetBounds);
    } else {
      window.show();
      window.focus();
    }
    if (hasExistingWindow) {
      this.sendOpenRequestToNotesWindow(noteId);
    }
  }

  isVisible(): boolean {
    return !!(
      this.notesWindow &&
      !this.notesWindow.isDestroyed() &&
      this.notesWindow.isVisible()
    );
  }

  close(): void {
    this.clearNotesWindowBoundsAnimation();
    if (this.notesWindow && !this.notesWindow.isDestroyed()) {
      this.notesWindow.close();
    }
  }

  open(noteId?: number): void {
    void this.showNotesWindow(noteId);
  }

  getWindow(): BrowserWindow | null {
    return this.notesWindow;
  }

  cleanup(): void {
    this.clearNotesWindowBoundsAnimation();
    this.clearNotesWindowBoundsPersistTimeout();
  }
}
