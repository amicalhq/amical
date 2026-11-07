import type { ElectronAPI } from "@/types/electron-api";
import type { NoteBody } from "@/notes/types";

export type NoteSaveIssue = "deleted" | "error" | "recovered" | null;

// Local Markdown persistence. The last save received by SQLite wins.
export class NoteSyncProvider {
  body: Extract<NoteBody, { status: "ready" }>;
  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: () => void;
  private issue: NoteSaveIssue = null;
  private blockedFormatting = false;
  onBody: (() => void) | undefined;
  onStatus: ((pending: boolean, issue: NoteSaveIssue) => void) | undefined;

  constructor(
    private noteId: string,
    private api: ElectronAPI["notes"] = window.electronAPI.notes,
  ) {
    const body = api.loadBody(noteId);
    if (body.status !== "ready") throw new Error("Note is not editable");
    this.body = body;
    this.unsubscribe = api.onBodyChange((change) => {
      if (change.noteId !== undefined && change.noteId !== noteId) return;
      if (change.deleted) {
        this.markDeleted();
        return;
      }
      try {
        const latest = api.loadBody(noteId);
        if (latest.status === "deleted") {
          if (this.pending !== null && this.body.origin && !this.flush())
            return;
          this.markDeleted();
        } else if (latest.status === "ready") {
          // Pending editors retain their cloud base until their own save.
          if (this.pending !== null || this.blockedFormatting) return;
          const changed = latest.markdown !== this.body.markdown;
          this.body = latest;
          this.issue = null;
          this.notify();
          if (changed) {
            this.onBody?.();
          }
        }
      } catch {
        this.issue = "error";
        this.notify();
      }
    });
  }

  queue(markdown: string) {
    if (this.issue === "deleted" || this.issue === "recovered") return;
    this.blockedFormatting = false;
    this.pending = markdown;
    this.issue = null;
    this.cancelTimer();
    this.timer = setTimeout(() => this.flush(), 250);
    this.notify();
  }

  holdUnsupportedEdit() {
    this.blockedFormatting = true;
    this.cancelTimer();
  }

  flush(): boolean {
    this.cancelTimer();
    if (this.blockedFormatting) return false;
    if (this.pending === null) return true;
    try {
      const result =
        this.body.remoteVersion === undefined
          ? this.api.saveBody(this.noteId, this.pending)
          : this.api.saveBody(
              this.noteId,
              this.pending,
              this.body.remoteVersion,
              this.body.origin,
            );
      if (result.status === "saved") {
        this.body = {
          ...this.body,
          markdown: this.pending,
          ...(result.remoteVersion !== undefined
            ? { remoteVersion: result.remoteVersion }
            : {}),
          ...(this.body.origin
            ? { origin: { ...this.body.origin, markdown: this.pending } }
            : {}),
        };
        this.pending = null;
        this.issue = result.recovered ? "recovered" : null;
      } else if (result.status === "deleted") this.markDeleted();
      else this.issue = "error";
    } catch {
      this.issue = "error";
    }
    this.notify();
    return this.pending === null;
  }

  private markDeleted() {
    this.pending = null;
    this.blockedFormatting = false;
    if (this.issue !== "recovered") this.issue = "deleted";
    this.cancelTimer();
    this.notify();
  }
  private notify() {
    this.onStatus?.(
      this.pending !== null || this.blockedFormatting,
      this.issue,
    );
  }
  private cancelTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  destroy() {
    this.flush();
    this.unsubscribe();
    this.cancelTimer();
  }
}
