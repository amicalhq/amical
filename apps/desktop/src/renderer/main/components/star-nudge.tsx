import * as React from "react";
import { useTranslation } from "react-i18next";

import { useSidebar } from "@/components/ui/sidebar";
import { useDocumentVisible } from "@/renderer/main/hooks/use-document-visible";
import { GITHUB_REPO_URL } from "@/constants/github";
import { api } from "@/trpc/react";
import {
  DESKTOP_STAR_NUDGE_FLAG,
  type RemoteConfigSideSlotSurface,
} from "@/types/remote-config";
import { isSurfaceDismissed } from "@/utils/remote-config";
import { RemoteConfigSideSlot, useDismissals } from "./remote-config-surfaces";

const STAR_NUDGE_ID = "star-nudge";
const MIN_DICTATIONS = 20;
// Amical cannot see a star, so the first click or dismiss ends the ask.
const RESHOW_AFTER_DAYS = 36_500;

// A one-time ask for a GitHub star, for signed-out users with real use.
export function StarNudge() {
  const { t, i18n } = useTranslation();
  const { dismissedUntil, dismiss } = useDismissals();
  const { state: sidebarState } = useSidebar();
  const documentVisible = useDocumentVisible();
  const { mutate: trackEvent } = api.telemetry.trackEvent.useMutation();
  const { data: config } = api.remoteConfig.get.useQuery();
  const finished = isSurfaceDismissed(STAR_NUDGE_ID, dismissedUntil);
  // Read on each show, not on each dictation: the card waits for a show anyway.
  const readOnShow = {
    enabled: documentVisible && !finished,
    networkMode: "always",
  } as const;
  const { data: auth } = api.auth.getAuthStatus.useQuery(undefined, readOnShow);
  const { data: stats } = api.transcriptions.getLifetimeStats.useQuery(
    undefined,
    readOnShow,
  );

  const eligible =
    auth?.isAuthenticated === false &&
    config?.flags[DESKTOP_STAR_NUDGE_FLAG] === true &&
    !finished &&
    stats != null &&
    stats.totalTranscriptions >= MIN_DICTATIONS;

  // A collapsed sidebar or a hidden window keeps the card mounted but unseen.
  const seen = eligible && documentVisible && sidebarState === "expanded";
  const shownTracked = React.useRef(false);
  React.useEffect(() => {
    if (!seen || shownTracked.current) return;
    shownTracked.current = true;
    trackEvent({ event: "star_nudge", payload: { outcome: "shown" } });
  }, [seen, trackEvent]);

  if (!eligible) return null;

  const finish = (outcome: "clicked" | "dismissed") => {
    dismiss(STAR_NUDGE_ID, RESHOW_AFTER_DAYS);
    trackEvent({ event: "star_nudge", payload: { outcome } });
  };

  const surface: RemoteConfigSideSlotSurface = {
    id: STAR_NUDGE_ID,
    kind: "side_slot",
    dismissible: true,
    content: {
      icon: "star",
      title: t("settings.sidebar.starNudge.title", {
        words: new Intl.NumberFormat(i18n.language).format(stats.totalWords),
      }),
      body: t("settings.sidebar.starNudge.body"),
    },
    cta: {
      action: "open_external_url",
      label: t("settings.sidebar.starNudge.cta"),
      url: GITHUB_REPO_URL,
    },
  };

  return (
    <RemoteConfigSideSlot
      surface={surface}
      onDismiss={() => finish("dismissed")}
      onCta={() => {
        finish("clicked");
        void window.electronAPI.openExternal(GITHUB_REPO_URL);
      }}
    />
  );
}
