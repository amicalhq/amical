import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

export function DevThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const effectiveTheme = resolvedTheme ?? theme;
  const isDark = effectiveTheme === "dark";

  const toggleTheme = () => {
    setTheme(isDark ? "light" : "dark");
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={toggleTheme}>
        {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
