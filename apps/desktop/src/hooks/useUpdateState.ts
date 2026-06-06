import { useState } from "react";
import { api } from "@/trpc/react";
import type { UpdateState } from "@/main/services/auto-updater";

// Subscribes to the auto-updater's state stream and returns the latest state.
export function useUpdateState(): UpdateState {
  const [updateState, setUpdateState] = useState<UpdateState>("not-available");

  api.updater.onUpdateStateChange.useSubscription(undefined, {
    onData: ({ state }) => setUpdateState(state),
    onError: (error) =>
      console.error("Update state subscription error:", error),
  });

  return updateState;
}
