import { clipboard, dialog, shell } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showFatalStartupDialog } from "../../src/main/fatal-startup-dialog";

describe("fatal startup dialog", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(dialog.showMessageBox)
      .mockResolvedValueOnce({ response: 0, checkboxChecked: false })
      .mockResolvedValueOnce({ response: 2, checkboxChecked: false });
    vi.mocked(shell.openExternal).mockRejectedValueOnce(
      new Error("No email application"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles an asynchronous clipboard failure and lets the user quit", async () => {
    vi.mocked(clipboard.writeText).mockRejectedValueOnce(
      new Error("Clipboard unavailable"),
    );

    await expect(
      showFatalStartupDialog(new Error("Startup failed"), "module_load"),
    ).resolves.toBeUndefined();

    expect(clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("Stage: module_load"),
    );
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2);
    expect(dialog.showMessageBox).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: expect.stringContaining("email help@amical.ai"),
        buttons: ["Email Support", "Save Diagnostics…", "Quit"],
      }),
    );
    expect(dialog.showErrorBox).not.toHaveBeenCalled();
  });

  it("waits for the clipboard write before reopening the dialog", async () => {
    const write = Promise.withResolvers<void>();
    vi.mocked(clipboard.writeText).mockReturnValueOnce(write.promise);

    const result = showFatalStartupDialog(
      new Error("Startup failed"),
      "app_initialize",
    );
    try {
      await vi.waitFor(() => {
        expect(clipboard.writeText).toHaveBeenCalledTimes(1);
      });
      expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    } finally {
      write.resolve();
      await result;
    }

    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2);
  });
});
