import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { api } from "@/trpc/react";

import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

export function DevThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const updateUIThemeMutation = api.settings.updateUITheme.useMutation();

  const effectiveTheme = resolvedTheme ?? theme;
  const isDark = effectiveTheme === "dark";

  const toggleTheme = () => {
    const nextTheme: "light" | "dark" = isDark ? "light" : "dark";
    setTheme(nextTheme);
    updateUIThemeMutation.mutate({ theme: nextTheme });
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
