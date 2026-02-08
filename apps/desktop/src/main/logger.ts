import dotenv from "dotenv";
dotenv.config();

import log from "electron-log";
import { app } from "electron";
import path from "node:path";
import colors from "ansi-colors";

// Configure electron-log immediately when module is imported
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

// Configure main logger - check for LOG_LEVEL override
const envLogLevel = process.env.LOG_LEVEL as
  | "error"
  | "warn"
  | "info"
  | "debug"
  | undefined;

// If LOG_DEBUG_SCOPES is set, we need to allow debug messages through the transport
// so they can be filtered by scope later
const hasDebugScopes = !!process.env.LOG_DEBUG_SCOPES?.trim();

const defaultFileLevel: "debug" | "info" =
  isDev || hasDebugScopes ? "debug" : "info";
const defaultConsoleLevel: "debug" | "warn" =
  isDev || hasDebugScopes ? "debug" : "warn";

log.transports.file.level = envLogLevel || defaultFileLevel;
log.transports.console.level = envLogLevel || defaultConsoleLevel;

// Configure file transport
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
log.transports.file.format =
  "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{scope}] {text}";

// Set custom log file path
const logPath = isDev
  ? path.join(app.getPath("userData"), "logs", "grizzo-dev.log")
  : path.join(app.getPath("logs"), "grizzo.log");

log.transports.file.resolvePathFn = () => logPath;

// Configure console transport for better development experience
if (isDev) {
  // Color functions for different scopes using ansi-colors
  const scopeColorFunctions: Record<string, (text: string) => string> = {
    main: colors.blue.bold,
    audio: colors.green.bold,
    transcription: colors.magenta.bold,
    swift: colors.yellow.bold,
    pipeline: colors.red.bold,
    widget: colors.cyan.bold,
    mainWindow: colors.greenBright.bold,
    renderer: colors.gray.bold,
    ui: colors.magentaBright.bold,
    db: colors.cyanBright.bold,
    network: colors.yellowBright.bold,
    updater: colors.blueBright.bold,
    ipc: colors.green.bold,
    default: colors.gray.bold,
  };

  // Color functions for different log levels
  const levelColorFunctions: Record<string, (text: string) => string> = {
    error: colors.red.bold,
    warn: colors.yellow.bold,
    info: colors.blue,
    verbose: colors.cyan,
    debug: colors.gray,
    silly: colors.magenta,
  };

  // Override console transport with custom colored output
  log.transports.console.format = "{text}"; // Minimal formatting - just pass through the text
  log.transports.console.writeFn = (info) => {
    const { message } = info;
    const scope = message.scope || "default";
    const level = message.level;

    // Get color functions
    const scopeColorFn =
      scopeColorFunctions[scope] || scopeColorFunctions.default;
    const levelColorFn = levelColorFunctions[level] || ((text: string) => text);

    const timestamp = `${message.date.getFullYear()}-${String(message.date.getMonth() + 1).padStart(2, "0")}-${String(message.date.getDate()).padStart(2, "0")} ${String(message.date.getHours()).padStart(2, "0")}:${String(message.date.getMinutes()).padStart(2, "0")}:${String(message.date.getSeconds()).padStart(2, "0")}.${String(message.date.getMilliseconds()).padStart(3, "0")}`;

    // Let console.log handle message serialization naturally
    const prefix = `${colors.dim(`[${timestamp}]`)} ${levelColorFn(`[${level}]`)} ${scopeColorFn(`[${scope}]`)}`;

    console.log(prefix, ...message.data);
  };
} else {
  log.transports.console.format =
    "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{scope}] {text}";
  log.transports.console.useStyles = false;
}

// Configure remote transport for production error reporting (optional)
if (!isDev) {
  // You can configure remote logging here if needed
  // log.transports.remote.level = 'error';
  // log.transports.remote.url = 'your-logging-service-url';
}

// -----------------------------------------------
// Debug-scope configuration
// -----------------------------------------------
// `LOG_DEBUG_SCOPES` can be a comma-separated list of scope names (main,ai,swift)
// or regex patterns wrapped in slashes (e.g. /ai.*/, /.*/)
const rawDebugScopes = (process.env.LOG_DEBUG_SCOPES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Utility: escape regex special chars for exact-match tokens
function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const debugScopePatterns: RegExp[] = rawDebugScopes.map((token) => {
  if (token.startsWith("/") && token.endsWith("/") && token.length > 1) {
    // Regex pattern (strip the leading & trailing slashes)
    const pattern = token.slice(1, -1);
    try {
      return new RegExp(pattern, "i");
    } catch {
      // Fall through to exact match if regex is invalid
    }
  }
  // Treat as exact scope name
  return new RegExp(`^${escapeRegExp(token)}$`, "i");
});

export function isScopeDebug(scope: string): boolean {
  return debugScopePatterns.some((re) => re.test(scope));
}

// Set up hooks to handle scope-based debug filtering
if (debugScopePatterns.length > 0) {
  log.hooks.push((message) => {
    // Only filter debug messages
    if (message.level !== "debug") return message;

    // Check if this scope should have debug enabled
    const scope = message.scope;
    if (scope && isScopeDebug(scope)) {
      return message; // Allow debug messages for this scope
    }

    // Block debug messages for scopes not in the debug list
    return false;
  });
}
// -----------------------------------------------

// Helper to create a scoped logger
log.scope.labelPadding = false;
function createLoggerForScope(scope: string) {
  return log.scope(scope);
}

// Create scoped loggers for different modules
export const logger = {
  main: createLoggerForScope("main"),
  ipc: createLoggerForScope("ipc"),
  renderer: createLoggerForScope("renderer"),
  network: createLoggerForScope("network"),
  audio: createLoggerForScope("audio"),
  pipeline: createLoggerForScope("pipeline"),
  swift: createLoggerForScope("swift"),
  ui: createLoggerForScope("ui"),
  db: createLoggerForScope("db"),
  updater: createLoggerForScope("updater"),
  transcription: createLoggerForScope("transcription"),
  widget: createLoggerForScope("widget"),
  mainWindow: createLoggerForScope("mainWindow"),
};

// Log startup information
logger.main.info("Logger initialized", {
  isDev,
  fileLogLevel: log.transports.file.level,
  consoleLogLevel: log.transports.console.level,
  envLogLevel: envLogLevel || "not set",
  logPath,
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
});

// Export the main logger instance for direct use
export { log };

// Utility function to create custom scoped loggers
export function createScopedLogger(scope: string) {
  return createLoggerForScope(scope);
}

// Error handling utilities
export function logError(
  error: Error,
  context?: string,
  metadata?: Record<string, any>,
) {
  const errorInfo = {
    message: error.message,
    stack: error.stack,
    name: error.name,
    context,
    ...metadata,
  };

  logger?.main.error("Error occurred:", errorInfo);
}

export function logPerformance(
  operation: string,
  startTime: number,
  metadata?: Record<string, any>,
) {
  const duration = Date.now() - startTime;
  logger?.main.info(`Performance: ${operation}`, {
    duration: `${duration}ms`,
    ...metadata,
  });
}

// Development helpers
export function logDebugInfo(component: string, data: any) {
  if (process.env.NODE_ENV === "development" || !app.isPackaged) {
    logger?.main.debug(`[${component}]`, data);
  }
}
