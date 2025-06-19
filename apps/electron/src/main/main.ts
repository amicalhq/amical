// Load .env file FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import {
  app,
  BrowserWindow,
  systemPreferences,
  globalShortcut,
  ipcMain,
  screen,
  clipboard,
} from 'electron';
import path from 'node:path';
import fsPromises from 'node:fs/promises'; // For reading the audio file (async)
import started from 'electron-squirrel-startup';
import Store from 'electron-store';
//import { runMigrations } from '../db/migrate';
import { HelperEvent, KeyEventPayload } from '@amical/types';
import { logger, logError, logPerformance } from './logger';
import { AudioCapture } from '../modules/audio/audio-capture';
import { setupApplicationMenu } from './menu';
import { OpenAIWhisperClient } from '../modules/ai/openai-whisper-client';
import { AiService } from '../modules/ai/ai-service';
import { SwiftIOBridge } from './swift-io-bridge'; // Added import

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

const WIDGET_WINDOW_VITE_NAME = 'widget_window';

let mainWindow: BrowserWindow | null = null;
let floatingButtonWindow: BrowserWindow | null = null;
let audioCapture: AudioCapture | null = null;
let aiService: AiService | null = null;
let swiftIOBridgeClientInstance: SwiftIOBridge | null = null;
let openAiApiKey: string | null = null;
let currentWindowDisplayId: number | null = null; // For tracking current display
let activeSpaceChangeSubscriptionId: number | null = null; // For display change notifications

interface StoreSchema {
  'openai-api-key': string;
}

const store = new Store<StoreSchema>();

// Function to create the appropriate transcription client based on configuration
const createTranscriptionClient = () => {
  // Check environment variable or use OpenAI as default
  const useCloudInference = true;
  
  if (useCloudInference) {
    logger.ai.info('Using Amical Cloud inference (via USE_CLOUD_INFERENCE=true)');
    return new AmicalCloudClient();
  } else {
    logger.ai.info('Using OpenAI inference (default or USE_CLOUD_INFERENCE=false)');
    const apiKey = store.get('openai-api-key') || process.env.OPENAI_API_KEY || null;
    if (!apiKey) {
      throw new Error('OpenAI API key is required when using OpenAI inference. Set it via UI or OPENAI_API_KEY env var.');
    }
    return new OpenAIWhisperClient(apiKey);
  }
};

ipcMain.handle('set-api-key', (event, apiKey: string) => {
  logger.main.info('Received set-api-key request', { hasApiKey: !!apiKey });
  openAiApiKey = apiKey;
  store.set('openai-api-key', apiKey);
});

ipcMain.handle('get-api-key', () => {
  return store.get('openai-api-key', '');
});

const requestPermissions = async () => {
  try {
    // Request accessibility permissions
    if (process.platform === 'darwin') {
      const accessibilityEnabled = systemPreferences.isTrustedAccessibilityClient(false);
      if (!accessibilityEnabled) {
        // On macOS, we need to use a different approach for accessibility permissions
        // The user will need to grant accessibility permissions through System Preferences
        console.log(
          'Please enable accessibility permissions in System Preferences > Security & Privacy > Privacy > Accessibility'
        );
      }
    }

    // Request microphone permissions
    const microphoneEnabled = systemPreferences.getMediaAccessStatus('microphone');
    logger.main.info('Microphone access status:', { status: microphoneEnabled });
    if (microphoneEnabled !== 'granted') {
      await systemPreferences.askForMediaAccess('microphone');
    }
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), 'requesting permissions');
  }
};

