import { app, clipboard, dialog, shell } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SUPPORT_EMAIL = "help@amical.ai";

export type StartupFailureStage = "module_load" | "app_initialize";

function formatError(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

function getLogPath(): string {
  const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
  return isDev
    ? path.join(app.getPath("userData"), "logs", "amical-dev.log")
    : path.join(app.getPath("logs"), "amical.log");
}

function buildDiagnostics(
  error: unknown,
  stage: StartupFailureStage,
  occurredAt: Date,
  logPath: string,
): string {
  return [
    "Amical startup failure",
    `Time: ${occurredAt.toISOString()}`,
    `Version: ${app.getVersion()}`,
    `Platform: ${process.platform} ${process.arch}`,
    `Stage: ${stage}`,
    `Log: ${logPath}`,
    "",
    "Error:",
    formatError(error),
  ].join("\n");
}

function buildSupportUrl(
  error: unknown,
  stage: StartupFailureStage,
  occurredAt: Date,
): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const query = new URLSearchParams({
    subject: `Amical startup failure (${app.getVersion()})`,
    body: [
      "Hi Amical support,",
      "",
      "Amical failed to start.",
      `Time: ${occurredAt.toISOString()}`,
      `Version: ${app.getVersion()}`,
      `Platform: ${process.platform} ${process.arch}`,
      `Stage: ${stage}`,
      `Error: ${errorMessage}`,
      "",
      "Please describe what happened before the failure:",
    ].join("\n"),
  });
  return `mailto:${SUPPORT_EMAIL}?${query.toString()}`;
}

export async function showFatalStartupDialog(
  error: unknown,
  stage: StartupFailureStage,
): Promise<void> {
  const occurredAt = new Date();
  const logPath = getLogPath();
  const diagnostics = buildDiagnostics(error, stage, occurredAt, logPath);
  let status = "";

  try {
    // showMessageBox provides action buttons but requires a ready app. The
    // module-load catch can reach this helper before Electron is ready.
    await app.whenReady();

    while (true) {
      const { response } = await dialog.showMessageBox({
        type: "error",
        title: "Amical failed to start",
        message: "Amical couldn’t start",
        detail: [
          "A required component failed during startup. Amical must close.",
          status,
          diagnostics,
        ]
          .filter(Boolean)
          .join("\n\n"),
        buttons: ["Email Support", "Save Diagnostics…", "Quit"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });

      if (response === 0) {
        try {
          await shell.openExternal(buildSupportUrl(error, stage, occurredAt));
          return;
        } catch (supportError) {
          console.error("Failed to open support email", supportError);
          try {
            clipboard.writeText(diagnostics);
          } catch {
            // The address remains visible in the status message below.
          }
          status = `Couldn’t open your email app. Diagnostics were copied when possible; email ${SUPPORT_EMAIL}.`;
        }
        continue;
      }

      if (response === 1) {
        const filename = `amical-startup-diagnostics-${occurredAt
          .toISOString()
          .replace(/[:.]/g, "-")}.txt`;
        const { canceled, filePath } = await dialog.showSaveDialog({
          defaultPath: path.join(app.getPath("downloads"), filename),
          filters: [{ name: "Text Files", extensions: ["txt", "log"] }],
        });
        if (canceled || !filePath) {
          continue;
        }

        try {
          const logContents = await readFile(logPath, "utf8").catch(
            (logError: unknown) =>
              `Log unavailable: ${
                logError instanceof Error ? logError.message : String(logError)
              }`,
          );
          await writeFile(
            filePath,
            `${diagnostics}\n\nApplication log:\n${logContents}`,
            "utf8",
          );
          status = `Diagnostics saved to ${filePath}.`;
        } catch (saveError) {
          console.error("Failed to save startup diagnostics", saveError);
          status = "Couldn’t save the diagnostics file. Please try again.";
        }
        continue;
      }

      return;
    }
  } catch (dialogError) {
    // showErrorBox is explicitly safe before app.ready, so preserve it as the
    // final fallback if the richer native dialog cannot be displayed.
    console.error("Failed to show startup failure dialog", dialogError);
    dialog.showErrorBox("Amical failed to start", formatError(error));
  }
}
