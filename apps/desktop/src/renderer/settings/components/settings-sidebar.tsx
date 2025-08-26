import * as React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  IconSettings,
  IconUser,
  IconShield,
  IconBell,
  IconPalette,
  IconKeyboard,
  IconArrowLeft,
} from "@tabler/icons-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const settingsNavData = [
  {
    title: "Back to Main",
    route: "/transcriptions",
    icon: IconArrowLeft,
    isBackButton: true,
  },
  {
    title: "Preferences",
    route: "/settings/",
    icon: IconSettings,
  },
  {
    title: "Dictation",
    route: "/settings/dictation",
    icon: IconPalette,
  },
  {
    title: "Vocabulary",
    route: "/settings/vocabulary",
    icon: IconKeyboard,
  },
  {
    title: "AI Models",
    route: "/settings/ai-models",
    icon: IconShield,
  },
  {
    title: "History",
    route: "/settings/history",
    icon: IconBell,
  },
  {
    title: "About",
    route: "/settings/about",
    icon: IconUser,
  },
];

interface SettingsSidebarProps extends React.ComponentProps<typeof Sidebar> {
  onBackToMain?: () => void;
}

export function SettingsSidebar({
  onBackToMain,
  ...props
}: SettingsSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleNavigation = (item: (typeof settingsNavData)[0]) => {
    if (item.isBackButton && onBackToMain) {
      onBackToMain();
    } else {
      navigate(item.route);
    }
  };

  const isActive = (route: string): boolean => {
    return location.pathname === route;
  };

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <div className="h-[var(--header-height)]"></div>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarMenu>
              {settingsNavData.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={isActive(item.route)}
                    onClick={() => handleNavigation(item)}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
