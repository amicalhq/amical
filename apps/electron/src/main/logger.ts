import fs from 'node:fs';
import path from 'node:path';
import { app as electronApp } from 'electron';

export class AppLogger {
  private logFilePath: string;
  private logFileName: string;

  constructor(logFileName: string) {
    this.logFileName = logFileName;
    try {
      const logsPath = electronApp.getPath('logs');
      if (!fs.existsSync(logsPath)) {
        fs.mkdirSync(logsPath, { recursive: true });
      }
      this.logFilePath = path.join(logsPath, this.logFileName);
      this._log('INFO', `Log session started. Log file: ${this.logFilePath}`);
    } catch (e: any) {
      // Fallback if getPath or mkdir fails
      const tempPath = electronApp.getPath('temp');
       if (!fs.existsSync(tempPath)) {
        // Attempt to create temp path if it also doesn't exist (less likely)
        fs.mkdirSync(tempPath, { recursive: true });
      }
      this.logFilePath = path.join(tempPath, `${this.logFileName}.fallback.log`);
      console.error(`AppLogger (${this.logFileName}): Error setting up primary log path, using fallback: ${e.message}`);
      this._log('ERROR', `Error setting up primary log path: ${e.message}. Using fallback: ${this.logFilePath}`);
    }
  }

  private _log(level: 'INFO' | 'ERROR' | 'WARN' | 'DEBUG', ...args: any[]): void {
    const timestamp = new Date().toISOString();
    const serializedArgs = args.map(arg => {
      if (arg instanceof Error) {
        return `Error: ${arg.message}${arg.stack ? '\nStack: ' + arg.stack : ''}`;
      }
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return '[Unserializable Object]';
        }
      }
      return String(arg);
    });
    const formattedMessage = `[${timestamp}] [${level}] ${serializedArgs.join(' ')}\n`;

    try {
      const logDir = path.dirname(this.logFilePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      fs.appendFileSync(this.logFilePath, formattedMessage);
    } catch (e: any) {
      console.error(`AppLogger (${this.logFileName}): FATAL - Failed to write to log file:`, this.logFilePath, e.message);
      if (level === 'ERROR') console.error(...args);
      else if (level === 'WARN') console.warn(...args);
      else console.log(...args); // Default to console.log for INFO/DEBUG if file write fails
      return;
    }

    // Also log to the actual console based on level
    if (level === 'ERROR') {
      console.error(`[${this.logFileName}]`, ...args);
    } else if (level === 'WARN') {
      console.warn(`[${this.logFileName}]`, ...args);
    } else if (level === 'INFO') {
      console.info(`[${this.logFileName}]`, ...args);
    } else { // DEBUG
      console.debug(`[${this.logFileName}]`, ...args);
    }
  }

  public info(...args: any[]): void {
    this._log('INFO', ...args);
  }

  public warn(...args: any[]): void {
    this._log('WARN', ...args);
  }

  public error(...args: any[]): void {
    this._log('ERROR', ...args);
  }

  public debug(...args: any[]): void {
    this._log('DEBUG', ...args);
  }

  public getLogFilePath(): string {
    return this.logFilePath;
  }
} 