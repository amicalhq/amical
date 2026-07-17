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
- `withNotes` - Database with notes
- `withAuth` - Database with authenticated user
- `full` - Database with all types of data

### Custom Fixtures

```typescript
await fixtures.withCustomSettings(testDb, {
  ui: { theme: "dark" },
  transcription: { language: "es" },
});
```

## The service graph (Effect layers)

Since AMIC-42, ServiceManager's services are constructed by an Effect Layer
graph (`src/main/runtime/`): `tags.ts` (one `Context.Tag` per service),
`layers.ts` (one layer per service wrapping the existing class), and
`app-runtime.ts` (builds the graph into an app-owned scope whose finalizers
run the old cleanup methods, dependents-first).

Two test files pin the graph's semantic contracts — treat failures there as
real regressions, not flakes:

- **`tests/main/app-layers.test.ts`** (graph level): the full graph builds
  under the global mocks; each service is constructed exactly once; early
  refs register for the crash path; the teardown-order lock (shortcut <
  recording drain < transcription dispose < native-helper stop, and
  {featureFlag, remoteConfig} shutdown < posthog shutdown — PostHog flushes
  last); no rollback on a partial build failure (releases run exactly once,
  at cleanup); the non-fatal transcription init (null tag, boot continues).
- **`tests/main/app-runtime-failure.test.ts`** (facade level): a failed boot
  rethrows the ORIGINAL error (no FiberFailure wrapper — app.ts's dialog
  depends on it), the nullable accessors serve early refs for crash
  telemetry, and `cleanup()` is idempotent.

### Faking a service in a new test

Prefer providing a fake through the graph over `vi.mock`ing the module: build
a subgraph with `Layer.succeed(Tag, fake)` and `Layer.provide`. Example —
exercising a layer against a fake settings service:

```typescript
import { Effect, Layer } from "effect";
import { SettingsServiceTag } from "../../src/main/runtime/tags";
import { HistoryCleanupService } from "../../src/services/history-cleanup-service";

const fakeSettings = { getHistorySettings: async () => ({ retentionPeriod: "7d" }) };
const TestLayer = HistoryCleanupService.Live.pipe(
  Layer.provide(Layer.succeed(SettingsServiceTag, fakeSettings as never)),
);
// Layer.build TestLayer in a scope — see the buildCleanupService helper in
// tests/services/history-cleanup.test.ts for the full working pattern.
```

Converted services (those with a class-static `Live`) have private
constructors — tests build them through the layer as above, never `new`.

Existing `vi.mock`-based suites are fine as-is; the layer idiom is for new
tests that want a real slice of the graph.

### Env-config seeding

Services read config as `process.env.X || __BUNDLED_X`. The `__BUNDLED_*`
define globals only exist in the forge build, so under vitest an unset env
var would throw a ReferenceError. `tests/setup.ts` seeds dummy values for all
of them (`??=`, so a real `.env` wins) — a fresh checkout needs no `.env` to
run the suite. If a new `__BUNDLED_*` global is added to
`vite.main.config.mts`, seed its env counterpart in `tests/setup.ts` too.

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
