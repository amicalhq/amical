import { useState } from "react";
import { api } from "@/trpc/react";
import type { UpdateRequirement } from "@/types/remote-config";

export function useUpdateRequirement() {
  const [state, setState] = useState<{
    requirement: UpdateRequirement | null;
    recordingActive: boolean;
  } | null>(null);
  api.updater.updateRequirement.useSubscription(undefined, {
    onData: setState,
  });
  return state;
}
