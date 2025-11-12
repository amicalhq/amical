import { vi } from "vitest";
import type { TestDatabase } from "./test-db";
import { AppManager } from "@main/core/app-manager";
import { ServiceManager } from "@main/managers/service-manager";
import { router } from "@trpc/router";
import { createContext } from "@trpc/context";

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

  // Create AppManager instance
  const appManager = new AppManager();

  // Initialize the app
  // Note: This will try to create windows, which are mocked
  try {
    await appManager.initialize();
  } catch (error) {
    // Some initialization errors are expected in test environment
    console.warn("AppManager initialization warning:", error);
  }

  // Get service manager
  const serviceManager = ServiceManager.getInstance()!;

  // Create tRPC caller for testing
  const ctx = createContext(serviceManager);
  const trpcCaller = router.createCaller(ctx);

  return {
    appManager,
    serviceManager,
    trpcCaller,
    cleanup: async () => {
      // Clean up services
      // Note: Add cleanup logic as needed
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

  // Create and initialize ServiceManager
  const serviceManager = ServiceManager.createInstance();

  try {
    await serviceManager.initialize();
  } catch (error) {
    console.warn("ServiceManager initialization warning:", error);
  }

  // Create tRPC caller
  const ctx = createContext(serviceManager);
  const trpcCaller = router.createCaller(ctx);

  return {
    serviceManager,
    trpcCaller,
    cleanup: async () => {
      // Cleanup logic
    },
  };
}
