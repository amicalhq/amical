import { IconGift } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { api, trpcClient } from "@/trpc/react";
import { DESKTOP_REFERRALS_FLAG } from "@/types/remote-config";

const REFREF_API_URL = "https://api.refref.ai";
const REFREF_WIDGET_SCRIPT_URL = "https://assets.refref.ai/widget.v1.js";

const refRefWindow = window as unknown as {
  RefRef?: { push(command: unknown): void };
};

let starting: Promise<void> | null = null;

/**
 * Starts the RefRef Widget: a fresh token, then the script, which runs the
 * commands pushed before it loaded. Rejects when the account gets no token.
 */
async function startWidget(accountId: string, onLoadError: () => void) {
  // The Widget also asks for a new token itself when one expires.
  const getToken = async () => {
    const token = await trpcClient.referrals.getWidgetToken.query({
      accountId,
    });
    if (!token) throw new Error("Referrals are not available");
    return token;
  };
  const token = await getToken();
  refRefWindow.RefRef = [["init", { token, getToken, apiUrl: REFREF_API_URL }]];
  const script = document.createElement("script");
  script.src = REFREF_WIDGET_SCRIPT_URL;
  // Blocked or offline: the next click starts over.
  script.onerror = () => {
    delete refRefWindow.RefRef;
    script.remove();
    onLoadError();
  };
  document.head.appendChild(script);
}

/**
 * Opens the RefRef Widget as a dialog. The first click gets the token and
 * loads the script, so only users who open it load it and get enrolled. The
 * Program's launcher style is `none`.
 */
async function openReferralWidget(accountId: string, onLoadError: () => void) {
  if (!refRefWindow.RefRef) {
    starting ??= startWidget(accountId, onLoadError).finally(() => {
      starting = null;
    });
    await starting;
  }
  refRefWindow.RefRef?.push(["open"]);
}

/**
 * "Refer & earn" in the signed-in account group, shown when the server turns
 * on its flag for this user.
 */
export function ReferralMenuItem({ accountId }: { accountId: string }) {
  const { t } = useTranslation();
  const { mutate: trackEvent } = api.telemetry.trackEvent.useMutation();
  const { data: config } = api.remoteConfig.get.useQuery();

  if (config?.flags[DESKTOP_REFERRALS_FLAG] !== true) return null;

  const showError = () =>
    toast.error(t("settings.sidebar.referral.loadFailed"));

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={() => {
          trackEvent({ event: "referral_widget_opened" });
          openReferralWidget(accountId, showError).catch(showError);
        }}
      >
        <IconGift />
        <span>{t("settings.sidebar.referral.label")}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
