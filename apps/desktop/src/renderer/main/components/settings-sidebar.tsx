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

export function SettingsSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { data: version } = api.settings.getAppVersion.useQuery();

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
                <span className="ml-2 text-[11px] text-muted-foreground">
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
