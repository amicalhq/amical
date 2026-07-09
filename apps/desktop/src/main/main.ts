import { app, dialog } from "electron";
import started from "electron-squirrel-startup";

if (started) {
  // Squirrel.Windows event hook process (--squirrel-install/-updated/
  // -obsolete/-uninstall): electron-squirrel-startup spawns the Update.exe
  // shortcut work and quits once it completes. Nothing else may run here —
  // loading the app would reach requestSingleInstanceLock(), which fires
  // second-instance in the already-running app and pops the main window
  // mid-background-update.
  app.quit();
} else {
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
}
