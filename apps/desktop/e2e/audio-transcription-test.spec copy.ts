import { _electron as electron, test, expect } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

test.describe("Audio Transcription Feature", () => {
  let electronApp: ElectronApplication;
  let mainWindow: Page;
  let widgetWindow: Page;

  // Expected transcription text from the audio file
  const expectedTranscriptionText = "Hello world this is a test recording";

  test.beforeEach(async () => {
    // Path to the test audio file
    const audioFilePath = path.join(__dirname, "output.wav");

    // Verify audio file exists
    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`Test audio file not found: ${audioFilePath}`);
    }

    // Launch Electron app with enhanced fake media stream flags
    electronApp = await electron.launch({
      args: [
        ".",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${audioFilePath}`,
        "--autoplay-policy=no-user-gesture-required",
        "--disable-web-security",
        "--allow-running-insecure-content",
        "--disable-features=VizDisplayCompositor",
        "--enable-logging=stderr",
        "--log-level=2",
        "--disable-dev-shm-usage", // Helps with audio processing in CI
      ],
      env: {
        ...process.env,
        // Skip onboarding for easier testing
        NODE_ENV: "test",
      },
    });

    // Wait for windows to be created
    await electronApp.waitForEvent("window");

    // Get all windows
    const windows = electronApp.windows();

    // Find main window and widget window
    // Main window typically has a larger viewport and more complex UI
    // Widget window is smaller and simpler
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

    // Wait for both windows to load
    await mainWindow.waitForLoadState("domcontentloaded");
    await widgetWindow.waitForLoadState("domcontentloaded");

    // Verify fake microphone is working
    await verifyFakeMicrophoneSetup();

    // Clear any existing transcriptions for clean test state
    await clearTranscriptionHistory();
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  // Helper function to verify fake microphone setup
  async function verifyFakeMicrophoneSetup() {
    console.log("Verifying fake microphone setup...");

    const microphoneSetup = await mainWindow.evaluate(async () => {
      try {
        // Check available devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(
          (device) => device.kind === "audioinput"
        );

        console.log(
          "Available audio input devices:",
          audioInputs.map((d) => ({
            deviceId: d.deviceId,
            label: d.label,
            kind: d.kind,
          }))
        );

        // Test getUserMedia with fake device
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

        const audioTracks = stream.getAudioTracks();
        console.log("Audio tracks obtained:", audioTracks.length);
        console.log("Audio track settings:", audioTracks[0]?.getSettings());

        // Clean up the test stream
        stream.getTracks().forEach((track) => track.stop());

        return {
          success: true,
          deviceCount: audioInputs.length,
          trackCount: audioTracks.length,
          trackLabel: audioTracks[0]?.label || "No label",
        };
      } catch (error) {
        console.error("Fake microphone setup failed:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    console.log("Microphone setup result:", microphoneSetup);

    if (!microphoneSetup.success) {
      throw new Error(`Fake microphone setup failed: ${microphoneSetup.error}`);
    }

    expect(microphoneSetup.trackCount).toBeGreaterThan(0);
  }

  // Helper function to start fake audio streaming
  async function startFakeAudioStream() {
    return await mainWindow.evaluate(async () => {
      try {
        // This will use the fake audio file specified in launch args
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

        // Store stream globally for cleanup
        (window as any).__testAudioStream = stream;

        console.log("Fake audio stream started successfully");
        return { success: true, streamId: stream.id };
      } catch (error) {
        console.error("Failed to start fake audio stream:", error);
        return { success: false, error: error.message };
      }
    });
  }

  // Helper function to stop fake audio stream
  async function stopFakeAudioStream() {
    return await mainWindow.evaluate(async () => {
      const stream = (window as any).__testAudioStream;
      if (stream) {
        stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        delete (window as any).__testAudioStream;
        console.log("Fake audio stream stopped");
        return true;
      }
      return false;
    });
  }

  // Helper function to clear transcription history
  async function clearTranscriptionHistory() {
    try {
      await electronApp.evaluate(async () => {
        const { db } = await import("../src/db");
        const { transcriptions } = await import("../src/db/schema");
        await db.delete(transcriptions);
      });
    } catch (error) {
      console.log("Failed to clear transcription history:", error);
    }
  }

  // Helper function to wait for transcription to appear in database
  async function waitForTranscriptionInDatabase(
    timeoutMs: number = 15000
  ): Promise<any> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const transcriptions = await electronApp.evaluate(async () => {
          const { getTranscriptions } = await import(
            "../src/db/transcriptions"
          );
          return await getTranscriptions({ limit: 1 });
        });

        if (transcriptions.length > 0) {
          return transcriptions[0];
        }
      } catch (error) {
        console.log("Error checking database:", error);
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Transcription not found in database within timeout");
  }

  // Helper function to configure PTT shortcut
  async function configurePTTShortcut(shortcut: string) {
    // Navigate to shortcuts settings
    await mainWindow.click('[data-testid="nav-shortcuts"]');
    await mainWindow.waitForTimeout(500);

    // Find and configure PTT shortcut
    const pttInput = mainWindow
      .locator('input[placeholder*="Push to talk"]')
      .first();
    if (await pttInput.isVisible()) {
      await pttInput.click();
      await pttInput.fill(shortcut);
      await mainWindow.waitForTimeout(1000); // Wait for setting to save
    }
  }

  test("should record audio via widget click and create transcription", async () => {
    // Verify widget is visible and in idle state
    await expect(
      widgetWindow.locator('[data-testid="widget-floating-button"]')
    ).toBeVisible();
    await expect(
      widgetWindow.locator('[data-recording-state="idle"]')
    ).toBeVisible();

    // Hover over widget to expand it
    await widgetWindow.hover('[data-testid="widget-floating-button"]');
    await widgetWindow.waitForTimeout(500);

    // Verify widget expanded
    await expect(widgetWindow.locator('[data-expanded="true"]')).toBeVisible();

    await widgetWindow.click('[data-testid="widget-recording-btn"]');

    // Start fake audio stream before recording
    const streamResult = await startFakeAudioStream();
    expect(streamResult.success).toBe(true);
    console.log("Fake audio stream started:", streamResult);

    // Click to start recording

    // Verify recording state changed
    await expect(
      widgetWindow.locator('[data-recording-state="recording"]')
    ).toBeVisible();
    await expect(
      widgetWindow.locator('[data-testid="widget-waveform-visualization"]')
    ).toBeVisible();

    // Wait for recording duration (fake audio should be streaming)
    console.log("Recording with fake audio for 4 seconds...");
    await widgetWindow.waitForTimeout(4000);

    // Stop recording by clicking stop button
    await widgetWindow.click('[data-testid="widget-stop-recording-btn"]');

    // Stop fake audio stream
    await stopFakeAudioStream();

    // Verify stopping state
    await expect(
      widgetWindow.locator('[data-recording-state="stopping"]')
    ).toBeVisible();
    await expect(
      widgetWindow.locator('[data-testid="widget-processing-indicator"]')
    ).toBeVisible();

    // Wait for recording to complete and transcription to be processed
    console.log("Waiting for transcription processing...");
    await expect(
      widgetWindow.locator('[data-recording-state="idle"]')
    ).toBeVisible({ timeout: 20000 });

    // Verify transcription was created in database
    const transcription = await waitForTranscriptionInDatabase();
    expect(transcription).toBeDefined();
    console.log("Transcription result:", transcription.text);
    expect(transcription.text.toLowerCase()).toContain(
      expectedTranscriptionText.toLowerCase()
    );

    // Navigate to history page to verify UI display
    await mainWindow.click('[data-testid="nav-history"]');
    await mainWindow.waitForTimeout(2000); // Wait for navigation and data loading

    // Verify transcription appears in history
    await expect(
      mainWindow.locator('[data-testid="history-page"]')
    ).toBeVisible();
    await expect(
      mainWindow.locator('[data-testid="history-today-section"]')
    ).toBeVisible();

    // Check for transcription content in history
    const transcriptionRow = mainWindow.locator(
      `[data-testid="history-transcription-${transcription.id}"]`
    );
    await expect(transcriptionRow).toBeVisible();

    // Verify audio controls are available
    await expect(
      mainWindow.locator(`[data-testid="history-play-btn-${transcription.id}"]`)
    ).toBeVisible();
    await expect(
      mainWindow.locator(`[data-testid="history-copy-btn-${transcription.id}"]`)
    ).toBeVisible();
  });

  test("should record audio via PTT shortcut", async () => {
    // Configure PTT shortcut (using a safe key combination for testing)
    await configurePTTShortcut("Ctrl+Shift+Space");

    // Return to main view
    await mainWindow.click('[data-testid="nav-history"]');
    await mainWindow.waitForTimeout(500);

    // Verify widget is in idle state
    await expect(
      widgetWindow.locator('[data-recording-state="idle"]')
    ).toBeVisible();

    // Start fake audio stream
    const streamResult = await startFakeAudioStream();
    expect(streamResult.success).toBe(true);

    // Trigger PTT shortcut - press and hold
    await mainWindow.keyboard.down("Control");
    await mainWindow.keyboard.down("Shift");
    await mainWindow.keyboard.down("Space");

    // Verify recording started
    await expect(
      widgetWindow.locator('[data-recording-state="recording"]')
    ).toBeVisible({ timeout: 3000 });
    await expect(
      widgetWindow.locator('[data-recording-mode="ptt"]')
    ).toBeVisible();

    // Hold for recording duration
    console.log("PTT recording for 3 seconds...");
    await mainWindow.waitForTimeout(3000);

    // Release PTT shortcut
    await mainWindow.keyboard.up("Space");
    await mainWindow.keyboard.up("Shift");
    await mainWindow.keyboard.up("Control");

    // Stop fake audio stream
    await stopFakeAudioStream();

    // Verify recording stopped and processing
    await expect(
      widgetWindow.locator('[data-recording-state="stopping"]')
    ).toBeVisible();
    await expect(
      widgetWindow.locator('[data-testid="widget-processing-indicator"]')
    ).toBeVisible();

    // Wait for completion
    await expect(
      widgetWindow.locator('[data-recording-state="idle"]')
    ).toBeVisible({ timeout: 20000 });

    // Verify transcription in database
    const transcription = await waitForTranscriptionInDatabase();
    expect(transcription).toBeDefined();
    expect(transcription.text.toLowerCase()).toContain(
      expectedTranscriptionText.toLowerCase()
    );

    // Verify in history UI
    await mainWindow.reload(); // Refresh to see new transcription
    await mainWindow.waitForTimeout(2000);

    const transcriptionRow = mainWindow.locator(
      `[data-testid="history-transcription-${transcription.id}"]`
    );
    await expect(transcriptionRow).toBeVisible();
  });

  test("should record audio via toggle recording shortcut", async () => {
    // Navigate to shortcuts settings and configure toggle shortcut
    await mainWindow.click('[data-testid="nav-shortcuts"]');
    await mainWindow.waitForTimeout(500);

    // Configure toggle recording shortcut
    const toggleInput = mainWindow
      .locator('input[placeholder*="Toggle recording"]')
      .first();
    if (await toggleInput.isVisible()) {
      await toggleInput.click();
      await toggleInput.fill("Ctrl+Alt+R");
      await mainWindow.waitForTimeout(1000);
    }

    // Return to history page
    await mainWindow.click('[data-testid="nav-history"]');
    await mainWindow.waitForTimeout(500);

    // Verify initial idle state
    await expect(
      widgetWindow.locator('[data-recording-state="idle"]')
    ).toBeVisible();

    // Start fake audio stream
    const streamResult = await startFakeAudioStream();
    expect(streamResult.success).toBe(true);

    // Trigger toggle shortcut to start recording
    await mainWindow.keyboard.press("Control+Alt+KeyR");

    // Verify hands-free recording started
    await expect(
      widgetWindow.locator('[data-recording-state="recording"]')
    ).toBeVisible({ timeout: 3000 });
    await expect(
      widgetWindow.locator('[data-recording-mode="hands-free"]')
    ).toBeVisible();

    // Wait for recording duration
    console.log("Toggle recording for 3 seconds...");
    await mainWindow.waitForTimeout(3000);

    // Trigger toggle shortcut again to stop recording
    await mainWindow.keyboard.press("Control+Alt+KeyR");

    // Stop fake audio stream
    await stopFakeAudioStream();

    // Verify recording stopped
    await expect(
      widgetWindow.locator('[data-recording-state="stopping"]')
    ).toBeVisible();
    await expect(
      widgetWindow.locator('[data-testid="widget-processing-indicator"]')
    ).toBeVisible();

    // Wait for completion
    await expect(
      widgetWindow.locator('[data-recording-state="idle"]')
    ).toBeVisible({ timeout: 20000 });

    // Verify transcription created
    const transcription = await waitForTranscriptionInDatabase();
    expect(transcription).toBeDefined();
    expect(transcription.text.toLowerCase()).toContain(
      expectedTranscriptionText.toLowerCase()
    );
  });

  test("should handle widget states correctly", async () => {
    // Test idle state
    await expect(
      widgetWindow.locator('[data-recording-state="idle"]')
    ).toBeVisible();

    // Test collapsed widget (should be small)
    await expect(widgetWindow.locator('[data-expanded="false"]')).toBeVisible();

    // Test hover expansion
    await widgetWindow.hover('[data-testid="widget-floating-button"]');
    await widgetWindow.waitForTimeout(300);
    await expect(widgetWindow.locator('[data-expanded="true"]')).toBeVisible();

    // Test recording button visibility when expanded
    await expect(
      widgetWindow.locator('[data-testid="widget-recording-btn"]')
    ).toBeVisible();

    // Start fake audio and recording to test recording state
    const streamResult = await startFakeAudioStream();
    expect(streamResult.success).toBe(true);

    await widgetWindow.click('[data-testid="widget-recording-btn"]');
    await expect(
      widgetWindow.locator('[data-recording-state="recording"]')
    ).toBeVisible();
    await expect(
      widgetWindow.locator('[data-testid="widget-waveform-visualization"]')
    ).toBeVisible();

    // Test stop button appears during recording
    await expect(
      widgetWindow.locator('[data-testid="widget-stop-recording-btn"]')
    ).toBeVisible();

    await widgetWindow.waitForTimeout(2000);

    // Stop recording
    await widgetWindow.click('[data-testid="widget-stop-recording-btn"]');
    await stopFakeAudioStream();

    // Test processing state
    await expect(
      widgetWindow.locator('[data-recording-state="stopping"]')
    ).toBeVisible();
    await expect(
      widgetWindow.locator('[data-testid="widget-processing-indicator"]')
    ).toBeVisible();

    // Return to idle
    await expect(
      widgetWindow.locator('[data-recording-state="idle"]')
    ).toBeVisible({ timeout: 20000 });
  });

  test("should verify fake microphone is working consistently", async () => {
    // This test specifically verifies the fake microphone setup
    console.log("Testing fake microphone consistency...");

    // Test multiple getUserMedia calls
    for (let i = 0; i < 3; i++) {
      console.log(`Testing fake microphone iteration ${i + 1}`);

      const result = await mainWindow.evaluate(async (iteration) => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });

          const audioTracks = stream.getAudioTracks();
          const settings = audioTracks[0]?.getSettings();

          // Clean up
          stream.getTracks().forEach((track) => track.stop());

          return {
            success: true,
            iteration,
            trackCount: audioTracks.length,
            sampleRate: settings?.sampleRate,
            channelCount: settings?.channelCount,
            deviceId: settings?.deviceId,
          };
        } catch (error) {
          return {
            success: false,
            iteration,
            error: error.message,
          };
        }
      }, i);

      console.log(`Fake microphone test ${i + 1}:`, result);
      expect(result.success).toBe(true);
      expect(result.trackCount).toBe(1);

      await mainWindow.waitForTimeout(500);
    }
  });
});
