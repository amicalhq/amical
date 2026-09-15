import { useEffect, useState } from "react";
import { api } from "@/trpc/react";

export function useDictationStats() {
  // undefined means authentication is not yet known.
  const [accountId, setAccountId] = useState<string | null>();
  const [visible, setVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  const utils = api.useUtils();
  const { mutate: requestRefresh } =
    api.transcriptions.requestStatsRefresh.useMutation({
      networkMode: "always",
    });

  api.auth.onAuthStateChange.useSubscription(undefined, {
    onData: (state) => {
      if (state.eventType === "auth-error") {
        setAccountId(undefined);
        return;
      }
      setAccountId(state.isAuthenticated ? (state.userId ?? undefined) : null);
    },
    onError: () => setAccountId(undefined),
  });

  const stats = api.transcriptions.getLifetimeStats.useQuery(undefined, {
    networkMode: "always",
  });

  api.transcriptions.onStatsChanged.useSubscription(
    { visible },
    {
      onData: async () => {
        // Invalidation alone can reuse a first read that predates this change.
        await utils.transcriptions.getLifetimeStats.cancel();
        await utils.transcriptions.getLifetimeStats.invalidate();
      },
    },
  );

  useEffect(() => {
    if (accountId === undefined) return;
    void utils.transcriptions.getLifetimeStats.invalidate();
    if (accountId) requestRefresh();
  }, [accountId, requestRefresh, utils]);

  useEffect(() => {
    const onVisibilityChange = () => {
      setVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    onVisibilityChange();
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return stats.data?.totalWords;
}
