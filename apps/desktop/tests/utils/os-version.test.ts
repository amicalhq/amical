import { afterEach, describe, expect, it } from "vitest";
import {
  getMacOSMajorVersion,
  isLocalTranscriptionSupported,
} from "../../src/utils/os-version";

type MutableProc = { getSystemVersion?: () => string };
const mutableProcess = process as unknown as MutableProc;

const originalPlatform = process.platform;
const originalGetSystemVersion = mutableProcess.getSystemVersion;

function setSystemVersion(systemVersion?: string): void {
  if (systemVersion === undefined) {
    delete mutableProcess.getSystemVersion;
  } else {
    mutableProcess.getSystemVersion = () => systemVersion;
  }
}

function mockEnv(platform: NodeJS.Platform, systemVersion?: string): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
  setSystemVersion(systemVersion);
}

afterEach(() => {
  Object.defineProperty(process, "platform", {
    value: originalPlatform,
    configurable: true,
  });
  if (originalGetSystemVersion) {
    mutableProcess.getSystemVersion = originalGetSystemVersion;
  } else {
    delete mutableProcess.getSystemVersion;
  }
});

describe("getMacOSMajorVersion", () => {
  it("parses the macOS marketing major version", () => {
    mockEnv("darwin", "15.1.0");
    expect(getMacOSMajorVersion()).toBe(15);
  });

  it("parses Tahoe (26.x)", () => {
    mockEnv("darwin", "26.0.0");
    expect(getMacOSMajorVersion()).toBe(26);
  });

  it("returns null on non-macOS platforms", () => {
    mockEnv("win32");
    expect(getMacOSMajorVersion()).toBeNull();
  });

  it("returns null for an unparseable version string", () => {
    mockEnv("darwin", "");
    expect(getMacOSMajorVersion()).toBeNull();
  });

  it("returns null on darwin when getSystemVersion is unavailable", () => {
    mockEnv("darwin", undefined);
    expect(getMacOSMajorVersion()).toBeNull();
  });
});

describe("isLocalTranscriptionSupported", () => {
  it("is false on macOS 14", () => {
    mockEnv("darwin", "14.6.0");
    expect(isLocalTranscriptionSupported()).toBe(false);
  });

  it("is true on macOS 15", () => {
    mockEnv("darwin", "15.0.0");
    expect(isLocalTranscriptionSupported()).toBe(true);
  });

  it("is true on macOS 26 (Tahoe)", () => {
    mockEnv("darwin", "26.0.0");
    expect(isLocalTranscriptionSupported()).toBe(true);
  });

  it("is true on Windows", () => {
    mockEnv("win32");
    expect(isLocalTranscriptionSupported()).toBe(true);
  });

  it("is true on Linux", () => {
    mockEnv("linux");
    expect(isLocalTranscriptionSupported()).toBe(true);
  });

  it("is false (fail closed) when the version is unparseable on macOS", () => {
    mockEnv("darwin", "");
    expect(isLocalTranscriptionSupported()).toBe(false);
  });

  it("is false (fail closed) on macOS when getSystemVersion is unavailable", () => {
    mockEnv("darwin", undefined);
    expect(isLocalTranscriptionSupported()).toBe(false);
  });
});
