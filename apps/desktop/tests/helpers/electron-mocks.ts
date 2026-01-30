import { vi } from "vitest";
import { EventEmitter } from "events";
import path from "node:path";
import os from "node:os";

// Create a fake BrowserWindow class
class FakeBrowserWindow extends EventEmitter {
  id: number;
  webContents: any;
  private _isDestroyed = false;
  private _bounds = { x: 0, y: 0, width: 800, height: 600 };
  private _isVisible = false;
  private _isMinimized = false;
  private _isMaximized = false;
  private _isFocused = false;
  private _isFullScreen = false;

  constructor(options?: any) {
    super();
    this.id = Math.floor(Math.random() * 1000000);

    // Mock webContents
    this.webContents = {
      send: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
      session: {
        clearCache: vi.fn().mockResolvedValue(undefined),
        clearStorageData: vi.fn().mockResolvedValue(undefined),
      },
      openDevTools: vi.fn(),
      closeDevTools: vi.fn(),
      isDevToolsOpened: vi.fn().mockReturnValue(false),
      executeJavaScript: vi.fn().mockResolvedValue(undefined),
      setWindowOpenHandler: vi.fn(),
      setBackgroundThrottling: vi.fn(),
    };
  }

  loadURL(url: string) {
    return Promise.resolve();
  }

  loadFile(filePath: string) {
    return Promise.resolve();
  }

  show() {
    this._isVisible = true;
  }

  hide() {
    this._isVisible = false;
  }

  close() {
    this._isDestroyed = true;
    this.emit("closed");
  }

  destroy() {
    this._isDestroyed = true;
  }

  isDestroyed() {
    return this._isDestroyed;
  }

  isVisible() {
    return this._isVisible;
  }

  isMinimized() {
    return this._isMinimized;
  }

  isMaximized() {
    return this._isMaximized;
  }

  isFocused() {
    return this._isFocused;
  }

  isFullScreen() {
    return this._isFullScreen;
  }

  focus() {
    this._isFocused = true;
  }

  blur() {
    this._isFocused = false;
  }

  minimize() {
    this._isMinimized = true;
  }

  maximize() {
    this._isMaximized = true;
  }

  restore() {
    this._isMinimized = false;
    this._isMaximized = false;
  }

  setFullScreen(flag: boolean) {
    this._isFullScreen = flag;
  }

  getBounds() {
    return { ...this._bounds };
  }

  setBounds(bounds: Partial<typeof this._bounds>) {
    this._bounds = { ...this._bounds, ...bounds };
  }

  setSize(width: number, height: number) {
    this._bounds.width = width;
    this._bounds.height = height;
  }

  setPosition(x: number, y: number) {
    this._bounds.x = x;
    this._bounds.y = y;
  }

  center() {
    // Mock centering
  }

  setResizable(resizable: boolean) {}
  setMovable(movable: boolean) {}
  setMinimizable(minimizable: boolean) {}
  setMaximizable(maximizable: boolean) {}
  setFullScreenable(fullscreenable: boolean) {}
  setClosable(closable: boolean) {}
  setAlwaysOnTop(flag: boolean, level?: string) {}
  setVisibleOnAllWorkspaces(visible: boolean) {}
  setIgnoreMouseEvents(ignore: boolean) {}
  setContentProtection(enable: boolean) {}
  setFocusable(focusable: boolean) {}
  setParentWindow(parent: any) {}
  setTitle(title: string) {}
  setTitleBarOverlay(options: any) {}
  setOpacity(opacity: number) {}
  setShape(rects: any[]) {}
  setSkipTaskbar(skip: boolean) {}
  setMenu(menu: any) {}
  setAutoHideMenuBar(hide: boolean) {}
  setMenuBarVisibility(visible: boolean) {}
  setAspectRatio(aspectRatio: number) {}
  setBackgroundColor(color: string) {}
  setHasShadow(hasShadow: boolean) {}
  setRepresentedFilename(filename: string) {}
  setDocumentEdited(edited: boolean) {}
  setIcon(icon: any) {}
  setProgressBar(progress: number) {}
  setOverlayIcon(overlay: any, description: string) {}
  setThumbarButtons(buttons: any[]) {}
  setThumbnailClip(region: any) {}
  setThumbnailToolTip(toolTip: string) {}
  setAppDetails(options: any) {}
  setVibrancy(type: string) {}
  setWindowButtonVisibility(visible: boolean) {}
  setTrafficLightPosition(position: { x: number; y: number }) {}

  // Mock methods that return values
  getTitle() {
    return "Test Window";
  }
  getNativeWindowHandle() {
    return Buffer.from("test");
  }
  getMediaSourceId() {
    return "test-id";
  }
}

// Create test directories
const testUserDataPath = path.join(os.tmpdir(), "vox-test-" + Date.now());
const testAppPath = process.cwd();

