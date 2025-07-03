import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test.describe('Debug App Launch', () => {
  test('debug why app launch fails', async () => {
    console.log('Starting debug test...');
    
    // Check multiple possible app paths
    const possiblePaths = [
      path.join(__dirname, '..', 'out', 'Amical-darwin-arm64', 'Amical.app', 'Contents', 'MacOS', 'Amical'),
      path.join(__dirname, '..', '.vite', 'build', 'main.js'),
    ];
    
    let executablePath: string | undefined;
    for (const p of possiblePaths) {
      console.log(`Checking path: ${p}`);
      if (fs.existsSync(p)) {
        console.log(`✓ Found executable at: ${p}`);
        executablePath = p;
        break;
      }
    }
    
    if (!executablePath) {
      throw new Error('No executable found');
    }
    
    console.log('Attempting to launch with electron.launch()...');
    
    try {
      // Try with minimal options first
      const electronApp = await electron.launch({
        executablePath,
        timeout: 60000, // 60 seconds
        env: {
          ...process.env,
          ELECTRON_ENABLE_LOGGING: '1',
          NODE_ENV: 'test',
        },
      });
      
      console.log('✓ App launched successfully');
      
      // Get all windows
      const windows = await electronApp.windows();
      console.log(`Found ${windows.length} windows`);
      
      // Wait a bit for app to stabilize
      if (windows.length > 0) {
        await windows[0].waitForTimeout(2000);
      }
      
      await electronApp.close();
      console.log('✓ App closed successfully');
      
    } catch (error) {
      console.error('Launch failed with error:', error);
      
      // Try alternative launch method with args
      console.log('\nTrying alternative launch with args...');
      try {
        const electronApp = await electron.launch({
          args: [path.join(__dirname, '..', '.vite', 'build', 'main.js')],
          timeout: 60000,
          env: {
            ...process.env,
            ELECTRON_ENABLE_LOGGING: '1',
            NODE_ENV: 'test',
          },
        });
        
        console.log('✓ Alternative launch successful');
        await electronApp.close();
      } catch (altError) {
        console.error('Alternative launch also failed:', altError);
        throw altError;
      }
    }
  });
  
  test('test with dev server', async () => {
    console.log('Testing with dev server approach...');
    
    // This test assumes the app is running via `pnpm start` in another terminal
    try {
      const electronApp = await electron.launch({
        args: ['.'],
        cwd: path.join(__dirname, '..'),
        timeout: 30000,
        env: {
          ...process.env,
          NODE_ENV: 'development',
        },
      });
      
      console.log('✓ Connected to dev app');
      
      const window = await electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      
      console.log('✓ Window loaded');
      
      await electronApp.close();
    } catch (error) {
      console.error('Dev server test failed:', error);
      console.log('\nMake sure to run "pnpm start" in another terminal before running this test');
      throw error;
    }
  });
});