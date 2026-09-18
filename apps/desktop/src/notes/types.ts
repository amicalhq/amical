// An already-open editor can finish its pending save after logout or adoption.
export interface NoteSaveOrigin {
  accountId: string | null;
  title: string;
  icon: string | null;
  createdAtMs: number;
  markdown: string;
}

export type NoteBody =
  | {
      status: "ready";
      noteId: string;
      markdown: string;
      remoteVersion?: number | null;
      origin?: NoteSaveOrigin;
    }
  | {
      status: "blocked";
      noteId: string;
      reason: string;
    }
  | { status: "deleted"; noteId: string };

export type NoteSaveResult =
  | { status: "saved"; recovered?: boolean; remoteVersion?: number | null }
  | { status: "deleted" }
  | { status: "error"; message: string };

export interface NoteBodyChange {
  noteId?: string;
  deleted?: boolean;
}
