import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

export function DevThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const toggleTheme = () => {
    const currentTheme = resolvedTheme || theme;
    setTheme(currentTheme === "dark" ? "light" : "dark");
  };

  const isDark = resolvedTheme === "dark";

  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={toggleTheme}>
        {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
