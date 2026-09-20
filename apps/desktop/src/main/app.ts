import dotenv from "dotenv";
dotenv.config();

import tls from "node:tls";
import { X509Certificate } from "node:crypto";
import { app, ipcMain } from "electron";
import { logger } from "./logger";
import { showFatalStartupDialog } from "./fatal-startup-dialog";

import { AppManager } from "./core/app-manager";
import { isWindows } from "../utils/platform";
import { ServiceManager } from "./managers/service-manager";
import { isSilentStart } from "./launch-options";

// Drop expired certs before they become trust anchors (see the merge below).
function notExpired(pem: string): boolean {
  try {
    return new Date(new X509Certificate(pem).validTo) > new Date();
  } catch {
    return false; // also drop anything unparseable
  }
}

// Trust the OS certificate store on top of Node's bundled CA list. Corporate
// TLS-inspection proxies (e.g. Zscaler) re-sign HTTPS with a root that lives in
// the OS store but not in Node's bundled list; without this, every request the
// app makes via undici (fetch) and grpc-js fails with a cert error.
//
// Expired certs are filtered out first: OS stores (especially Windows) retain
// expired legacy roots (DST Root CA X3, old ISRG/Let's Encrypt cross-signs). As
// trust anchors those make Electron's BoringSSL dead-end on the expired anchor
// when a server's chain routes through it (e.g. Let's Encrypt via ISRG Root X2),
// producing a spurious "certificate has expired". A valid anchor is never
// expired, so filtering preserves the corporate-proxy fix while removing that
// failure mode. The catch matters: setDefaultCACertificates validates each cert
// and throws on a bad one, and this runs before app launch — never block startup.
try {
  tls.setDefaultCACertificates(
    [
      ...tls.getCACertificates("default"),
      ...tls.getCACertificates("system"),
    ].filter(notExpired),
  );
} catch (error) {
  logger.main.warn("Failed to load system CA certificates", { error });
}

// Setup renderer logging relay (allows renderer to send logs to main process)
ipcMain.handle(
  "log-message",
  (_event, level: string, scope: string, ...args: unknown[]) => {
    const scopedLogger =
      logger[scope as keyof typeof logger] || logger.renderer;
    const logMethod = scopedLogger[level as keyof typeof scopedLogger];
    if (typeof logMethod === "function") {
      logMethod(...args);
    }
  },
);

// Set App User Model ID for Windows (required for Squirrel.Windows)
if (isWindows()) {
  app.setAppUserModelId("ai.amical.desktop");
}

// Register the amical:// protocol
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("amical", process.execPath, [
      process.argv[1],
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("amical");
}

// Enforce single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  logger.main.info("Another instance is already running, exiting");
  app.quit();
  app.exit(0);
}

const serviceManager = new ServiceManager();
const appManager = new AppManager(serviceManager);

// Track initialization state for deep link handling
let isInitialized = false;
let pendingDeepLink: string | null = null;
let pendingOpen = false;
let hasActivated = false;

// Handle protocol on macOS
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (isInitialized) {
    appManager.handleDeepLink(url);
  } else {
    pendingDeepLink = url;
  }
});

// Handle when another instance tries to start (Windows/Linux deep link handling)
app.on("second-instance", (_event, commandLine) => {
  // Squirrel spawns hook processes (--squirrel-updated/-obsolete) while
  // applying a background update; never treat those as a user launch. The
  // entry gate already keeps current hook processes off the lock — this
  // guards against older exes (the --squirrel-obsolete hook runs the
  // outgoing version's code).
  if (commandLine.some((arg) => arg.startsWith("--squirrel-"))) {
    return;
  }

  const url = commandLine.find((arg) => arg.startsWith("amical://"));
  // Deep-link handling opens its own window; do not open it twice.
  if (!url && !isSilentStart(commandLine)) {
    if (isInitialized) {
      appManager.handleSecondInstance();
    } else {
      pendingOpen = true;
    }
  }

  // Check if this is a protocol launch on Windows/Linux
  if (url) {
    if (isInitialized) {
      appManager.handleDeepLink(url);
    } else {
      pendingDeepLink = url;
    }
  }
});

app.whenReady().then(async () => {
  try {
    // Native macOS login items cannot pass arguments; use the OS launch signal.
    const silentStart =
      isSilentStart() ||
      (process.platform === "darwin" &&
        app.getLoginItemSettings().wasOpenedAtLogin);
    await appManager.initialize({ silentStart });
    isInitialized = true;

    // Process any deep link that was received before initialization completed
    if (pendingDeepLink) {
      appManager.handleDeepLink(pendingDeepLink);
      pendingDeepLink = null;
    } else if (pendingOpen) {
      appManager.handleSecondInstance();
    }
    pendingOpen = false;
  } catch (error) {
    logger.main.error("Application failed to initialize", { error });
    const telemetryService = serviceManager.getTelemetryService();
    try {
      await telemetryService?.captureExceptionImmediateAndShutdown(error, {
        source: "main_process",
        stage: "app_initialize",
      });
    } catch (telemetryError) {
      logger.main.error("Failed to flush startup failure telemetry", {
        error: telemetryError,
      });
    }
    await showFatalStartupDialog(error, "app_initialize");
    app.quit();
  }
});
app.on("will-quit", () => appManager.cleanup());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  // Initial launch activation belongs to initialize(). Remember subsequent
  // Dock clicks even if services are still starting.
  if (isInitialized) {
    void appManager.handleActivate();
  } else if (hasActivated) {
    pendingOpen = true;
  }
  hasActivated = true;
});
