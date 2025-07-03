# E2E Testing Setup

## The Issue

Playwright cannot properly connect to packaged Electron apps due to:
- macOS security restrictions on unsigned apps
- ASAR packaging preventing script injection
- Missing remote debugging capabilities in production builds

## Solutions

### 1. Development Mode Testing (Recommended)

Run tests against the development build:

```bash
# Terminal 1: Start dev server
pnpm start

# Terminal 2: Run tests
pnpm test:e2e:dev
```

### 2. Test Build Mode

Create a special test build without ASAR:

```bash
# Package without ASAR for testing
pnpm package:test
pnpm test:e2e:test-build
```

### 3. Production Testing

For testing the actual production app:
- Use system-level automation tools (not Playwright)
- Manual testing
- Screenshot-based visual regression testing

## Test Structure

```
e2e-dev/        # Tests for development mode
e2e-prod/       # Tests for production builds (limited)
e2e-integration/# API and service tests (no UI)
```