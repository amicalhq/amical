import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteSyncProvider } from "@/renderer/main/providers/sync-provider";
import type { ElectronAPI } from "@/types/electron-api";
import type { NoteBodyChange } from "@/notes/types";

let markdown: string, deleted: boolean;
let listeners: Set<(change: NoteBodyChange) => void>;
let api: ElectronAPI["notes"];
beforeEach(() => {
  vi.useFakeTimers();
  markdown = "original\n";
  deleted = false;
  listeners = new Set();
  api = {
    loadBody: vi.fn<ElectronAPI["notes"]["loadBody"]>(() => ({
      status: "ready",
      noteId: "11111111-1111-4111-8111-111111111111",
      markdown,
    })),
    saveBody: vi.fn<ElectronAPI["notes"]["saveBody"]>((_id, body) => {
      if (deleted) return { status: "deleted" };
      markdown = body;
      return { status: "saved" };
    }),
    onBodyChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
});
afterEach(() => vi.useRealTimers());

describe("Markdown editor persistence order", () => {
  it("coalesces debounce and flushes synchronously before unmount/reopen", () => {
    const provider = new NoteSyncProvider(
      "11111111-1111-4111-8111-111111111111",
      api,
    );
    provider.queue("older");
    provider.queue("newer");
    expect(api.saveBody).not.toHaveBeenCalled();
    provider.destroy();
    expect(markdown).toBe("newer");
    vi.runAllTimers();
    expect(api.saveBody).toHaveBeenCalledTimes(1);
    const reopened = new NoteSyncProvider(
      "11111111-1111-4111-8111-111111111111",
      api,
    );
    expect(reopened.body.markdown).toBe("newer");
    reopened.destroy();
  });
  it("lets the last local save win across windows", () => {
    const first = new NoteSyncProvider(
        "11111111-1111-4111-8111-111111111111",
        api,
      ),
      second = new NoteSyncProvider(
        "11111111-1111-4111-8111-111111111111",
        api,
      );
    const status = vi.fn();
    first.onStatus = status;
    first.queue("late first window");
    second.queue("second window");
    second.flush();
    vi.runAllTimers();
    expect(markdown).toBe("late first window");
    expect(status).toHaveBeenLastCalledWith(false, null);
    first.destroy();
    second.destroy();
    expect(markdown).toBe("late first window");
  });
  it("refreshes an idle window without an echo save", () => {
    const first = new NoteSyncProvider(
        "11111111-1111-4111-8111-111111111111",
        api,
      ),
      second = new NoteSyncProvider(
        "11111111-1111-4111-8111-111111111111",
        api,
      );
    first.onBody = vi.fn();
    second.queue("remote");
    second.flush();
    listeners.forEach((fn) =>
      fn({ noteId: "11111111-1111-4111-8111-111111111111" }),
    );
    expect(first.body.markdown).toBe("remote");
    expect(first.onBody).toHaveBeenCalledOnce();
    first.destroy();
    second.destroy();
    expect(api.saveBody).toHaveBeenCalledOnce();
  });
  it("never resurrects a deleted note, even on close", () => {
    const provider = new NoteSyncProvider(
      "11111111-1111-4111-8111-111111111111",
      api,
    );
    provider.queue("late");
    deleted = true;
    listeners.forEach((fn) =>
      fn({ noteId: "11111111-1111-4111-8111-111111111111", deleted: true }),
    );
    expect(provider.flush()).toBe(true);
    provider.destroy();
    vi.runAllTimers();
    expect(api.saveBody).not.toHaveBeenCalled();
  });
  it("keeps an unsupported local edit visible when another window saves", () => {
    const provider = new NoteSyncProvider(
      "11111111-1111-4111-8111-111111111111",
      api,
    );
    const status = vi.fn();
    provider.onStatus = status;
    provider.onBody = vi.fn();
    provider.holdUnsupportedEdit();
    markdown = "remote";
    listeners.forEach((fn) =>
      fn({ noteId: "11111111-1111-4111-8111-111111111111" }),
    );
    expect(provider.onBody).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect(provider.flush()).toBe(false);
    provider.destroy();
    expect(api.saveBody).not.toHaveBeenCalled();
  });
  it("allows an idle deleted window to close without a write", () => {
    const provider = new NoteSyncProvider(
      "11111111-1111-4111-8111-111111111111",
      api,
    );
    deleted = true;
    listeners.forEach((fn) =>
      fn({ noteId: "11111111-1111-4111-8111-111111111111", deleted: true }),
    );
    expect(provider.flush()).toBe(true);
    provider.destroy();
    expect(api.saveBody).not.toHaveBeenCalled();
  });

  it("keeps failed writes pending and retries on flush", () => {
    const provider = new NoteSyncProvider(
      "11111111-1111-4111-8111-111111111111",
      api,
    );
    vi.mocked(api.saveBody).mockImplementationOnce(() => {
      throw new Error("disk unavailable");
    });
    provider.queue("draft");
    expect(provider.flush()).toBe(false);
    expect(markdown).toBe("original\n");
    expect(provider.flush()).toBe(true);
    expect(markdown).toBe("draft");
    provider.destroy();
  });

  it("clears a temporary read error after the next successful refresh", () => {
    const provider = new NoteSyncProvider(
      "11111111-1111-4111-8111-111111111111",
      api,
    );
    const status = vi.fn();
    provider.onStatus = status;
    vi.mocked(api.loadBody).mockImplementationOnce(() => {
      throw new Error("temporary read failure");
    });
    listeners.forEach((fn) =>
      fn({ noteId: "11111111-1111-4111-8111-111111111111" }),
    );
    expect(status).toHaveBeenLastCalledWith(false, "error");
    listeners.forEach((fn) =>
      fn({ noteId: "11111111-1111-4111-8111-111111111111" }),
    );
    expect(status).toHaveBeenLastCalledWith(false, null);
    expect(api.saveBody).not.toHaveBeenCalled();
    provider.destroy();
  });
});
