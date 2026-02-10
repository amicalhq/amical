# Testing Guide

This directory contains the test setup for the Amical Desktop application's main process.

## Overview

We use **Vitest** to test the Electron main process, specifically:

- **tRPC router procedures** - Direct testing by calling router methods
- **Service business logic** - Testing services with different database states
- **App initialization** - Testing how the app initializes with various database conditions

## Architecture

### Test Database

- Uses real SQLite databases (not mocked)
- Each test gets an isolated database in a temporary directory
- Migrations are applied automatically
- Fixtures for seeding test data

### Mocking Strategy

- **Electron APIs** - Fully mocked (app, ipcMain, BrowserWindow, Menu, etc.)
- **Native Modules** - Mocked (onnxruntime, whisper, keytar, etc.)
- **Database** - Real SQLite with test fixtures
- **tRPC** - Called directly, bypassing IPC layer

## Running Tests

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# UI mode
pnpm test:ui

# With coverage
pnpm test:coverage
```

## Writing Tests

### Testing tRPC Procedures

```typescript
import { createTestDatabase } from "../helpers/test-db";
import { initializeTestServices } from "../helpers/test-app";
import { seedDatabase } from "../helpers/fixtures";

describe("My Service", () => {
  let testDb;
  let trpcCaller;
  let cleanup;

  beforeEach(async () => {
    testDb = await createTestDatabase({ name: "my-test" });
    await seedDatabase(testDb, "withTranscriptions"); // or 'empty', 'full', etc.

    const result = await initializeTestServices(testDb);
    trpcCaller = result.trpcCaller;
    cleanup = result.cleanup;
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
    if (testDb) await testDb.close();
  });

  it("should do something", async () => {
    const result = await trpcCaller.myRouter.myProcedure({ input });
    expect(result).toBeDefined();
  });
});
```

### Available Fixtures

- `empty` - Empty database with default settings
- `withTranscriptions` - Database with sample transcriptions
- `withVocabulary` - Database with vocabulary items
- `withModels` - Database with downloaded models
- `withAuth` - Database with authenticated user
- `full` - Database with all types of data

### Custom Fixtures

```typescript
await fixtures.withCustomSettings(testDb, {
  ui: { theme: "dark" },
  transcription: { language: "es" },
});
```

## Known Limitations

1. **Full AppManager initialization** - Currently has issues with ServiceManager initialization. Use `initializeTestServices` instead for testing service business logic.

2. **Some modules require additional mocking** - If you encounter errors about missing modules, add mocks to `tests/setup.ts`.

3. **Database mocking** - The dynamic database mocking via `vi.doMock` doesn't work well with the existing module resolution. Tests work best when testing services directly rather than full app initialization.

## Troubleshooting

### "ServiceManager not initialized"

This means you're trying to use AppManager which requires more complex initialization. Use `initializeTestServices` to test services directly.

### "No procedure found on path"

Check that the tRPC procedure name matches the actual router definition. Refer to `src/trpc/routers/` for available procedures.

### "ENOENT: no such file or directory"

The test database or migrations folder might not be found. Ensure migrations exist at `src/db/migrations/`.

## Future Improvements

- Fix AppManager initialization for full integration tests
- Add more comprehensive fixtures
- Add test coverage reporting
- Add database state assertions helpers
- Create mock factories for complex objects
