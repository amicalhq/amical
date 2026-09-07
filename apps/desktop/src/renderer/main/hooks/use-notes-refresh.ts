import { useEffect } from "react";
import { api } from "@/trpc/react";

export function useNotesRefresh() {
  const utils = api.useUtils();
  useEffect(
    () =>
      window.electronAPI.notes.onBodyChange(() => {
        void utils.notes.invalidate();
      }),
    [utils],
  );
}
