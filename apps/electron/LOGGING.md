# Electron Logging System

This document describes the comprehensive logging system implemented using `electron-log` for the Amical Electron application.

## Overview

The logging system provides:
- **Structured logging** with scoped loggers for different modules
- **Development vs Production** configurations
- **File and console** output with appropriate formatting
- **Performance tracking** utilities
- **Error handling** with context and metadata
- **Renderer process logging** capabilities

## Configuration

### Log Levels
- **Development**: `debug` level for files, `debug` level for console
- **Production**: `info` level for files, `warn` level for console

### Log Files
- **Development**: `{userData}/logs/amical-dev.log`
- **Production**: `{logs}/amical.log`
- **Max file size**: 10MB with automatic rotation

### Console Output
- **Development**: Colored output with simple format `[level] message`
- **Production**: Timestamped format `[timestamp] [level] message`

## Usage

### Main Process

```typescript
import { logger, logError, logPerformance } from './logger';

// Use scoped loggers
logger.main.info('Application started');
logger.audio.debug('Audio chunk received', { size: 1024 });
logger.ai.error('Transcription failed', { error: 'API timeout' });

// Error logging with context
try {
  // some operation
} catch (error) {
  logError(error instanceof Error ? error : new Error(String(error)), 'operation context');
}

// Performance tracking
const startTime = Date.now();
// ... operation ...
logPerformance('audio transcription', startTime, { audioSizeKB: 256 });
```

### Renderer Process

```typescript
// Access via electronAPI
window.electronAPI.log.info('Component mounted');
window.electronAPI.log.error('Failed to load data', { userId: 123 });

// Create scoped logger
const componentLogger = window.electronAPI.log.scope('my-component');
componentLogger.debug('Debug information');
```

### Module-Specific Logging

Each module should create its own scoped logger:

```typescript
import { createScopedLogger } from '../main/logger';

class MyModule {
  private logger = createScopedLogger('my-module');
  
  doSomething() {
    this.logger.info('Operation started');
    // ...
    this.logger.debug('Operation completed', { result: 'success' });
  }
}
```

## Available Scoped Loggers

- `main` - Main process events
- `audio` - Audio recording and processing
- `ai` - AI/transcription services
- `swift` - Swift helper bridge
- `ui` - UI components and interactions
- `db` - Database operations

## Best Practices

### 1. Use Structured Logging
```typescript
// Good
logger.audio.info('Recording finished', { 
  filePath, 
  duration: 5000,
  sizeKB: 256 
});

// Avoid
logger.audio.info(`Recording finished: ${filePath}, duration: ${duration}ms`);
```

### 2. Appropriate Log Levels
- `debug` - Detailed information for debugging
- `info` - General information about application flow
- `warn` - Warning conditions that don't prevent operation
- `error` - Error conditions that may affect functionality

### 3. Error Handling
```typescript
// Always use logError for exceptions
try {
  await riskyOperation();
} catch (error) {
  logError(error instanceof Error ? error : new Error(String(error)), 'operation context', {
    userId: 123,
    additionalContext: 'value'
  });
}
```

### 4. Performance Tracking
```typescript
const startTime = Date.now();
const result = await expensiveOperation();
logPerformance('expensive operation', startTime, {
  resultSize: result.length,
  cacheHit: false
});
```

### 5. Sensitive Data
Never log sensitive information like API keys, passwords, or personal data:

```typescript
// Good
logger.main.info('API key configured', { hasApiKey: !!apiKey });

// Bad
logger.main.info('API key configured', { apiKey });
```

## Log File Locations

### Development
- macOS: `~/Library/Application Support/amical/logs/amical-dev.log`
- Windows: `%APPDATA%/amical/logs/amical-dev.log`
- Linux: `~/.config/amical/logs/amical-dev.log`

### Production
- macOS: `~/Library/Logs/amical/amical.log`
- Windows: `%USERPROFILE%/AppData/Roaming/amical/logs/amical.log`
- Linux: `~/.config/amical/logs/amical.log`

## Migration from Console Logging

Replace console calls with appropriate logger calls:

```typescript
// Before
console.log('Operation completed');
console.error('Error occurred:', error);
console.warn('Deprecated feature used');

// After
logger.main.info('Operation completed');
logError(error instanceof Error ? error : new Error(String(error)), 'operation context');
logger.main.warn('Deprecated feature used');
```

## Remote Logging (Future)

The system is prepared for remote logging in production:

```typescript
// In logger.ts, uncomment and configure:
if (!isDev) {
  log.transports.remote.level = 'error';
  log.transports.remote.url = 'your-logging-service-url';
}
```

## Debugging

### View Logs in Development
Logs are automatically displayed in the console with color coding.

### View Log Files
Use the following to open log files:

```bash
# macOS
open ~/Library/Application\ Support/amical/logs/

# Windows
explorer %APPDATA%\amical\logs\

# Linux
xdg-open ~/.config/amical/logs/
```

### Log Level Override
Set environment variable to override log levels:

```bash
# Show all debug logs in production
ELECTRON_LOG_LEVEL=debug npm start
```

## Performance Considerations

- Log file rotation prevents unlimited growth
- Debug logs are filtered out in production console
- Structured logging with objects is more efficient than string concatenation
- Async operations don't block the main thread

## Troubleshooting

### Common Issues

1. **Logs not appearing**: Check log level configuration
2. **File permission errors**: Ensure app has write access to log directory
3. **Large log files**: Automatic rotation should prevent this, but check configuration

### Debug Mode
Enable verbose logging:

```typescript
import { log } from './logger';
log.transports.console.level = 'debug';
log.transports.file.level = 'debug';
``` 