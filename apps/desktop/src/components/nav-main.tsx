import { type Icon } from "@tabler/icons-react";
import { Link, useLocation } from "@tanstack/react-router";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export function NavMain({
  items,
}: {
  items: {
    title: string;
    url: string;
    icon?: Icon;
  }[];
}) {
  const location = useLocation();
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton
                asChild
                tooltip={item.title}
                isActive={location.pathname.startsWith(item.url)}
                className="hover:bg-foreground/6 data-[active=true]:bg-foreground/14 data-[active=true]:text-foreground data-[active=true]:font-semibold"
              >
                <Link
                  to={item.url}
                  aria-label={item.title}
                  activeProps={{
                    className: "active",
                  }}
                >
                  {item.icon && <item.icon />} <span>{item.title}</span>{" "}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
