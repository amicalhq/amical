import * as React from "react";

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
import { SETTINGS_NAV_ITEMS } from "../lib/settings-navigation";
import { api } from "@/trpc/react";

const data = {
  navMain: SETTINGS_NAV_ITEMS.map(({ title, url, icon }) => ({
    title,
    url,
    icon: typeof icon === "string" ? undefined : icon,
  })),
  navSecondary: [],
};

const dragRegion = { WebkitAppRegion: "drag" } as React.CSSProperties;

export function SettingsSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { data: version } = api.settings.getAppVersion.useQuery();

  return (
    <Sidebar
      collapsible="offcanvas"
      className="[&>[data-slot=sidebar-inner]]:bg-background/15 [&>[data-slot=sidebar-inner]]:backdrop-blur-none [&>[data-slot=sidebar-inner]]:backdrop-saturate-100 [&>[data-slot=sidebar-inner]]:shadow-none"
      {...props}
    >
      <div className="h-[var(--header-height)] shrink-0" style={dragRegion} />
      <SidebarHeader className="py-0 -mb-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!h-auto data-[slot=sidebar-menu-button]:!p-2 hover:!bg-transparent active:!bg-transparent"
            >
              <div className="flex w-full flex-col items-start gap-1.5">
                <img
                  src="assets/logo.svg"
                  alt="Vox Logo"
                  className="h-9 w-auto max-w-[9rem] shrink-0 object-contain"
                />
                <span className="inline-flex items-center rounded-full border border-sidebar-border/70 bg-sidebar-accent/40 px-2 py-0.5 text-[10px] font-medium leading-none tracking-wide text-muted-foreground tabular-nums">
                  v{version || "..."}
                </span>
              </div>
            </SidebarMenuButton>
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
