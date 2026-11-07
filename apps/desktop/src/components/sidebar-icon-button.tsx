import * as React from "react";

import { SidebarMenuButton } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/** A compact sidebar footer button. Its label is the tooltip and the aria-label. */
export function SidebarIconButton({
  label,
  className,
  ...props
}: React.ComponentProps<typeof SidebarMenuButton> & { label: string }) {
  return (
    <SidebarMenuButton
      aria-label={label}
      // The menu button hides its tooltip in an expanded sidebar; an icon
      // needs it always.
      tooltip={{ children: label, side: "top", hidden: false }}
      {...props}
      className={cn(
        "size-8 justify-center p-0 text-muted-foreground",
        className,
      )}
    />
  );
}
