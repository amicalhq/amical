import type { CSSProperties, ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { useSidebar } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { SettingsNavigationControls } from "@/renderer/main/components/settings-navigation-controls";

interface SiteHeaderProps {
  currentView?: string;
  showTitle?: boolean;
  actions?: ReactNode;
}

const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties;
const noDragRegion = { WebkitAppRegion: "no-drag" } as CSSProperties;

export function SiteHeader({
  currentView,
  showTitle = true,
  actions,
}: SiteHeaderProps) {
  const isMacOS = window.electronAPI?.platform === "darwin";
  const isMobile = useIsMobile();
  const { state: sidebarState } = useSidebar();

  return (
    <>
      <div
        className="fixed left-0 top-0 z-50 h-[var(--titlebar-height)] w-full"
        style={dragRegion}
      >
        <SettingsNavigationControls
          className="absolute top-2.5 flex items-center gap-1.5"
          interactiveStyle={noDragRegion}
          showNavigation={!isMobile}
          style={{ ...noDragRegion, left: "var(--toolbar-left)" }}
        />
        {actions ? (
          <div
            className={`absolute top-2.5 flex items-center gap-1 ${isMacOS ? "right-2" : "right-[140px]"}`}
            style={noDragRegion}
          >
            {actions}
          </div>
        ) : null}
      </div>
      <header className="flex h-[var(--header-height)] shrink-0 items-center gap-2 backdrop-blur supports-[backdrop-filter]:bg-background sticky top-0 z-40 w-full">
        <div className="flex w-full items-center gap-1">
          <div
            className={`flex items-center gap-1 py-1.5 transition-[padding] duration-200 ${sidebarState === "expanded" ? "px-4" : "px-0"}`}
          />
          <div
            className={`flex items-center pointer-events-none select-none transition-opacity duration-200 ${showTitle ? "opacity-100" : "opacity-0"}`}
          >
            <Separator orientation="vertical" className="h-4" />
            <h1 className="text-sm font-medium">{currentView || "Amical"}</h1>
          </div>
        </div>
      </header>
    </>
  );
}
