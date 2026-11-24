import { app, BrowserWindow, type WebContents } from "electron";
import { LINUX_KEYCODES_BY_DOM_CODE } from "@/utils/keycodes";

/**
 * Reports the keys held in the app's own windows, as Linux key codes, until
 * the returned function is called. On Wayland the helper cannot see keys,
 * so the shortcut recorder reads them from the focused window instead.
 */
export function watchWindowKeys(
  onChange: (keys: number[]) => void,
): () => void {
  const held = new Set<number>();
  const onInput = (_event: Electron.Event, input: Electron.Input) => {
    const code = LINUX_KEYCODES_BY_DOM_CODE[input.code];
    if (code === undefined) return;
    if (input.type === "keyDown") {
      if (held.has(code)) return;
      held.add(code);
    } else if (input.type === "keyUp") {
      if (!held.delete(code)) return;
    } else {
      return;
    }
    onChange([...held]);
  };

  const watched = new Set<WebContents>();
  const watch = (window: BrowserWindow) => {
    const contents = window.webContents;
    if (watched.has(contents)) return;
    watched.add(contents);
    contents.on("before-input-event", onInput);
  };
  const onWindowCreated = (_event: Electron.Event, window: BrowserWindow) =>
    watch(window);

  BrowserWindow.getAllWindows().forEach(watch);
  app.on("browser-window-created", onWindowCreated);
  return () => {
    app.off("browser-window-created", onWindowCreated);
    for (const contents of watched) {
      if (!contents.isDestroyed()) {
        contents.off("before-input-event", onInput);
      }
    }
  };
}
