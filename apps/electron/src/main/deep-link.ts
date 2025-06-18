import { app } from 'electron';
import path from 'node:path';

/**
 * Registers single-instance enforcement and OS-level handlers for the custom
 * amical:// URL scheme.  All detected URLs are forwarded to the supplied
 * callback.  The module also buffers early links that arrive before
 * `app.whenReady()` so callers never miss the first deep-link.
 */
export function registerDeepLinkHandlers(handle: (url: string) => void): void {
  let pending: string | null = null;

  // Obtain the single-instance lock; quit if we lose.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  // Claim the custom protocol so the OS routes amical:// URLs to us.
  if (app.isPackaged) {
    // In a packaged build the bundle itself owns the scheme.
    app.setAsDefaultProtocolClient('amical');
  } else {
    // During development we must tell the OS how to start Electron **and**
    // which entry JS file to run; otherwise macOS launches the bare framework
    // application that shows the default Electron splash screen.
    const exe = process.execPath;               // e.g. node_modules/.bin/electron
    const entry = path.resolve(process.argv[1]); // your dev main entry
    // The leading '--' tells Electron that the next argument is the app path.
    app.setAsDefaultProtocolClient('amical', exe, ['--', entry]);
  }

  // Windows/Linux: second instance forwards argv containing the deep link.
  app.on('second-instance', (_e, argv) => {
    const link = argv.find((a) => a.startsWith('amical://'));
    if (!link) return;
    if (app.isReady()) handle(link);
    else pending = link;
  });

  // macOS: dedicated open-url event (can fire before ready).
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (app.isReady()) handle(url);
    else pending = url;
  });

  // Once Electron is ready flush any buffered links and check argv on Windows.
  app.whenReady().then(() => {
    if (pending) {
      handle(pending);
      pending = null;
    }

    if (process.platform === 'win32') {
      const firstLink = process.argv.find((a) => a.startsWith('amical://'));
      if (firstLink) handle(firstLink);
    }
  });
} 