const createOrShowMainWindow = () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 20 },
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const createFloatingButtonWindow = () => {
  const mainScreen = screen.getPrimaryDisplay();
  const { width, height } = mainScreen.workAreaSize;

  floatingButtonWindow = new BrowserWindow({
    width,
    height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  currentWindowDisplayId = mainScreen.id; // Initialize with the primary display's ID

  floatingButtonWindow.setIgnoreMouseEvents(true, { forward: true });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const devUrl = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    devUrl.pathname = 'fab.html';
    floatingButtonWindow.loadURL(devUrl.toString());
  } else {
    floatingButtonWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/fab.html`)
    );
  }

  // Set a higher level for macOS to stay on top of fullscreen apps
  if (process.platform === 'darwin') {
    floatingButtonWindow.setAlwaysOnTop(true, 'floating', 1);
    floatingButtonWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    floatingButtonWindow.setHiddenInMissionControl(true);
  }

  // floatingButtonWindow.webContents.openDevTools({ mode: 'detach' }); // For debugging the button
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  // Run database migrations first
  try {
    //runMigrations();
    logger.db.info('Database migrations completed successfully');
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), 'running database migrations');
    // You might want to handle this error differently, perhaps showing a dialog to the user
  }

  await requestPermissions();
  createFloatingButtonWindow();

  if (process.platform === 'darwin' && app.dock) {
    app.dock.show();
  }

  audioCapture = new AudioCapture();

  // Initialize AI service with the appropriate client based on configuration
  try {
    const transcriptionClient = createTranscriptionClient();
    aiService = new AiService(transcriptionClient);
    const useCloudInference = process.env.USE_CLOUD_INFERENCE === 'true';
    logger.ai.info('AI Service initialized', { 
      client: useCloudInference ? 'Amical Cloud' : 'OpenAI' 
    });
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), 'initializing AI Service');
    logger.ai.warn('Transcription will not work until configuration is fixed');
    aiService = null;
  }

  audioCapture.on('recording-finished', async (filePath: string) => {
    // Ensure AI service is available and up-to-date
    if (!aiService) {
      try {
        const transcriptionClient = createTranscriptionClient();
        aiService = new AiService(transcriptionClient);
        const useCloudInference = process.env.USE_CLOUD_INFERENCE === 'true';
        logger.ai.info('AI Service reinitialized', { 
          client: useCloudInference ? 'Amical Cloud' : 'OpenAI' 
        });
      } catch (error) {
        logError(error instanceof Error ? error : new Error(String(error)), 'reinitializing AI Service');
      }
    }

    logger.audio.info('Recording finished', { filePath });
    if (aiService) {
      try {
        const startTime = Date.now();
        const audioBuffer = await fsPromises.readFile(filePath);
        logger.audio.info('Audio file read', { 
          size: audioBuffer.length,
          sizeKB: Math.round(audioBuffer.length / 1024)
        });
        
        const transcription = await aiService.transcribeAudio(audioBuffer);
        logPerformance('audio transcription', startTime, { 
          audioSizeKB: Math.round(audioBuffer.length / 1024),
          transcriptionLength: transcription?.length || 0
        });
        logger.ai.info('Transcription completed', { 
          resultLength: transcription?.length || 0,
          hasResult: !!transcription
        });

        // Copy transcription to clipboard
        if (transcription && typeof transcription === 'string') {
          logger.main.info('Transcription pasted to active application');
          // Attempt to paste into the active application
          swiftIOBridgeClientInstance!.call('pasteText', { transcript: transcription });
        } else {
          logger.main.warn('Transcription result was empty or not a string, not copying');
        }

        // Optionally, delete the audio file after processing
        // await fs.unlink(filePath);
        // console.log(`Main: Deleted audio file: ${filePath}`);
      } catch (error) {
        logError(error instanceof Error ? error : new Error(String(error)), 'transcription or file handling');
      }
    } else {
      logger.ai.warn('AI Service not available, cannot transcribe audio');
    }
  });

  audioCapture.on('recording-error', (error: Error) => {
    console.error('Main: Received recording error from AudioCapture:', error);
  });

  // Handle audio data chunks from renderer
  ipcMain.handle('audio-data-chunk', (event, chunk: ArrayBuffer, isFinalChunk: boolean) => {
    if (chunk instanceof ArrayBuffer) {
      console.log(
        `Main: IPC received audio-data-chunk (ArrayBuffer) of size: ${chunk.byteLength} bytes. isFinalChunk: ${isFinalChunk}`
      );
      const buffer = Buffer.from(chunk);
      if (buffer.length === 0) {
        console.warn('Main: Received an empty audio chunk after conversion.');
      }
      // The AudioCapture class will now need to handle buffering and the isFinalChunk flag
      audioCapture?.handleAudioChunk(buffer, isFinalChunk);
    } else {
      console.error(
        'Main: Received audio chunk, but it is not an ArrayBuffer. Type:',
        typeof chunk
      );
      throw new Error('Invalid audio chunk type received.');
    }
  });

  ipcMain.handle('recording-starting', async () => {
    console.log('Main: Received recording-starting event.');
    
    // Get accessibility context when recording starts
    try {
      const accessibilityContext = await swiftIOBridgeClientInstance!.call('getAccessibilityContext', { editableOnly: true });
      console.log('Main: Accessibility context captured:', JSON.stringify(accessibilityContext, null, 2));
    } catch (error) {
      console.error('Main: Error getting accessibility context:', error);
    }
    
    await swiftIOBridgeClientInstance!.call('muteSystemAudio', {});
  });

  ipcMain.handle('recording-stopping', async () => {
    console.log('Main: Received recording-stopping event.');
    await swiftIOBridgeClientInstance!.call('restoreSystemAudio', {});
  });

  // Initialize the SwiftIOBridgeClient
  swiftIOBridgeClientInstance = new SwiftIOBridge();

  swiftIOBridgeClientInstance.on('helperEvent', (event: HelperEvent) => {
    logger.swift.debug('Received helperEvent from SwiftIOBridge', { event });

    switch (event.type) {
      case 'flagsChanged': {
        const payload = event.payload;
        logger.swift.debug('Received flagsChanged event', { 
          fnKeyPressed: payload?.fnKeyPressed 
        });
        // Use flagsChanged for more reliable Fn key state tracking
        if (payload?.fnKeyPressed !== undefined) {
          logger.swift.info('Setting recording state', { state: payload.fnKeyPressed });
          floatingButtonWindow!.webContents.send('recording-state-changed', payload.fnKeyPressed);
        }
        break;
      }
      case 'keyDown': {
        const payload = event.payload;
        console.log(`Main: Received keyDown for key: ${payload?.key}.`);
        // Keep keyDown handling as fallback, but flagsChanged should be primary
        if (payload?.key?.toLowerCase() === 'fn') {
          console.log('Main: Fn keyDown detected (fallback)');
          // Don't send recording-state-changed here as flagsChanged should handle it
        }
        break;
      }
      case 'keyUp': {
        const payload = event.payload;
        console.log(`Main: Received keyUp for key: ${payload?.key}.`);
        // Keep keyUp handling as fallback, but flagsChanged should be primary
        if (payload?.key?.toLowerCase() === 'fn') {
          console.log('Main: Fn keyUp detected (fallback)');
          // Don't send recording-state-changed here as flagsChanged should handle it
        }
        break;
      }
      default:
        // Optionally log or handle other event types if necessary
        // console.log('Main: Unhandled helperEvent type:', (event as any).type);
        break;
    }
  });

  swiftIOBridgeClientInstance.on('error', (error) => {
    logError(error instanceof Error ? error : new Error(String(error)), 'SwiftIOBridge error');
    // Potentially notify the user or attempt to restart
  });

  swiftIOBridgeClientInstance.on('close', (code) => {
    logger.swift.warn('Swift helper process closed', { code });
    // Handle unexpected close, maybe attempt restart
  });

  setupApplicationMenu(createOrShowMainWindow);

  if (process.platform === 'darwin') {
    try {
      console.log("Main: Setting up display change notifications");
      
      activeSpaceChangeSubscriptionId = systemPreferences.subscribeWorkspaceNotification(
        'NSWorkspaceActiveDisplayDidChangeNotification',
        () => {
          if (floatingButtonWindow && !floatingButtonWindow.isDestroyed()) {
            try {
              const cursorPoint = screen.getCursorScreenPoint();
              const displayForCursor = screen.getDisplayNearestPoint(cursorPoint);
              if (currentWindowDisplayId !== displayForCursor.id) {
                console.log(
                  `[Main Process] Moving floating window to display ID: ${displayForCursor.id}`
                );
                floatingButtonWindow.setBounds(displayForCursor.workArea);
                currentWindowDisplayId = displayForCursor.id;
              }
            } catch (error) {
              console.warn('[Main Process] Error handling display change:', error);
            }
          }
        }
      );

      if (activeSpaceChangeSubscriptionId !== undefined && activeSpaceChangeSubscriptionId >= 0) {
        console.log(`Main: Successfully subscribed to display change notifications`);
      } else {
        console.error('Main: Failed to subscribe to display change notifications');
      }
    } catch (e) {
      console.error('Main: Error during subscription to display notifications:', e);
      activeSpaceChangeSubscriptionId = null;
    }
  } else {
    console.log('Main: Display change tracking is a macOS-only feature');
  }
});

// Clean up intervals and subscriptions
app.on('will-quit', () => {
  // globalShortcut.unregisterAll();
  globalShortcut.unregisterAll();
  if (swiftIOBridgeClientInstance) {
    console.log('Main: Stopping Swift helper...');
    swiftIOBridgeClientInstance.stopHelper();
  }
  if (process.platform === 'darwin' && activeSpaceChangeSubscriptionId !== null) {
    systemPreferences.unsubscribeWorkspaceNotification(activeSpaceChangeSubscriptionId);
    console.log('Main: Unsubscribed from display change notifications');
    activeSpaceChangeSubscriptionId = null;
  }
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    // If no windows are open, create both FAB and main window
    createFloatingButtonWindow();
  } else {
    // If there are windows, ensure FAB is visible.
    if (!floatingButtonWindow || floatingButtonWindow.isDestroyed()) {
      createFloatingButtonWindow();
    } else {
      floatingButtonWindow.show();
    }
    
    // Always show/create the main window when dock icon is clicked
    createOrShowMainWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

// Function to log the accessibility tree (added)
async function logAccessibilityTree() {
  if (swiftIOBridgeClientInstance && swiftIOBridgeClientInstance.isHelperRunning()) {
    try {
      console.log('Main: Requesting full accessibility tree...');
      // Call with empty params for the whole tree, as per schema for GetAccessibilityTreeDetailsParams
      const result = await swiftIOBridgeClientInstance.call('getAccessibilityTreeDetails', {});
      // Using JSON.stringify to see the whole structure since it's 'any' for now
      console.log('Main: Accessibility tree received:', JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('Main: Error calling getAccessibilityTreeDetails:', error);
    }
  } else {
    console.warn(
      'Main: SwiftIOBridge not ready or helper not running, cannot log accessibility tree.'
    );
  }
}
