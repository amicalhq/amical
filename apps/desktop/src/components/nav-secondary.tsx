import * as React from "react";
import { useLocation } from "@tanstack/react-router";

import {
  NavSecondaryItemButton,
  type NavSecondaryItem,
} from "@/components/nav-secondary-item-button";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { AuthButton } from "@/components/auth-button";
import { FeedbackButton } from "@/components/feedback-button";
import { DevThemeToggle } from "@/components/dev-theme-toggle";
import { DevFeatureFlagsRefresh } from "@/components/dev-feature-flags-refresh";
import { isInternalUrl } from "@/utils/url";
export type { NavSecondaryItem } from "@/components/nav-secondary-item-button";

export function NavSecondary({
  items,
  ...props
}: {
  items: NavSecondaryItem[];
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const location = useLocation();

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            return (
              <SidebarMenuItem key={item.id}>
                <NavSecondaryItemButton
                  item={item}
                  isActive={
                    isInternalUrl(item.url) &&
                    location.pathname.startsWith(item.url)
                  }
                />
              </SidebarMenuItem>
            );
          })}
          {process.env.NODE_ENV === "development" && (
            <>
              <DevThemeToggle />
              <DevFeatureFlagsRefresh />
            </>
          )}
          <FeedbackButton />
          <AuthButton />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
