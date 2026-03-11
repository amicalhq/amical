import * as React from "react";
import {
  IconBookFilled,
  IconBrandDiscordFilled,
  IconInfoCircle,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { NavMain } from "@/components/nav-main";
import {
  NavSecondary,
  type NavSecondaryItem,
} from "@/components/nav-secondary";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import {
  parseSidebarCtaPayload,
  SIDEBAR_CTA_FEATURE_FLAG,
} from "@/utils/feature-flags";
import { CommandSearchButton } from "./command-search-button";
import { CreateNoteButton } from "./create-note-button";
import { SETTINGS_NAV_ITEMS } from "../lib/settings-navigation";

export function SettingsSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation();
  const sidebarCtaFlag = useFeatureFlag(SIDEBAR_CTA_FEATURE_FLAG);

  const sidebarCtaPayload = sidebarCtaFlag.enabled
    ? parseSidebarCtaPayload(sidebarCtaFlag.payload)
    : null;

  const navMain = SETTINGS_NAV_ITEMS.map(({ titleKey, url, icon }) => ({
    title: t(titleKey),
    url,
    icon: typeof icon === "string" ? undefined : icon,
  }));

  const baseNavSecondary: NavSecondaryItem[] = [
    {
      id: "docs",
      title: t("settings.sidebar.docs"),
      url: "https://amical.ai/docs",
      icon: IconBookFilled,
    },
    {
      id: "community",
      title: t("settings.sidebar.community"),
      url: "https://amical.ai/community",
      icon: IconBrandDiscordFilled,
    },
  ];

  const navSecondaryCta: NavSecondaryItem | null = sidebarCtaPayload
    ? {
        id: "sidebar-cta",
        title: sidebarCtaPayload.text,
        url: sidebarCtaPayload.url,
        icon: IconInfoCircle,
        ctaStyle: {
          palette: sidebarCtaPayload.palette,
          style: sidebarCtaPayload.style,
          emoji: sidebarCtaPayload.emoji,
        },
      }
    : null;

  const navSecondary: NavSecondaryItem[] = navSecondaryCta
    ? [navSecondaryCta, ...baseNavSecondary]
    : baseNavSecondary;

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <div
        className="h-[var(--titlebar-height)] shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />
      <SidebarHeader className="py-0 -mb-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <div className="inline-flex items-center gap-2.5 font-semibold w-full">
                <img
                  src="assets/logo.svg"
                  alt={t("settings.sidebar.logoAlt")}
                  className="!size-7"
                />
                <span className="font-semibold">
                  {t("settings.sidebar.brand")}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <CreateNoteButton />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <CommandSearchButton />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
}
