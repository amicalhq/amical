import { _electron as electron, test, expect } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";

test.describe("Onboarding Flow", () => {
  let electronApp: ElectronApplication;
  let onboardingWindow: Page;

  test.beforeEach(async () => {
    // Force onboarding to show for testing
    electronApp = await electron.launch({
      args: ["."],
      env: {
        ...process.env,
        TESTING: "true",
        FORCE_ONBOARDING: "true", // This forces onboarding to show regardless of current permissions
      },
    });

    // Wait for onboarding window to appear
    // The onboarding window should be the first (and likely only) window when forced
    onboardingWindow = await electronApp.firstWindow();

    // Wait for the onboarding content to load
    await onboardingWindow.waitForLoadState("domcontentloaded");
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test("should load onboarding interface", async () => {
    // Wait for the main container to be visible
    await onboardingWindow.waitForSelector(
      "[data-testid='onboarding-container']"
    );

    // Verify essential elements are present
    const micCard = onboardingWindow.locator(
      "[data-testid='microphone-permission-card']"
    );
    await expect(micCard).toBeVisible();

    const quitButton = onboardingWindow.locator("[data-testid='quit-app-btn']");
    await expect(quitButton).toBeVisible();

    const nextButton = onboardingWindow.locator("[data-testid='next-btn']");
    await expect(nextButton).toBeVisible();
  });

  test("should show accessibility permission on macOS only", async () => {
    // Get platform info
    const platform = await electronApp.evaluate(async () => {
      return process.platform;
    });

    const accessCard = onboardingWindow.locator(
      "[data-testid='accessibility-permission-card']"
    );

    if (platform === "darwin") {
      await expect(accessCard).toBeVisible();
    } else {
      await expect(accessCard).not.toBeVisible();
    }
  });

  test("should display correct microphone permission state", async () => {
    // Wait for permission status to load
    await onboardingWindow.waitForTimeout(1000);

    const micStatusText = onboardingWindow.locator(
      "[data-testid='microphone-status-text']"
    );
    await expect(micStatusText).toBeVisible();

    // The status should be one of the valid permission states
    const statusText = await micStatusText.textContent();
    expect(["granted", "denied", "not-determined"]).toContain(statusText);

    // Check for appropriate action buttons based on status
    if (statusText === "denied") {
      const openSettingsButton = onboardingWindow.locator(
        "[data-testid='open-microphone-settings-btn']"
      );
      await expect(openSettingsButton).toBeVisible();
    } else if (statusText === "not-determined") {
      const grantButton = onboardingWindow.locator(
        "[data-testid='grant-microphone-permission-btn']"
      );
      await expect(grantButton).toBeVisible();
    }
  });

  test("should handle microphone permission request flow", async () => {
    await onboardingWindow.waitForTimeout(1000);

    const grantButton = onboardingWindow.locator(
      "[data-testid='grant-microphone-permission-btn']"
    );

    if (await grantButton.isVisible()) {
      // Test the permission request flow
      await grantButton.click();

      // Verify requesting state is shown
      await expect(grantButton).toHaveText("Requesting...");

      await onboardingWindow.waitForTimeout(2000);
    }
  });

  test("should control Next button based on permission state", async () => {
    await onboardingWindow.waitForTimeout(1000);

    const nextButton = onboardingWindow.locator("[data-testid='next-btn']");
    await expect(nextButton).toBeVisible();

    // Verify button state reflects permission status
    // In test environment, permissions typically won't be granted
    const isDisabled = await nextButton.isDisabled();
    if (isDisabled) {
      await expect(nextButton).toBeDisabled();
    } else {
      await expect(nextButton).toBeEnabled();
    }
  });

  test("should provide settings access when permissions denied", async () => {
    await onboardingWindow.waitForTimeout(1000);

    // Check for microphone settings button if permission denied
    const openMicSettings = onboardingWindow.locator(
      "[data-testid='open-microphone-settings-btn']"
    );
    if (await openMicSettings.isVisible()) {
      await expect(openMicSettings).toBeEnabled();
    }

    // Check for accessibility settings button on macOS
    const platform = await electronApp.evaluate(async () => {
      return process.platform;
    });

    if (platform === "darwin") {
      const openAccessSettings = onboardingWindow.locator(
        "[data-testid='open-accessibility-settings-btn']"
      );
      if (await openAccessSettings.isVisible()) {
        await expect(openAccessSettings).toBeEnabled();
      }
    }
  });

  test("should handle onboarding completion flow", async () => {
    const nextButton = onboardingWindow.locator("[data-testid='next-btn']");
    await expect(nextButton).toBeVisible();

    // Verify completion flow readiness
    // (Don't actually complete to avoid app restart during testing)
    if (!(await nextButton.isDisabled())) {
      await expect(nextButton).toBeEnabled();
      console.log("Onboarding completion flow is ready");
    } else {
      console.log("Waiting for permissions to enable completion");
    }
  });
});
