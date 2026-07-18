import { vi } from "vitest";
import type { TestDatabase } from "./test-db";
import { AppManager } from "@main/core/app-manager";
import { ServiceManager } from "@main/managers/service-manager";
import { router } from "@trpc/router";
import { createContext, type Context } from "@trpc/context";

/**
 * Context with LAZY service resolution — unlike production's createContext,
 * which reads the bundle eagerly per request (requests only exist
 * post-build). The harness deliberately tolerates a failed graph build
 * (e.g. the real NativeBridge ctor throwing without the module mock), so
 * tests that only exercise DB-backed procedures still run; a procedure that
 * actually touches ctx.services gets the not-initialized throw instead.
 */
function createLazyTestContext(serviceManager: ServiceManager): Context {
  return {
    logger: serviceManager.getLogger(),
    get services() {
      return serviceManager.services();
    },
  };
}

/**
 * Test wrapper for AppManager
 */
export interface TestApp {
  appManager: AppManager;
  serviceManager: ServiceManager;
  trpcCaller: ReturnType<typeof router.createCaller>;
  cleanup: () => Promise<void>;
}

/**
 * Initialize a test instance of AppManager with mocked database
 */
export async function initializeTestApp(
  testDb: TestDatabase,
  options: {
    skipOnboarding?: boolean;
    skipWindows?: boolean;
  } = {},
): Promise<TestApp> {
  const { skipOnboarding = true, skipWindows = false } = options;

  // Mock the database module to use our test database
  vi.doMock("@db", () => ({
    db: testDb.db,
    dbPath: testDb.dbPath,
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
    closeDatabase: vi.fn().mockResolvedValue(undefined),
  }));

  // Mock onboarding check to skip it
  if (skipOnboarding) {
    process.env.FORCE_ONBOARDING = "false";
  }

  // Fresh boot handle per test app — no singleton to scrub.
  const serviceManager = new ServiceManager();
  const appManager = new AppManager(serviceManager);

  // Initialize the app
  // Note: This will try to create windows, which are mocked
  try {
    await appManager.initialize();
  } catch (error) {
    // Some initialization errors are expected in test environment
    console.warn("AppManager initialization warning:", error);
  }

  // Create tRPC caller for testing
  const trpcCaller = router.createCaller(createLazyTestContext(serviceManager));

  return {
    appManager,
    serviceManager,
    trpcCaller,
    cleanup: async () => {
      await appManager.cleanup();
    },
  };
}

/**
 * Create a tRPC caller without initializing the full AppManager
 * Useful for testing specific service methods in isolation
 */
export function createTestTRPCCaller(serviceManager: ServiceManager) {
  const ctx = createContext(serviceManager);
  return router.createCaller(ctx);
}

/**
 * Initialize just the ServiceManager without AppManager
 * Useful for testing services in isolation
 */
export async function initializeTestServices(testDb: TestDatabase): Promise<{
  serviceManager: ServiceManager;
  trpcCaller: ReturnType<typeof router.createCaller>;
  cleanup: () => Promise<void>;
}> {
  // Mock the database module
  vi.doMock("@db", () => ({
    db: testDb.db,
    dbPath: testDb.dbPath,
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
    closeDatabase: vi.fn().mockResolvedValue(undefined),
  }));

  // Create and initialize a fresh ServiceManager — no singleton to scrub.
  const serviceManager = new ServiceManager();

  try {
    await serviceManager.initialize();
  } catch (error) {
    console.warn("ServiceManager initialization warning:", error);
  }

  // Create tRPC caller
  const trpcCaller = router.createCaller(createLazyTestContext(serviceManager));

  return {
    serviceManager,
    trpcCaller,
    cleanup: async () => {
      await serviceManager.cleanup();
    },
  };
}
