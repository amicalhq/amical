import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { spawn } from 'child_process';

test.describe('Connect to Running App', () => {
  test('launch app manually and connect', async () => {
    // Path to packaged app
    const appPath = path.join(__dirname, '..', 'out', 'Amical-darwin-arm64', 'Amical.app', 'Contents', 'MacOS', 'Amical');
    
    console.log('Spawning app manually...');
    
    // Start the app as a separate process
    const appProcess = spawn(appPath, ['--remote-debugging-port=9222'], {
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
      },
      stdio: 'pipe',
    });
    
    // Capture output
    appProcess.stdout.on('data', (data) => {
      console.log(`App stdout: ${data}`);
    });
    
    appProcess.stderr.on('data', (data) => {
      console.log(`App stderr: ${data}`);
    });
    
    // Wait for app to start
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    try {
      // Try to connect to the running app
      console.log('Attempting to connect to app on port 9222...');
      
      const browser = await electron.connect('ws://localhost:9222');
      console.log('✓ Connected to Electron app');
      
      const windows = await browser.windows();
      console.log(`Found ${windows.length} windows`);
      
      if (windows.length > 0) {
        const window = windows[0];
        const title = await window.title();
        console.log(`Window title: ${title}`);
        
        // Take screenshot
        await window.screenshot({ path: 'test-results/connected-app.png' });
        console.log('✓ Screenshot taken');
      }
      
      await browser.close();
    } catch (error) {
      console.error('Connection error:', error);
      throw error;
    } finally {
      // Kill the app process
      appProcess.kill();
      console.log('App process killed');
    }
  });
  
  test('test packaged app with different launch method', async () => {
    console.log('Testing with electron.launch() using packaged app directly...');
    
    try {
      // Launch using the packaged app path directly
      const electronApp = await electron.launch({
        executablePath: '/Applications/Amical.app/Contents/MacOS/Amical',
        timeout: 30000,
      });
      
      console.log('✓ App launched');
      
      const window = await electronApp.firstWindow();
      await window.waitForLoadState();
      
      const title = await window.title();
      console.log(`Window title: ${title}`);
      
      await electronApp.close();
    } catch (error) {
      console.error('Failed to launch from /Applications:', error);
      
      // Try launching the .app bundle directly
      console.log('\nTrying to launch .app bundle...');
      const appBundlePath = path.join(__dirname, '..', 'out', 'Amical-darwin-arm64', 'Amical.app');
      
      try {
        const { exec } = require('child_process');
        await new Promise((resolve, reject) => {
          exec(`open "${appBundlePath}"`, (error) => {
            if (error) reject(error);
            else resolve(undefined);
          });
        });
        
        console.log('✓ App bundle opened with "open" command');
        
        // Wait for app to start
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Now try to connect
        const electronApp = await electron.connect({
          wsEndpoint: 'ws://localhost:9222',
          timeout: 10000,
        });
        
        console.log('✓ Connected to running app');
        
        const windows = await electronApp.windows();
        console.log(`Found ${windows.length} windows`);
        
        await electronApp.close();
      } catch (openError) {
        console.error('Failed to open app bundle:', openError);
        throw openError;
      }
    }
  });
});