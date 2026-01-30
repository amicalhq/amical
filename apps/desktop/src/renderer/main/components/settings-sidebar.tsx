import * as React from "react";
import { IconBookFilled } from "@tabler/icons-react";

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
import { SETTINGS_NAV_ITEMS } from "../lib/settings-navigation";

// Custom Discord icon component
const DiscordIcon = ({ className }: { className?: string }) => (
  <img
    src="assets/discord-icon.svg"
    alt="Discord"
    className={`w-4 h-4 ${className || ""}`}
  />
);

const data = {
  navMain: SETTINGS_NAV_ITEMS.map(({ title, url, icon }) => ({
    title,
    url,
    icon: typeof icon === "string" ? undefined : icon,
  })),
  navSecondary: [
    {
      title: "Docs",
      url: "https://amical.ai/docs",
      icon: IconBookFilled,
      external: true,
    },
    {
      title: "Community",
      url: "https://amical.ai/community",
      icon: DiscordIcon,
      external: true,
    },
  ],
};

export function SettingsSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
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
                  alt="Vox Logo"
                  className="!size-7"
                />
                <span className="font-semibold">Vox</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <CommandSearchButton />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
}
