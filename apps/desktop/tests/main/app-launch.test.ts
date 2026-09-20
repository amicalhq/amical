import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  handleActivate: vi.fn(),
  handleSecondInstance: vi.fn(),
  handleDeepLink: vi.fn(),
}));

vi.mock("../../src/main/core/app-manager", () => ({
  AppManager: class {
    initialize = mocks.initialize;
    handleActivate = mocks.handleActivate;
    handleSecondInstance = mocks.handleSecondInstance;
    handleDeepLink = mocks.handleDeepLink;
    cleanup = vi.fn();
  },
}));
vi.mock("../../src/main/managers/service-manager", () => ({
  ServiceManager: class {},
}));

const originalArgv = process.argv;
const originalPlatform = process.platform;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.argv = ["Amical"];
  Object.defineProperty(process, "platform", { value: "darwin" });
});

afterEach(() => {
  process.argv = originalArgv;
  Object.defineProperty(process, "platform", { value: originalPlatform });
});

async function launch(wasOpenedAtLogin = false) {
  const { app } = await import("electron");
  Object.assign(app, {
    requestSingleInstanceLock: vi.fn(() => true),
    setAsDefaultProtocolClient: vi.fn(),
    setAppUserModelId: vi.fn(),
  });
  vi.mocked(app.getLoginItemSettings).mockReturnValue({
    wasOpenedAtLogin,
    openAtLogin: true,
  } as ReturnType<typeof app.getLoginItemSettings>);
  let complete!: () => void;
  mocks.initialize.mockReturnValue(
    new Promise<void>((resolve) => {
      complete = resolve;
    }),
  );
  await import("../../src/main/app");
  await vi.waitFor(() => expect(mocks.initialize).toHaveBeenCalledOnce());

  // Electron's overloads expose only the last event signature to mock.calls.
  const listeners = vi.mocked(app.on).mock.calls as unknown as [
    string,
    (...args: unknown[]) => void,
  ][];
  const activate = listeners.find(([event]) => event === "activate")![1];
  const secondInstance = listeners.find(
    ([event]) => event === "second-instance",
  )![1];
  return {
    activate: () => activate({}, false),
    secondInstance: (args: string[]) => secondInstance({}, args, ""),
    finish: async () => {
      complete();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

describe("launch visibility", () => {
  it.each([false, true])(
    "passes explicit silent start (%s) to initialization",
    async (silentStart) => {
      if (silentStart) process.argv.push("--silent-start");
      const boot = await launch();
      expect(mocks.initialize).toHaveBeenCalledWith({ silentStart });
      await boot.finish();
    },
  );

  it("uses the native macOS login-launch signal", async () => {
    const boot = await launch(true);
    expect(mocks.initialize).toHaveBeenCalledWith({ silentStart: true });
    await boot.finish();
  });

  it("does not infer silent startup from Windows login settings", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const boot = await launch(true);
    expect(mocks.initialize).toHaveBeenCalledWith({ silentStart: false });
    await boot.finish();
  });

  it("ignores startup activation but opens on a later Dock click", async () => {
    process.argv.push("--silent-start");
    const boot = await launch();
    boot.activate();
    expect(mocks.handleActivate).not.toHaveBeenCalled();
    await boot.finish();
    boot.activate();
    expect(mocks.handleActivate).toHaveBeenCalledOnce();
  });

  it("ignores silent second launches but opens for a normal second launch", async () => {
    const boot = await launch();
    await boot.finish();
    boot.secondInstance(["Amical", "--silent-start"]);
    boot.secondInstance(["Amical", "--squirrel-updated"]);
    expect(mocks.handleSecondInstance).not.toHaveBeenCalled();
    boot.secondInstance(["Amical"]);
    expect(mocks.handleSecondInstance).toHaveBeenCalledOnce();
  });

  it("remembers a Dock click after initial activation while startup is still running", async () => {
    process.argv.push("--silent-start");
    const boot = await launch();
    boot.activate();
    boot.activate();
    expect(mocks.handleActivate).not.toHaveBeenCalled();
    await boot.finish();
    expect(mocks.handleSecondInstance).toHaveBeenCalledOnce();
  });

  it("remembers a normal second launch received during silent startup", async () => {
    process.argv.push("--silent-start");
    const boot = await launch();
    boot.secondInstance(["Amical"]);
    expect(mocks.handleSecondInstance).not.toHaveBeenCalled();
    await boot.finish();
    expect(mocks.handleSecondInstance).toHaveBeenCalledOnce();
  });

  it("does not queue a silent second launch but still handles explicit deep links", async () => {
    const boot = await launch();
    const url = "amical://oauth/callback?code=test";
    boot.secondInstance(["Amical", "--silent-start", url]);
    await boot.finish();
    expect(mocks.handleSecondInstance).not.toHaveBeenCalled();
    expect(mocks.handleDeepLink).toHaveBeenCalledWith(url);
  });

  it.each([false, true])(
    "opens a protocol launch only once (initialized: %s)",
    async (initialized) => {
      process.argv.push("--silent-start");
      const boot = await launch();
      if (initialized) await boot.finish();
      // A pending normal open must also yield to a later deep link.
      if (!initialized) boot.secondInstance(["Amical"]);
      const url = "amical://oauth/callback?code=test";
      boot.secondInstance(["Amical", url]);
      if (!initialized) await boot.finish();
      expect(mocks.handleSecondInstance).not.toHaveBeenCalled();
      expect(mocks.handleDeepLink).toHaveBeenCalledExactlyOnceWith(url);
    },
  );
});
