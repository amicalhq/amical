import { vi } from "vitest";

// Mock onnxruntime-node
export const mockOnnxRuntime = {
  InferenceSession: {
    create: vi.fn(() =>
      Promise.resolve({
        run: vi.fn(() =>
          Promise.resolve({
            output: {
              data: new Float32Array([0.5, 0.5, 0.5]),
              dims: [1, 3],
            },
          }),
        ),
        release: vi.fn(),
      }),
    ),
  },
  Tensor: vi.fn(),
  env: {
    wasm: {
      numThreads: 1,
    },
  },
};

// Mock @amical/whisper-wrapper
export const mockWhisperWrapper = {
  WhisperModel: vi.fn().mockImplementation(() => ({
    transcribe: vi.fn(() =>
      Promise.resolve({
        text: "Test transcription",
        segments: [
          {
            start: 0,
            end: 1.5,
            text: "Test transcription",
          },
        ],
      }),
    ),
    dispose: vi.fn(),
  })),
  downloadModel: vi.fn(() => Promise.resolve()),
  getModelPath: vi.fn(() => "/mock/model/path"),
};

// Mock keytar (credential storage)
export const mockKeytar = {
  getPassword: vi.fn((service: string, account: string) =>
    Promise.resolve(null),
  ),
  setPassword: vi.fn((service: string, account: string, password: string) =>
    Promise.resolve(),
  ),
  deletePassword: vi.fn((service: string, account: string) =>
    Promise.resolve(true),
  ),
  findPassword: vi.fn((service: string) => Promise.resolve(null)),
  findCredentials: vi.fn((service: string) => Promise.resolve([])),
};

// Mock libsql native module
export const mockLibsql = {
  createClient: vi.fn(() => ({
    execute: vi.fn(() =>
      Promise.resolve({
        rows: [],
        columns: [],
        rowsAffected: 0,
      }),
    ),
    batch: vi.fn(() => Promise.resolve([])),
    close: vi.fn(() => Promise.resolve()),
    sync: vi.fn(() => Promise.resolve()),
  })),
};

// Mock native helper modules
export const mockSwiftHelper = {
  checkAccessibilityPermission: vi.fn(() => true),
  checkMicrophonePermission: vi.fn(() => true),
  requestMicrophonePermission: vi.fn(() => Promise.resolve(true)),
  getSystemAudioLevel: vi.fn(() => 0.5),
  setSystemAudioMuted: vi.fn(() => true),
  isSystemAudioMuted: vi.fn(() => false),
  writeToClipboard: vi.fn(() => true),
  readFromClipboard: vi.fn(() => ""),
  isRunning: vi.fn(() => true),
};

export const mockWindowsHelper = {
  checkMicrophonePermission: vi.fn(() => true),
  requestMicrophonePermission: vi.fn(() => Promise.resolve(true)),
  registerGlobalShortcut: vi.fn(() => true),
  unregisterGlobalShortcut: vi.fn(() => true),
  isKeyPressed: vi.fn(() => false),
  getSystemAudioLevel: vi.fn(() => 0.5),
  isRunning: vi.fn(() => true),
};

// Mock node-machine-id
export const mockMachineId = {
  machineIdSync: vi.fn(() => "test-machine-id-12345"),
  machineId: vi.fn(() => Promise.resolve("test-machine-id-12345")),
};

// Mock systeminformation
export const mockSystemInformation = {
  system: vi.fn(() =>
    Promise.resolve({
      manufacturer: "Test Manufacturer",
      model: "Test Model",
      version: "1.0",
      serial: "TEST123",
      uuid: "test-uuid",
      sku: "TEST-SKU",
    }),
  ),
  cpu: vi.fn(() =>
    Promise.resolve({
      manufacturer: "Test CPU",
      brand: "Test Brand",
      speed: 2.5,
      cores: 4,
    }),
  ),
  mem: vi.fn(() =>
    Promise.resolve({
      total: 16000000000,
      free: 8000000000,
      used: 8000000000,
    }),
  ),
  osInfo: vi.fn(() =>
    Promise.resolve({
      platform: "darwin",
      distro: "macOS",
      release: "14.0",
      arch: "arm64",
    }),
  ),
};

// Mock posthog-node
export const mockPostHog = {
  PostHog: vi.fn().mockImplementation(() => ({
    capture: vi.fn(),
    identify: vi.fn(),
    alias: vi.fn(),
    shutdown: vi.fn(() => Promise.resolve()),
  })),
};

// Mock update-electron-app
export const mockUpdateElectronApp = vi.fn();

export function createNativeMocks() {
  return {
    "onnxruntime-node": mockOnnxRuntime,
    "@amical/whisper-wrapper": mockWhisperWrapper,
    keytar: mockKeytar,
    libsql: mockLibsql,
    "@amical/swift-helper": mockSwiftHelper,
    "@amical/windows-helper": mockWindowsHelper,
    "node-machine-id": mockMachineId,
    systeminformation: mockSystemInformation,
    "posthog-node": mockPostHog,
    "update-electron-app": mockUpdateElectronApp,
  };
}
