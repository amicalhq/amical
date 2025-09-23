import { _electron as electron, test, expect } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

test.describe("Audio Transcription Feature", () => {
  let electronApp: ElectronApplication;
  let mainWindow: Page;
  let widgetWindow: Page;

  test.setTimeout(60000);

  test.beforeEach(async () => {
    // Path to the test audio file
    const audioFilePath = path.join(__dirname, "harvard.wav");
    console.log("Audio file path:", audioFilePath);

    // Verify audio file exists
    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`Test audio file not found: ${audioFilePath}`);
    }

    // Launch Electron app with fake audio
    electronApp = await electron.launch({
      args: [
        ".",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${audioFilePath}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: "test",
      },
    });

    // Get windows
    await electronApp.waitForEvent("window");
    const windows = electronApp.windows();

    // Find main and widget windows by size
    let largestWindow = windows[0];
    let smallestWindow = windows[0];

    for (const window of windows) {
      const viewport = window.viewportSize();
      if (viewport) {
        const currentLargest = largestWindow.viewportSize();
        const currentSmallest = smallestWindow.viewportSize();

        if (
          currentLargest &&
          viewport.width * viewport.height >
            currentLargest.width * currentLargest.height
        ) {
          largestWindow = window;
        }
        if (
          currentSmallest &&
          viewport.width * viewport.height <
            currentSmallest.width * currentSmallest.height
        ) {
          smallestWindow = window;
        }
      }
    }

    mainWindow = largestWindow;
    widgetWindow = smallestWindow;

    await mainWindow.waitForLoadState("domcontentloaded");
    await widgetWindow.waitForLoadState("domcontentloaded");
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test("should record audio and return to idle state", async () => {
    // Verify widget starts in idle state
    await expect(
      widgetWindow.locator('[data-recording-state="idle"]')
    ).toBeVisible();

    // Expand widget
    await widgetWindow.hover('[data-testid="widget-floating-button"]');
    await expect(widgetWindow.locator('[data-expanded="true"]')).toBeVisible();

    // Start recording
    await widgetWindow.click('[data-testid="widget-recording-btn"]');

    // Verify recording state
    await expect(
      widgetWindow.locator('[data-recording-state="recording"]')
    ).toBeVisible();

    // Wait a moment for audio to start flowing
    await widgetWindow.waitForTimeout(2000);

    // Verify waveform appears (indicates audio is being received)
    await expect(
      widgetWindow.locator('[data-testid="widget-waveform-visualization"]')
    ).toBeVisible({ timeout: 50000 });

    console.log("✅ Waveform visible - audio is being received");

    // Record for a few more seconds
    await widgetWindow.waitForTimeout(3000);

    // Stop recording
    await widgetWindow.click('[data-testid="widget-stop-recording-btn"]');

    // Verify stopping state
    await expect(
      widgetWindow.locator('[data-recording-state="stopping"]')
    ).toBeVisible();

    // Wait for return to idle (with generous timeout for processing)
    await expect(
      widgetWindow.locator('[data-recording-state="idle"]')
    ).toBeVisible({ timeout: 30000 });

    console.log(
      "✅ Recording cycle completed: idle → recording → stopping → idle"
    );
  });
});
