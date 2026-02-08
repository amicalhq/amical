import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SettingsSidebar } from "../../components/settings-sidebar";

export const Route = createFileRoute("/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 52)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <div className="flex h-screen w-screen min-h-0 overflow-hidden">
        <SettingsSidebar variant="sidebar" />
        <SidebarInset
          style={
            {
              background:
                "linear-gradient(160deg, #121518 0%, #0d1012 45%, #07090a 100%)",
              "--background": "oklch(0.17 0 0)",
              "--card": "oklch(0.205 0 0)",
              "--popover": "oklch(0.205 0 0)",
              "--secondary": "oklch(0.212 0 0)",
              "--muted": "oklch(0.212 0 0)",
              "--input": "oklch(0.3 0 0)",
              "--border": "oklch(0.355 0 0)",
              "--ring": "oklch(0.52 0 0)",
            } as React.CSSProperties
          }
        >
          <div
            className="h-[var(--header-height)] shrink-0"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          />
          <div className="flex flex-1 flex-col min-h-0">
            <div className="@container/settings flex flex-1 flex-col min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto">
                <div
                  className="mx-auto w-full flex flex-col gap-4 md:gap-6"
                  style={{
                    maxWidth: "var(--content-max-width)",
                    padding:
                      "calc(var(--spacing) * 2) var(--content-padding) var(--content-padding)",
                  }}
                >
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
