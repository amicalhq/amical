import * as React from "react";
import {
  IconDatabase,
  IconFileDescription,
  IconFileWord,
  IconReport,
  IconSettings,
  IconBookFilled,
  IconNotes,
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
    src="assets/discord-icon.svg"
    alt="Discord"
    className={`w-4 h-4 ${className || ""}`}
  />
);

const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  navMain: [
    {
      title: "Notes",
      url: "#",
      icon: IconNotes,
    },
    {
      title: "Transcriptions",
      url: "#",
      icon: IconFileDescription,
    },
    {
      title: "Vocabulary",
      url: "#",
      icon: IconFileWord,
    },
    {
      title: "Speech Models",
      url: "#",
      icon: IconDatabase,
    },
    {
      title: "Settings",
      url: "#",
      icon: IconSettings,
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
  documents: [
    {
      name: "Data Library",
      url: "#",
      icon: IconDatabase,
    },
    {
      name: "Reports",
      url: "#",
      icon: IconReport,
    },
    {
      name: "Word Assistant",
      url: "#",
      icon: IconFileWord,
    },
  ],
};

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  onNavigate?: (item: { title: string }) => void;
  currentView?: string;
}

export function AppSidebar({
  onNavigate,
  currentView,
  ...props
}: AppSidebarProps) {
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
              <a
                href="#"
                className="inline-flex items-center gap-2.5 font-semibold"
              >
                <img
                  src="assets/logo.svg"
                  alt="Amical Logo"
                  className="!size-7"
                />
                <span className="font-semibold">Amical</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          items={data.navMain}
          onNavigate={onNavigate}
          currentView={currentView}
        />
        <NavSecondary
          items={data.navSecondary}
          onNavigate={onNavigate}
          currentView={currentView}
          className="mt-auto"
        />
      </SidebarContent>
      <SidebarFooter>{/* <NavUser user={data.user} /> */}</SidebarFooter>
    </Sidebar>
  );
}
