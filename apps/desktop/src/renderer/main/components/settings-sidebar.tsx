import * as React from "react";
import {
  IconSettings,
  IconMicrophone,
  IconBook,
  IconBrain,
  IconHistory,
  IconInfoCircle,
  IconBookFilled,
  IconKeyboard,
  IconAdjustments,
} from "@tabler/icons-react";

import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

// Custom Discord icon component
const DiscordIcon = ({ className }: { className?: string }) => (
  <img
    src="/assets/discord-icon.svg"
    alt="Discord"
    className={`w-4 h-4 ${className || ""}`}
  />
);

const data = {
  navMain: [
    {
      title: "Preferences",
      url: "/settings/preferences",
      icon: IconSettings,
    },
    {
      title: "Dictation",
      url: "/settings/dictation",
      icon: IconMicrophone,
    },
    {
      title: "Shortcuts",
      url: "/settings/shortcuts",
      icon: IconKeyboard,
    },
    {
      title: "Vocabulary",
      url: "/settings/vocabulary",
      icon: IconBook,
    },
    {
      title: "AI Models",
      url: "/settings/ai-models",
      icon: IconBrain,
    },
    {
      title: "History",
      url: "/settings/history",
      icon: IconHistory,
    },
    {
      title: "Advanced",
      url: "/settings/advanced",
      icon: IconAdjustments,
    },
    {
      title: "About",
      url: "/settings/about",
      icon: IconInfoCircle,
    },
  ],
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
                  src="/assets/logo.svg"
                  alt="Amical Logo"
                  className="!size-7"
                />
                <span className="font-semibold">Amical</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter></SidebarFooter>
    </Sidebar>
  );
}
