import { app, dialog } from "electron";
import started from "electron-squirrel-startup";

// Squirrel.Windows event hooks (shortcut create/remove on install, update,
// uninstall): electron-squirrel-startup spawns the Update.exe work and quits
// the app once it completes.
if (started) {
  app.quit();
}

// The entire app lives behind this dynamic import so a module-evaluation
// failure anywhere in its graph (broken native binding, quarantined file)
// rejects here — where the user can still be told — instead of crashing the
// process before any error handling exists. Keep this entry's own imports
// minimal for the same reason. showErrorBox is safe before the ready event.
import("./app").catch((error: unknown) => {
  console.error("Failed to load application", error);
  dialog.showErrorBox(
    "Amical failed to start",
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  app.exit(1);
});
