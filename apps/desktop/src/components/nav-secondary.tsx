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
  prefix,
  ...props
}: {
  items: NavSecondaryItem[];
  // Items rendered inside the same SidebarMenu, above `items` — keeps
  // spacing uniform (no 8px gap from a separate SidebarGroup).
  prefix?: React.ReactNode;
  // Omit HTML's `prefix` (RDFa) so our React-node `prefix` wins — the
  // intersection would otherwise narrow it to `string | undefined`.
} & Omit<React.ComponentPropsWithoutRef<typeof SidebarGroup>, "prefix">) {
  const location = useLocation();

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {prefix}
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
