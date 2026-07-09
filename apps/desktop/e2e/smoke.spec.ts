import { test, expect } from "@playwright/test";
import {
  launchAmical,
  closeAmical,
  assertNotStaleDevBundle,
  type AmicalLaunch,
} from "./helpers/launch";

test.describe("smoke", () => {
  let launched: AmicalLaunch;

  test.beforeEach(async () => {
    launched = await launchAmical();
  });

  test.afterEach(async () => {
    await closeAmical(launched);
  });

  test("launches and opens onboarding on a fresh profile", async () => {
    const { app, target, userDataDir } = launched;

    // A fresh profile boots straight into the onboarding window.
    const page = await app.firstWindow({ timeout: 60_000 });
    assertNotStaleDevBundle(page.url());
    expect(page.url()).toContain("onboarding.html");

    // The renderer actually mounted (React rendered into #root).
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("#root > *").first()).toBeAttached();

    // Main-process sanity: the window is shown, the isolated profile is in
    // effect, and we're exercising the build the target claims to be.
    const state = await app.evaluate(({ app: electronApp, BrowserWindow }) => ({
      isPackaged: electronApp.isPackaged,
      userData: electronApp.getPath("userData"),
      visibleWindows: BrowserWindow.getAllWindows().filter((w) => w.isVisible())
        .length,
    }));
    expect(state.isPackaged).toBe(target === "packaged");
    expect(state.userData).toBe(userDataDir);
    expect(state.visibleWindows).toBeGreaterThanOrEqual(1);
  });
});
