import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { z } from 'zod';

const t = initTRPC.create({
  isServer: true,
  transformer: superjson,
});

// We'll need to access the auto-updater service from the main process
declare global {
  var autoUpdaterService: any;
  var logger: any;
}

export const updaterRouter = t.router({
  // Check for updates (manual trigger)
  checkForUpdates: t.procedure
    .input(z.object({ userInitiated: z.boolean().optional().default(false) }).optional())
    .mutation(async ({ input }) => {
      try {
        if (!globalThis.autoUpdaterService) {
          throw new Error('Auto-updater service not available');
        }
        
        const userInitiated = input?.userInitiated ?? false;
        await globalThis.autoUpdaterService.checkForUpdates(userInitiated);
        globalThis.logger?.updater.info('Update check initiated via tRPC', { userInitiated });
        
        return { success: true };
      } catch (error) {
        globalThis.logger?.updater.error('Error checking for updates via tRPC', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        throw error;
      }
    }),

  // Check for updates and notify (background check)
  checkForUpdatesAndNotify: t.procedure.mutation(async () => {
    try {
      if (!globalThis.autoUpdaterService) {
        throw new Error('Auto-updater service not available');
      }
      
      await globalThis.autoUpdaterService.checkForUpdatesAndNotify();
      globalThis.logger?.updater.info('Background update check initiated via tRPC');
      
      return { success: true };
    } catch (error) {
      globalThis.logger?.updater.error('Error in background update check via tRPC', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }),

  // Download available update
  downloadUpdate: t.procedure.mutation(async () => {
    try {
      if (!globalThis.autoUpdaterService) {
        throw new Error('Auto-updater service not available');
      }
      
      await globalThis.autoUpdaterService.downloadUpdate();
      globalThis.logger?.updater.info('Update download initiated via tRPC');
      
      return { success: true };
    } catch (error) {
      globalThis.logger?.updater.error('Error downloading update via tRPC', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }),

  // Quit and install update
  quitAndInstall: t.procedure.mutation(async () => {
    try {
      if (!globalThis.autoUpdaterService) {
        throw new Error('Auto-updater service not available');
      }
      
      globalThis.logger?.updater.info('Quit and install initiated via tRPC');
      globalThis.autoUpdaterService.quitAndInstall();
      
      return { success: true };
    } catch (error) {
      globalThis.logger?.updater.error('Error quitting and installing via tRPC', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }),

  // Get current update checking status
  isCheckingForUpdate: t.procedure.query(async () => {
    try {
      if (!globalThis.autoUpdaterService) {
        return false;
      }
      
      return globalThis.autoUpdaterService.isCheckingForUpdate();
    } catch (error) {
      globalThis.logger?.updater.error('Error getting update checking status via tRPC', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return false;
    }
  }),

  // Get current update available status
  isUpdateAvailable: t.procedure.query(async () => {
    try {
      if (!globalThis.autoUpdaterService) {
        return false;
      }
      
      return globalThis.autoUpdaterService.isUpdateAvailable();
    } catch (error) {
      globalThis.logger?.updater.error('Error getting update available status via tRPC', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return false;
    }
  }),
});