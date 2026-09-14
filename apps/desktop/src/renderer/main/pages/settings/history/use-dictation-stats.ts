import { useEffect, useState } from "react";
import { api } from "@/trpc/react";

export function useDictationStats() {
  // undefined means authentication is not yet known.
  const [accountId, setAccountId] = useState<string | null>();
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

  const stats = api.transcriptions.getLifetimeStats.useQuery(
    { accountId: accountId ?? null },
    {
      enabled: accountId !== undefined,
      gcTime: 0,
      networkMode: "always",
    },
  );

  api.transcriptions.onStatsChanged.useSubscription(undefined, {
    onData: async () => {
      // Invalidation alone can reuse a first read that predates this change.
      await utils.transcriptions.getLifetimeStats.cancel();
      await utils.transcriptions.getLifetimeStats.invalidate();
    },
  });

  useEffect(() => {
    if (!accountId) return;
    requestRefresh({ accountId });

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          if (document.visibilityState !== "hidden") {
            requestRefresh({ accountId });
          }
          schedule();
        },
        (301 + Math.floor(Math.random() * 60)) * 1000,
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [accountId, requestRefresh]);

  return accountId === undefined ? undefined : stats.data?.totalWords;
}
