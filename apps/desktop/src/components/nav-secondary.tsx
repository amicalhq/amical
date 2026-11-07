import * as React from "react";
import { useLocation } from "@tanstack/react-router";

import {
  NavSecondaryItemButton,
  type NavSecondaryItem,
} from "@/components/nav-secondary-item-button";
import { DevMenu } from "@/components/dev-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { AuthButton } from "@/components/auth-button";
import { FeedbackButton } from "@/components/feedback-button";
import { MobileAppButton } from "@/components/mobile-app-dialog";
import { SidebarIconButton } from "@/components/sidebar-icon-button";
import { isInternalUrl } from "@/utils/url";
export type { NavSecondaryItem } from "@/components/nav-secondary-item-button";

export function NavSecondary({
  cta,
  items,
  prefix,
  beforeAuth,
  ...props
}: {
  cta?: NavSecondaryItem | null;
  // External help links, shown as one row of icons.
  items: NavSecondaryItem[];
  // Items rendered inside the same SidebarMenu, above `items` — keeps
  // spacing uniform (no 8px gap from a separate SidebarGroup).
  prefix?: React.ReactNode;
  beforeAuth?: React.ReactNode;
  // Omit HTML's `prefix` (RDFa) so our React-node `prefix` wins — the
  // intersection would otherwise narrow it to `string | undefined`.
} & Omit<React.ComponentPropsWithoutRef<typeof SidebarGroup>, "prefix">) {
  const location = useLocation();

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {prefix}
          {cta ? (
            <SidebarMenuItem>
              <NavSecondaryItemButton
                item={cta}
                isActive={
                  isInternalUrl(cta.url) &&
                  location.pathname.startsWith(cta.url)
                }
              />
            </SidebarMenuItem>
          ) : null}
          {/* Help links are used rarely, so they share one row of icons. */}
          <SidebarMenuItem className="flex items-center gap-1">
            {items.map((item) => (
              <SidebarIconButton
                key={item.id}
                label={item.title}
                onClick={() => window.electronAPI.openExternal(item.url)}
              >
                <item.icon />
              </SidebarIconButton>
            ))}
            <MobileAppButton />
            <FeedbackButton />
            {process.env.NODE_ENV === "development" && <DevMenu />}
          </SidebarMenuItem>
          {beforeAuth}
          <AuthButton />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
