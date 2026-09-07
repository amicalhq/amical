import { test, expect, type Page } from "@playwright/test";
import superjson from "superjson";
import path from "node:path";
import { launchAmical, closeAmical, type AmicalLaunch } from "./helpers/launch";
import type { Note } from "../src/db/schema";

let requestId = 1_000_000;
async function rpc<T>(
  page: Page,
  path: string,
  type: "query" | "mutation",
  input: unknown,
): Promise<T> {
  const response = await page.evaluate(
    ({ path, type, input, id }) =>
      new Promise<unknown>((resolve, reject) => {
        const api = (
          window as unknown as {
            electronTRPC: {
              onMessage: (
                callback: (message: {
                  id: number;
                  error?: unknown;
                  result?: { data: unknown };
                }) => void,
              ) => void;
              sendMessage: (message: unknown) => void;
            };
          }
        ).electronTRPC;
        const timeout = setTimeout(
          () => reject(new Error(`No response for ${path}`)),
          10_000,
        );
        api.onMessage((message) => {
          if (message.id !== id) return;
          clearTimeout(timeout);
          if (message.error) reject(new Error(JSON.stringify(message.error)));
          else resolve(message.result!.data);
        });
        api.sendMessage({
          method: "request",
          operation: { id, path, type, input, context: {} },
        });
      }),
    { path, type, input: superjson.serialize(input), id: requestId++ },
  );
  return superjson.deserialize(
    response as Parameters<typeof superjson.deserialize>[0],
  );
}

// Launch the actual widget renderer and preload against the throwaway app
// profile. This avoids depending on remote feature-flag enrollment in a test.
async function openNote(launch: AmicalLaunch, noteId: string): Promise<Page> {
  const appPath = await launch.app.evaluate(({ app }) => app.getAppPath());
  const id = await launch.app.evaluate(
    async ({ BrowserWindow }, { preload, html, noteId }) => {
      const window = new BrowserWindow({
        width: 600,
        height: 700,
        webPreferences: {
          preload,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      await window.loadFile(html, { hash: `noteId=${noteId}` });
      return window.webContents.id;
    },
    {
      preload: path.join(appPath, ".vite/build/preload.js"),
      html: path.join(
        appPath,
        ".vite/renderer/notes_widget_window/notes-widget.html",
      ),
      noteId,
    },
  );
  for (const page of launch.app.windows()) {
    const handle = await launch.app.browserWindow(page);
    if ((await handle.evaluate((window) => window.webContents.id)) === id)
      return page;
  }
  throw new Error("Notes window not found");
}

test("notes widget edits persist as Markdown across close and reopen", async () => {
  const launch = await launchAmical();
  try {
    const onboarding = await launch.app.firstWindow();
    await onboarding.waitForLoadState("domcontentloaded");
    const note = await rpc<Note>(onboarding, "notes.createNote", "mutation", {
      title: "Markdown E2E",
    });
    const page = await openNote(launch, note.id);
    const editor = page.locator('[contenteditable="true"]');
    await expect(editor).toBeVisible();
    await editor.fill("Unicode नमस्ते 👋 and literal *stars*");
    await editor.press("ControlOrMeta+a");
    await editor.press("ControlOrMeta+b");
    await expect(editor.locator("strong")).toContainText("Unicode");
    // Close while an edit can still be in the debounce interval. The native
    // close event must synchronously persist it through the real preload IPC.
    const noteWindow = await launch.app.browserWindow(page);
    const closed = page.waitForEvent("close");
    await noteWindow.evaluate((window) => window.close());
    await closed;
    const saved = await rpc<Note>(onboarding, "notes.getNoteById", "query", {
      id: note.id,
    });
    expect(saved.contentFormat).toBe("markdown-v1");
    expect(saved.content).toContain("**Unicode");
    expect(saved.content).toContain("\\*stars\\*");

    const reopened = await openNote(launch, note.id);
    await expect(
      reopened.locator('[contenteditable="true"] strong'),
    ).toContainText("Unicode नमस्ते 👋 and literal *stars*");
    const afterOpen = await rpc<Note>(
      onboarding,
      "notes.getNoteById",
      "query",
      { id: note.id },
    );
    expect(afterOpen).toEqual(saved);
    await reopened.getByPlaceholder("Note title...").fill("Renamed note");
    await expect
      .poll(
        async () =>
          (
            await rpc<Note>(onboarding, "notes.getNoteById", "query", {
              id: note.id,
            })
          ).title,
      )
      .toBe("Renamed note");
    const renamed = await rpc<Note>(onboarding, "notes.getNoteById", "query", {
      id: note.id,
    });
    expect(renamed.content).toBe(saved.content);
    const other = await openNote(launch, note.id);
    await expect(other.locator('[contenteditable="true"]')).toBeVisible();
    await reopened
      .locator('[contenteditable="true"]')
      .fill("Newer window edit");
    await expect(other.locator('[contenteditable="true"]')).toHaveText(
      "Newer window edit",
    );
    const lastSave = await other.evaluate(
      (id) => window.electronAPI.notes.saveBody(id, "last window edit"),
      note.id,
    );
    expect(lastSave.status).toBe("saved");
    const latest = await rpc<Note>(onboarding, "notes.getNoteById", "query", {
      id: note.id,
    });
    expect(latest.content).toBe("last window edit");
    await expect(reopened.locator('[contenteditable="true"]')).toHaveText(
      "last window edit",
    );
    // Exercise paragraph preservation using the actual widget and preload.
    const listMarkdown = "- before\n\n  - nested\n\n  after\n";
    await other.evaluate(
      ({ id, markdown }) => window.electronAPI.notes.saveBody(id, markdown),
      { id: note.id, markdown: listMarkdown },
    );
    await expect(reopened.locator('[contenteditable="true"]')).toHaveText(
      "beforenestedafter",
    );
    const paragraph = reopened.locator('[contenteditable="true"] li p').last();
    await paragraph.click();
    await reopened.keyboard.press("End");
    await reopened.keyboard.type(" edited");
    await expect
      .poll(
        async () =>
          (
            await rpc<Note>(onboarding, "notes.getNoteById", "query", {
              id: note.id,
            })
          ).content,
      )
      .toContain("after edited");
    await expect(other.locator('[contenteditable="true"]')).toHaveText(
      "beforenestedafter edited",
    );
    await rpc(onboarding, "notes.deleteNote", "mutation", { id: note.id });
    await expect(other.locator('[contenteditable="false"]')).toBeVisible();
    const lateDelete = await other.evaluate(
      (id) => window.electronAPI.notes.saveBody(id, "late after delete"),
      note.id,
    );
    expect(lateDelete.status).toBe("deleted");
    expect(
      await rpc<Note[]>(onboarding, "notes.getNotes", "query", {}),
    ).toEqual([]);
  } finally {
    await closeAmical(launch);
  }
});
