import { vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { TEST_USER_DATA_PATH } from "./helpers/electron-mocks";
import fs from "fs-extra";
import path from "path";

// Set test environment variable
process.env.NODE_ENV = "test";
process.env.VITEST = "true";

// Global test database instance - will be set by each test
let currentTestDb: any = null;

// Helper function to set the current test database
export function setTestDatabase(db: any) {
  currentTestDb = db;
}

// Helper function to get the current test database
export function getTestDatabase() {
  if (!currentTestDb) {
    throw new Error(
      "Test database not set. Call setTestDatabase() in beforeEach.",
    );
  }
  return currentTestDb;
}

// Mock the database module to return the current test database
vi.mock("@db", () => ({
  get db() {
    return getTestDatabase();
  },
  get dbPath() {
    return "/test/db/path";
  },
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
  closeDatabase: vi.fn().mockResolvedValue(undefined),
}));

// Mock electron module
vi.mock("electron", async () => {
  const { createElectronMocks } = await import("./helpers/electron-mocks");
  return createElectronMocks();
});

// Mock native modules
vi.mock("onnxruntime-node", () => ({
  InferenceSession: {
    create: vi.fn(function () {
      return Promise.resolve({
        run: vi.fn(function () {
          return Promise.resolve({
            output: {
              data: new Float32Array([0.5, 0.5, 0.5]),
              dims: [1, 3],
            },
          });
        }),
        release: vi.fn(),
      });
    }),
  },
  Tensor: vi.fn(),
  env: {
    wasm: {
      numThreads: 1,
    },
  },
}));

vi.mock("@amical/whisper-wrapper", () => ({
  WhisperModel: vi.fn().mockImplementation(function () {
    return {
      transcribe: vi.fn(function () {
        return Promise.resolve({
          text: "Test transcription",
          segments: [
            {
              start: 0,
              end: 1.5,
              text: "Test transcription",
            },
          ],
        });
      }),
      dispose: vi.fn(),
    };
  }),
  downloadModel: vi.fn(function () {
    return Promise.resolve();
  }),
  getModelPath: vi.fn(function () {
    return "/mock/model/path";
  }),
}));

vi.mock("keytar", () => ({
  getPassword: vi.fn(function (service: string, account: string) {
    return Promise.resolve(null);
  }),
  setPassword: vi.fn(function (
    service: string,
    account: string,
    password: string,
  ) {
    return Promise.resolve();
  }),
  deletePassword: vi.fn(function (service: string, account: string) {
    return Promise.resolve(true);
  }),
  findPassword: vi.fn(function (service: string) {
    return Promise.resolve(null);
  }),
  findCredentials: vi.fn(function (service: string) {
    return Promise.resolve([]);
  }),
}));

vi.mock("node-machine-id", () => ({
  machineIdSync: vi.fn(function () {
    return "test-machine-id-12345";
  }),
  machineId: vi.fn(function () {
    return Promise.resolve("test-machine-id-12345");
  }),
}));

vi.mock("systeminformation", () => ({
  system: vi.fn(function () {
    return Promise.resolve({
      manufacturer: "Test Manufacturer",
      model: "Test Model",
      version: "1.0",
      serial: "TEST123",
      uuid: "test-uuid",
      sku: "TEST-SKU",
    });
  }),
  cpu: vi.fn(function () {
    return Promise.resolve({
      manufacturer: "Test CPU",
      brand: "Test Brand",
      speed: 2.5,
      cores: 4,
    });
  }),
  mem: vi.fn(function () {
    return Promise.resolve({
      total: 16000000000,
      free: 8000000000,
      used: 8000000000,
    });
  }),
  osInfo: vi.fn(function () {
    return Promise.resolve({
      platform: "darwin",
      distro: "macOS",
      release: "14.0",
      arch: "arm64",
    });
  }),
}));

vi.mock("posthog-node", () => ({
  PostHog: vi.fn().mockImplementation(function () {
    return {
      capture: vi.fn(),
      identify: vi.fn(),
      alias: vi.fn(),
      shutdown: vi.fn(function () {
        return Promise.resolve();
      }),
    };
  }),
}));

vi.mock("update-electron-app", () => ({
  default: vi.fn(),
}));

// Mock electron-log
vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    silly: vi.fn(),
    transports: {
      file: { level: "info" },
      console: { level: "info" },
    },
    scope: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    })),
  },
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  verbose: vi.fn(),
  silly: vi.fn(),
}));

// Mock electron-squirrel-startup
vi.mock("electron-squirrel-startup", () => ({
  default: false,
}));

// Mock electron-trpc-experimental
vi.mock("electron-trpc-experimental/main", () => ({
  createIPCHandler: vi.fn(() => ({
    handle: vi.fn(),
  })),
}));

// Global test setup
beforeAll(async () => {
  // Create test user data directory
  await fs.ensureDir(TEST_USER_DATA_PATH);
  await fs.ensureDir(path.join(TEST_USER_DATA_PATH, "databases"));
  await fs.ensureDir(path.join(TEST_USER_DATA_PATH, "models"));
  await fs.ensureDir(path.join(TEST_USER_DATA_PATH, "logs"));
});

// Global test teardown
afterAll(async () => {
  // Clean up test user data directory
  try {
    await fs.remove(TEST_USER_DATA_PATH);
  } catch (error) {
    console.error("Failed to clean up test directory:", error);
  }
});

// Reset mocks between tests
beforeEach(() => {
  // Clear all mock calls and instances
  vi.clearAllMocks();
});

afterEach(() => {
  // Additional cleanup if needed
});

// Export for use in tests
export { TEST_USER_DATA_PATH };
