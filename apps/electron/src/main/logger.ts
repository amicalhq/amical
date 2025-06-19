import dotenv from 'dotenv';
dotenv.config();

import log from 'electron-log';
import { app } from 'electron';
import path from 'node:path';

// Configure electron-log immediately when module is imported
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Configure main logger - check for LOG_LEVEL override
const envLogLevel = process.env.LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug' | undefined;
const defaultFileLevel: 'debug' | 'info' = isDev ? 'debug' : 'info';
const defaultConsoleLevel: 'debug' | 'warn' = isDev ? 'debug' : 'warn';

log.transports.file.level = envLogLevel || defaultFileLevel;
log.transports.console.level = envLogLevel || defaultConsoleLevel;

// Configure file transport
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

// Set custom log file path
const logPath = isDev 
  ? path.join(app.getPath('userData'), 'logs', 'amical-dev.log')
  : path.join(app.getPath('logs'), 'amical.log');

log.transports.file.resolvePathFn = () => logPath;

// Configure console transport for better development experience
if (isDev) {
  log.transports.console.format = '[{level}] {text}';
  log.transports.console.useStyles = true;
} else {
  log.transports.console.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}';
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
// `DEBUG_SCOPES` can be a comma-separated list of scope names (main,ai,swift)
// or regex patterns wrapped in slashes (e.g. /ai.*/, /.*/)
const rawDebugScopes = (process.env.DEBUG_SCOPES ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// Utility: escape regex special chars for exact-match tokens
function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const debugScopePatterns: RegExp[] = rawDebugScopes.map((token) => {
  if (token.startsWith('/') && token.endsWith('/') && token.length > 1) {
    // Regex pattern (strip the leading & trailing slashes)
    const pattern = token.slice(1, -1);
    try {
      return new RegExp(pattern, 'i');
    } catch {
      // Fall through to exact match if regex is invalid
    }
  }
  // Treat as exact scope name
  return new RegExp(`^${escapeRegExp(token)}$`, 'i');
});

export function isScopeDebug(scope: string): boolean {
  return debugScopePatterns.some((re) => re.test(scope));
}
// -----------------------------------------------

// Helper to create a scoped logger that respects DEBUG_SCOPES
function createLoggerForScope(scope: string) {
  const scopedLogger = log.scope(scope);
  if (isScopeDebug(scope)) {
    (scopedLogger as any).transports.console.level = 'debug';
    (scopedLogger as any).transports.file.level = 'debug';
  }
  return scopedLogger;
}

// Create scoped loggers for different modules
export const logger = {
  main: createLoggerForScope('main'),
  ipc: createLoggerForScope('ipc'),
  renderer: createLoggerForScope('renderer'),
  network: createLoggerForScope('network'),
  audio: createLoggerForScope('audio'),
  ai: createLoggerForScope('ai'),
  swift: createLoggerForScope('swift'),
  ui: createLoggerForScope('ui'),
  db: createLoggerForScope('db'),
};

// Log startup information
logger.main.info('Logger initialized', {
  isDev,
  fileLogLevel: log.transports.file.level,
  consoleLogLevel: log.transports.console.level,
  envLogLevel: envLogLevel || 'not set',
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
export function logError(error: Error, context?: string, metadata?: Record<string, any>) {
  const errorInfo = {
    message: error.message,
    stack: error.stack,
    name: error.name,
    context,
    ...metadata,
  };
  
  logger?.main.error('Error occurred:', errorInfo);
}

export function logPerformance(operation: string, startTime: number, metadata?: Record<string, any>) {
  const duration = Date.now() - startTime;
  logger?.main.info(`Performance: ${operation}`, {
    duration: `${duration}ms`,
    ...metadata,
  });
}

// Development helpers
export function logDebugInfo(component: string, data: any) {
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    logger?.main.debug(`[${component}]`, data);
  }
}