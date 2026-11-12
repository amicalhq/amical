import * as React from "react";
import { IconMessageCircle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { SidebarIconButton } from "@/components/sidebar-icon-button";
import { captureRendererException } from "@/renderer/lib/posthog";
import { api } from "@/trpc/react";

type Gleap = typeof import("gleap").default;

let gleapLoad: Promise<Gleap | null> | null = null;

/**
 * Loads and starts Gleap once per window. Importing the SDK installs browser
 * hooks, so it loads only for signed-in users. It is set up for chat only: no
 * page tracking, console or network logs, an empty replay, and no Gleap
 * launcher. A failed load gives null and is reported; the chat is optional.
 */
function loadGleap(apiKey: string, appVersion: string, language: string) {
  gleapLoad ??= import("gleap")
    .then(
      ({ default: Gleap }) =>
        new Promise<Gleap>((resolve) => {
          Gleap.setDisablePageTracking(true);
          Gleap.disableConsoleLogOverwrite();
          Gleap.setMaxNetworkRequests(0);
          // The recorder always runs; record no content and no input events.
          Gleap.setReplayOptions({
            blockSelector: "body",
            sampling: { mousemove: false, mouseInteraction: false, scroll: 0 },
          });
          Gleap.showFeedbackButton(false);
          Gleap.hideAiChatbar();
          // Set once, before initialize: a later change reloads the widget.
          Gleap.setLanguage(language);
          Gleap.setAppVersionCode(appVersion);
          Gleap.on("initialized", () => resolve(Gleap));
          Gleap.initialize(apiKey);
        }),
    )
    .catch((error) => {
      gleapLoad = null;
      captureRendererException(error, { component: "support_chat" });
      return null;
    });
  return gleapLoad;
}

export function SupportChatButton() {
  const { t, i18n } = useTranslation();
  const { data: auth } = api.auth.getAuthStatus.useQuery();
  const userId = auth?.isAuthenticated ? auth.userId : null;
  const { data: config } = api.settings.getSupportChatConfig.useQuery(
    undefined,
    { enabled: !!userId, staleTime: Infinity },
  );
  const [gleap, setGleap] = React.useState<Gleap | null>(null);

  React.useEffect(() => {
    if (!userId || !config?.apiKey) return;
    void loadGleap(config.apiKey, config.appVersion, i18n.language).then(
      // Gleap is a class, so pass it through an updater function.
      (loaded) => loaded && setGleap(() => loaded),
    );
    // The language is read once, at load.
  }, [userId, config?.apiKey, config?.appVersion]);

  // Conversations then belong to the same contact as on the web and mobile
  // apps. Empty fields are left out, so an unchanged contact is not re-sent.
  React.useEffect(() => {
    if (!gleap || !userId) return;
    gleap.identify(userId, {
      ...(auth?.userEmail && { email: auth.userEmail }),
      ...(auth?.userName && { name: auth.userName }),
    });
  }, [gleap, userId, auth?.userEmail, auth?.userName]);

  if (!gleap || !userId) return null;

  return (
    <SidebarIconButton
      label={t("settings.sidebar.supportChat")}
      onClick={() => gleap.open()}
    >
      <IconMessageCircle />
    </SidebarIconButton>
  );
}
