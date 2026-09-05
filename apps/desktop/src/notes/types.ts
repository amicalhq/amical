export type NoteBody =
  | { status: "ready"; noteId: number; markdown: string }
  | {
      status: "blocked";
      noteId: number;
      reason: string;
    }
  | { status: "deleted"; noteId: number };

export type NoteSaveResult =
  | { status: "saved" }
  | { status: "deleted" }
  | { status: "error"; message: string };

export interface NoteBodyChange {
  noteId: number;
  deleted?: boolean;
}
