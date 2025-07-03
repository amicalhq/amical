# E2E Testing Guide for Amical Desktop

## Current Issue

The packaged Electron app cannot be tested with Playwright due to:

1. **ASAR Packaging**: Even with `asar.unpack` configuration, Playwright cannot inject its automation scripts
2. **macOS Security**: Unsigned apps have additional restrictions
3. **Missing Debug Port**: Production builds don't expose the Chrome DevTools Protocol

## Working Solutions

### Option 1: Test Development Build (Recommended)

```bash
# Terminal 1: Start the app in dev mode
pnpm start

# Terminal 2: Run integration tests (without Playwright)
pnpm test:integration
```

### Option 2: Test Without ASAR

```bash
# Build without ASAR
pnpm package:test

# Run tests
pnpm test:e2e:only
```

### Option 3: Manual Testing

For production builds, use:
- Manual QA testing
- System-level automation tools (not browser-based)
- Screenshot comparison tools

## What Works

✅ Unit tests for individual services
✅ Integration tests for the transcription pipeline
✅ Testing with development builds
✅ Testing core functionality without UI

## What Doesn't Work

❌ Playwright with packaged ASAR apps
❌ Automated UI testing of production builds
❌ Remote debugging of signed apps

## Recommended Test Strategy

1. **Unit Tests**: Test services and utilities in isolation
2. **Integration Tests**: Test the transcription pipeline without UI
3. **Manual E2E Tests**: Test the packaged app manually
4. **Development E2E**: Limited UI tests with dev builds

## Next Steps

To enable proper E2E testing:

1. Create a special test build configuration that:
   - Disables ASAR completely
   - Enables remote debugging
   - Skips code signing

2. Use alternative testing tools:
   - Spectron (deprecated but might work)
   - WebdriverIO with Electron support
   - Native macOS automation tools

3. Focus on integration testing:
   - Test the core transcription pipeline
   - Test database operations
   - Test IPC communication
   - Skip UI automation for now