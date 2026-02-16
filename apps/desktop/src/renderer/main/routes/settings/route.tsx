import { useEffect, useRef, useState } from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SettingsSidebar } from "../../components/settings-sidebar";
import { SiteHeader } from "@/components/site-header";
import { useLocation } from "@tanstack/react-router";
import {
  SettingsHeaderProvider,
  useSettingsHeaderActions,
} from "./header-actions-context";

export const Route = createFileRoute("/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <SettingsHeaderProvider>
      <SettingsLayoutContent />
    </SettingsHeaderProvider>
  );
}

function SettingsLayoutContent() {
  const location = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const { actions: headerActions } = useSettingsHeaderActions();

  // Reset scroll state on page change
  useEffect(() => {
    setIsScrolled(false);
  }, [location.pathname]);

  // IntersectionObserver to detect title scrolling out of view
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsScrolled(!entry.isIntersecting),
      { root, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [location.pathname]);

  const getSettingsPageTitle = (pathname: string): string => {
    // Check for dynamic routes first
    if (pathname.startsWith("/settings/notes")) {
      return "Notes";
    }

    const routes: Record<string, string> = {
      "/settings/preferences": "Preferences",
      "/settings/dictation": "Dictation",
      "/settings/vocabulary": "Vocabulary",
      "/settings/shortcuts": "Shortcuts",
      "/settings/ai-models": "AI Models",
      "/settings/history": "History",
      "/settings/advanced": "Advanced",
      "/settings/about": "About",
    };
    return routes[pathname] || "Settings";
  };

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 52)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <div className="flex h-screen w-screen">
        <SettingsSidebar variant="inset" />
        <SidebarInset className="!mt-0">
          <SiteHeader
            currentView={`${getSettingsPageTitle(location.pathname)}`}
            showTitle={isScrolled}
            actions={headerActions ?? undefined}
          />
          <div className="flex flex-1 flex-col min-h-0">
            <div className="@container/settings flex flex-1 flex-col min-h-0 overflow-hidden">
              <div ref={scrollRef} className="flex-1 overflow-y-auto">
                <div
                  className="mx-auto w-full flex flex-col gap-4 md:gap-6 relative"
                  style={{
                    maxWidth: "var(--content-max-width)",
                    paddingInline: "var(--content-padding)",
                  }}
                >
                  <div
                    ref={sentinelRef}
                    className="absolute top-0 h-[60px] w-px"
                  />
                  <Outlet />
                </div>
              </div>
            </div>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