// Mock app object
const mockApp = {
  getPath: vi.fn((name: string) => {
    const paths: Record<string, string> = {
      userData: testUserDataPath,
      appData: testUserDataPath,
      temp: os.tmpdir(),
      home: os.homedir(),
      documents: path.join(os.homedir(), "Documents"),
      downloads: path.join(os.homedir(), "Downloads"),
      desktop: path.join(os.homedir(), "Desktop"),
      music: path.join(os.homedir(), "Music"),
      pictures: path.join(os.homedir(), "Pictures"),
      videos: path.join(os.homedir(), "Videos"),
      logs: path.join(testUserDataPath, "logs"),
      crashDumps: path.join(testUserDataPath, "crashDumps"),
    };
    return paths[name] || testUserDataPath;
  }),
  getName: vi.fn(() => "Vox"),
  getVersion: vi.fn(() => "0.1.0-test"),
  isPackaged: false,
  isReady: vi.fn(() => true),
  whenReady: vi.fn(() => Promise.resolve()),
  quit: vi.fn(),
  exit: vi.fn(),
  relaunch: vi.fn(),
  focus: vi.fn(),
  hide: vi.fn(),
  show: vi.fn(),
  setName: vi.fn(),
  setPath: vi.fn(),
  getLocale: vi.fn(() => "en-US"),
  getLocaleCountryCode: vi.fn(() => "US"),
  getSystemLocale: vi.fn(() => "en-US"),
  on: vi.fn(),
  once: vi.fn(),
  removeListener: vi.fn(),
  removeAllListeners: vi.fn(),
  emit: vi.fn(),
  setLoginItemSettings: vi.fn(),
  getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
};

// Mock ipcMain
const mockIpcMain = {
  handle: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  removeHandler: vi.fn(),
  removeListener: vi.fn(),
  removeAllListeners: vi.fn(),
  emit: vi.fn(),
};

// Mock screen
const mockScreen = {
  getPrimaryDisplay: vi.fn(() => ({
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    size: { width: 1920, height: 1080 },
    workAreaSize: { width: 1920, height: 1040 },
    scaleFactor: 1,
    rotation: 0,
    internal: false,
  })),
  getAllDisplays: vi.fn(() => [
    {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      size: { width: 1920, height: 1080 },
      workAreaSize: { width: 1920, height: 1040 },
      scaleFactor: 1,
      rotation: 0,
      internal: false,
    },
  ]),
  getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 100 })),
  getDisplayNearestPoint: vi.fn(() => ({
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    size: { width: 1920, height: 1080 },
    workAreaSize: { width: 1920, height: 1040 },
    scaleFactor: 1,
    rotation: 0,
    internal: false,
  })),
  on: vi.fn(),
  removeListener: vi.fn(),
};

// Mock systemPreferences
const mockSystemPreferences = {
  getMediaAccessStatus: vi.fn(() => "granted"),
  askForMediaAccess: vi.fn(() => Promise.resolve(true)),
  isTrustedAccessibilityClient: vi.fn(() => true),
  getColor: vi.fn(() => "#000000"),
  on: vi.fn(),
  removeListener: vi.fn(),
};

// Mock nativeTheme
const mockNativeTheme = {
  shouldUseDarkColors: false,
  themeSource: "system" as const,
  on: vi.fn(),
  removeListener: vi.fn(),
};

// Mock Menu
const mockMenu = {
  buildFromTemplate: vi.fn(() => ({})),
  setApplicationMenu: vi.fn(),
  getApplicationMenu: vi.fn(() => null),
};

// Mock Tray
class FakeTray extends EventEmitter {
  constructor(image: any) {
    super();
  }
  setToolTip(toolTip: string) {}
  setTitle(title: string) {}
  setImage(image: any) {}
  setContextMenu(menu: any) {}
  destroy() {}
  isDestroyed() {
    return false;
  }
}

// Mock dialog
const mockDialog = {
  showOpenDialog: vi.fn(() =>
    Promise.resolve({ canceled: false, filePaths: [] }),
  ),
  showSaveDialog: vi.fn(() =>
    Promise.resolve({ canceled: false, filePath: "" }),
  ),
  showMessageBox: vi.fn(() => Promise.resolve({ response: 0 })),
  showErrorBox: vi.fn(),
  showCertificateTrustDialog: vi.fn(() => Promise.resolve()),
};

// Mock shell
const mockShell = {
  openExternal: vi.fn(() => Promise.resolve()),
  openPath: vi.fn(() => Promise.resolve("")),
  showItemInFolder: vi.fn(),
  openItem: vi.fn(() => Promise.resolve(true)),
  moveItemToTrash: vi.fn(() => Promise.resolve(true)),
  beep: vi.fn(),
  writeShortcutLink: vi.fn(() => true),
  readShortcutLink: vi.fn(() => ({})),
};

// Mock globalShortcut
const mockGlobalShortcut = {
  register: vi.fn(() => true),
  registerAll: vi.fn(),
  isRegistered: vi.fn(() => false),
  unregister: vi.fn(),
  unregisterAll: vi.fn(),
};

// Mock clipboard
const mockClipboard = {
  readText: vi.fn(() => ""),
  writeText: vi.fn(),
  readHTML: vi.fn(() => ""),
  writeHTML: vi.fn(),
  readImage: vi.fn(() => ({})),
  writeImage: vi.fn(),
  clear: vi.fn(),
  availableFormats: vi.fn(() => []),
};

// Mock nativeImage
const mockNativeImage = {
  createEmpty: vi.fn(() => ({})),
  createFromPath: vi.fn(() => ({})),
  createFromBuffer: vi.fn(() => ({})),
  createFromDataURL: vi.fn(() => ({})),
};

export function createElectronMocks() {
  return {
    app: mockApp,
    ipcMain: mockIpcMain,
    BrowserWindow: FakeBrowserWindow as any,
    screen: mockScreen,
    systemPreferences: mockSystemPreferences,
    nativeTheme: mockNativeTheme,
    Menu: mockMenu,
    Tray: FakeTray as any,
    dialog: mockDialog,
    shell: mockShell,
    globalShortcut: mockGlobalShortcut,
    clipboard: mockClipboard,
    nativeImage: mockNativeImage,
  };
}

// Export test user data path for cleanup
export const TEST_USER_DATA_PATH = testUserDataPath;
