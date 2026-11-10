import type { ComponentProps } from "react";
import { IconDeviceMobile } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SidebarIconButton } from "@/components/sidebar-icon-button";
import { api } from "@/trpc/react";

/** Shows the QR code for the mobile apps. The QR code encodes amical.ai/mobile. */
export function MobileAppDialogContent(
  props: ComponentProps<typeof DialogContent>,
) {
  const { t } = useTranslation();

  return (
    <DialogContent className="sm:max-w-sm" {...props}>
      <DialogHeader className="sm:text-center">
        <DialogTitle>{t("settings.sidebar.mobileApp.title")}</DialogTitle>
        <DialogDescription>
          {t("settings.sidebar.mobileApp.description")}
        </DialogDescription>
      </DialogHeader>
      <img
        src="assets/mobile-app-qr.svg"
        alt={t("settings.sidebar.mobileApp.qrAlt")}
        className="mx-auto size-48 rounded-lg"
      />
    </DialogContent>
  );
}

export function MobileAppButton() {
  const { t } = useTranslation();
  const { mutate: trackEvent } = api.telemetry.trackEvent.useMutation();

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) return;
        trackEvent({
          event: "mobile_app_qr_opened",
          payload: { source: "sidebar_footer" },
        });
      }}
    >
      <DialogTrigger asChild>
        <SidebarIconButton label={t("settings.sidebar.mobileApp.label")}>
          <IconDeviceMobile />
        </SidebarIconButton>
      </DialogTrigger>
      <MobileAppDialogContent />
    </Dialog>
  );
}
