export type NoteBody =
  | { status: "ready"; noteId: string; markdown: string }
  | {
      status: "blocked";
      noteId: string;
      reason: string;
    }
  | { status: "deleted"; noteId: string };

export type NoteSaveResult =
  | { status: "saved" }
  | { status: "deleted" }
  | { status: "error"; message: string };

export interface NoteBodyChange {
  noteId: string;
  deleted?: boolean;
}
