import { test, expect, ElectronApplication, _electron as electron } from '@playwright/test';
import path from 'path';

test.describe('Basic Launch Test', () => {
  let electronApp: ElectronApplication;

  test('launch app using development mode', async () => {
    // Launch using the main.js file directly (development mode)
    electronApp = await electron.launch({
      args: [path.join(__dirname, '..', 'src', 'main', 'main.ts')],
      timeout: 30000,
    });

    // Wait for the first window
    const window = await electronApp.firstWindow();
    
    // Basic checks
    expect(window).toBeTruthy();
    
    // Check window state
    const isVisible = await window.isVisible();
    expect(isVisible).toBe(true);

    // Cleanup
    await electronApp.close();
  });
});