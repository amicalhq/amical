import * as React from "react";
import { IconBookFilled } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { CommandSearchButton } from "./command-search-button";
import { CreateNoteButton } from "./create-note-button";
import { SETTINGS_NAV_ITEMS } from "../lib/settings-navigation";

export function SettingsSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation();

  const DiscordIcon = () => (
    <img
      src="assets/discord-icon.svg"
      alt={t("settings.sidebar.discordAlt")}
      className="w-4 h-4"
    />
  );

  const navMain = SETTINGS_NAV_ITEMS.map(({ titleKey, url, icon }) => ({
    title: t(titleKey),
    url,
    icon: typeof icon === "string" ? undefined : icon,
  }));

  const navSecondary = [
    {
      title: t("settings.sidebar.docs"),
      url: "https://amical.ai/docs",
      icon: IconBookFilled,
      external: true,
    },
    {
      title: t("settings.sidebar.community"),
      url: "https://amical.ai/community",
      icon: DiscordIcon,
      external: true,
    },
  ];

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <div className="h-[var(--header-height)]"></div>
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
