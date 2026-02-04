import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SettingsSidebar } from "../../components/settings-sidebar";
import { SiteHeader } from "@/components/site-header";
import { useLocation } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const location = useLocation();

  const getSettingsPageTitle = (pathname: string): string => {
    const routes: Record<string, string> = {
      "/settings/preferences": "Settings",
      "/settings/dictation": "Dictation",
      "/settings/vocabulary": "Vocabulary",
      "/settings/ai-models": "AI Models",
      "/settings/history": "History",
      "/settings/advanced": "Advanced",
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
      <div className="flex h-screen w-screen flex-col">
        <SiteHeader
          currentView={`${getSettingsPageTitle(location.pathname)}`}
        />

        <div className="flex flex-1 min-h-0">
          <SettingsSidebar variant="inset" />
          <SidebarInset className="!mt-0">
            <div className="flex flex-1 flex-col min-h-0">
              <div className="@container/settings flex flex-1 flex-col min-h-0 overflow-hidden">
                <div className="flex-1 overflow-y-auto">
                  <div
                    className="mx-auto w-full flex flex-col gap-4 md:gap-6"
                    style={{
                      maxWidth: "var(--content-max-width)",
                      padding: "var(--content-padding)",
                    }}
                  >
                    <Outlet />
                  </div>
                </div>
              </div>
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}
