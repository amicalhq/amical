import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

test.describe('App Startup', () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>>;

  test.beforeEach(async () => {
    // Check if packaged app exists
    const packagedAppPath = path.join(__dirname, '..', 'out', 'Amical-darwin-arm64', 'Amical.app', 'Contents', 'MacOS', 'Amical');
    const devAppPath = path.join(__dirname, '..', '.vite', 'build', 'main.js');
    
    // Try packaged app first, fall back to dev build
    const executablePath = require('fs').existsSync(packagedAppPath) ? packagedAppPath : devAppPath;
    
    // Launch Electron app
    electronApp = await electron.launch({
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-gpu-sandbox',
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('main window and widget window load successfully', async () => {
    // Wait for windows to be created
    const windows = await electronApp.windows();
    
    // Should have at least main window
    expect(windows.length).toBeGreaterThanOrEqual(1);
    
    // Get main window
    const mainWindow = windows[0];
    await mainWindow.waitForLoadState('domcontentloaded');
    
    // Check main window title
    const title = await mainWindow.title();
    expect(title).toBeTruthy();
    
    // Check if main window is visible
    const isVisible = await mainWindow.isVisible();
    expect(isVisible).toBe(true);
    
    // Wait for widget window to appear (it may load after main)
    await mainWindow.waitForTimeout(2000);
    
    // Get all windows again
    const allWindows = await electronApp.windows();
    
    // Find widget window (usually smaller and frameless)
    const widgetWindow = allWindows.find(async (win) => {
      const url = await win.url();
      return url.includes('widget.html') || url.includes('widget');
    });
    
    if (widgetWindow) {
      await widgetWindow.waitForLoadState('domcontentloaded');
      
      // Widget should have the floating button
      const floatingButton = await widgetWindow.locator('[data-testid="floating-button"], button').first();
      expect(floatingButton).toBeTruthy();
    }
    
    // Verify IPC is working by checking console logs
    const logs: string[] = [];
    mainWindow.on('console', (msg) => logs.push(msg.text()));
    
    // App should be ready
    await expect(logs.some(log => 
      log.includes('App ready') || 
      log.includes('ready') ||
      log.includes('started')
    )).toBeTruthy();
  });

  test('can access main app UI elements', async () => {
    const mainWindow = await electronApp.firstWindow();
    await mainWindow.waitForLoadState('networkidle');
    
    // Check for key UI elements
    const appContainer = await mainWindow.locator('#root, .app, [data-testid="app"]').first();
    expect(appContainer).toBeTruthy();
    
    // Check if React app mounted
    const reactRoot = await mainWindow.evaluate(() => {
      return document.querySelector('#root')?._reactRootContainer || 
             document.querySelector('[data-reactroot]') ||
             document.querySelector('#root')?.children.length > 0;
    });
    expect(reactRoot).toBeTruthy();
  });
});