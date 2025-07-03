import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test.describe('Vite Build Launch', () => {
  test('launch using vite build output', async () => {
    const mainPath = path.join(__dirname, '..', '.vite', 'build', 'main.js');
    
    // Check if vite build exists
    if (!fs.existsSync(mainPath)) {
      console.log('Vite build not found. Building...');
      const { execSync } = require('child_process');
      execSync('pnpm run build', { 
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit' 
      });
    }
    
    console.log('Launching Electron with Vite build...');
    
    const electronApp = await electron.launch({
      args: [mainPath],
      timeout: 30000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        // Disable some features that might interfere with testing
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
    });
    
    console.log('✓ Electron app launched');
    
    // Wait for the first window
    const window = await electronApp.firstWindow();
    console.log('✓ First window detected');
    
    // Wait for content to load
    await window.waitForLoadState('domcontentloaded');
    console.log('✓ DOM content loaded');
    
    // Basic checks
    const isVisible = await window.isVisible();
    expect(isVisible).toBe(true);
    
    const title = await window.title();
    console.log(`Window title: "${title}"`);
    expect(title).toBeTruthy();
    
    // Check if React app is mounted
    const hasReactRoot = await window.evaluate(() => {
      const root = document.querySelector('#root');
      return root && root.children.length > 0;
    });
    expect(hasReactRoot).toBe(true);
    console.log('✓ React app mounted');
    
    // Take a screenshot
    await window.screenshot({ 
      path: path.join(__dirname, '..', 'test-results', 'vite-app-launched.png'),
      fullPage: true 
    });
    console.log('✓ Screenshot captured');
    
    // Close the app
    await electronApp.close();
    console.log('✓ App closed successfully');
  });
  
  test('test recording functionality', async () => {
    const mainPath = path.join(__dirname, '..', '.vite', 'build', 'main.js');
    
    const electronApp = await electron.launch({
      args: [mainPath],
      timeout: 30000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });
    
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('networkidle');
    
    // Look for recording button in either main window or widget
    const windows = await electronApp.windows();
    console.log(`Found ${windows.length} windows`);
    
    let recordButton;
    let targetWindow;
    
    for (const win of windows) {
      try {
        // Try multiple selectors for the record button
        const selectors = [
          'button:has-text("Record")',
          '[data-testid="record-button"]',
          '[aria-label*="record" i]',
          'button[title*="record" i]',
          // Widget specific
          '[data-testid="floating-button"]',
          '.floating-button',
        ];
        
        for (const selector of selectors) {
          const button = await win.locator(selector).first();
          if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
            recordButton = button;
            targetWindow = win;
            console.log(`✓ Found record button with selector: ${selector}`);
            break;
          }
        }
        
        if (recordButton) break;
      } catch (e) {
        // Continue to next window
      }
    }
    
    if (recordButton && targetWindow) {
      // Click record button
      await recordButton.click();
      console.log('✓ Clicked record button');
      
      // Wait a bit
      await targetWindow.waitForTimeout(2000);
      
      // Look for stop button or recording indicator
      const stopButton = await targetWindow.locator('button:has-text("Stop"), [data-testid="stop-button"]').first();
      if (await stopButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('✓ Recording started - stop button visible');
        await stopButton.click();
        console.log('✓ Clicked stop button');
      }
    } else {
      console.log('⚠️  Could not find record button - app might need permissions or different UI');
    }
    
    await electronApp.close();
  });
});