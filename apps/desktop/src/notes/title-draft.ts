export interface NoteTitleDraft {
  id: string;
  title: string;
  remoteVersion: number | null;
  originalTitle: string;
}

// Carry a completed local save's base into any newer title draft.
export function settleTitleSave(
  pending: NoteTitleDraft | null,
  input: Pick<NoteTitleDraft, "id" | "title">,
  saved: Pick<NoteTitleDraft, "title" | "remoteVersion"> | null,
): NoteTitleDraft | null {
  if (!pending || pending.id !== input.id) return pending;
  if (!saved || pending.title === input.title) return null;
  return {
    ...pending,
    remoteVersion: saved.remoteVersion,
    originalTitle: saved.title,
  };
}
