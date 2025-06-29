import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

interface SiteHeaderProps {
  currentView?: string;
}

export function SiteHeader({ currentView }: SiteHeaderProps) {
  return (
    <header
      className="flex h-[var(--header-height)] shrink-0 items-center gap-2 backdrop-blur supports-[backdrop-filter]:bg-sidebar/60 sticky top-0 z-50 w-full"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex w-full items-center gap-1">
        {/* macOS traffic light button spacing */}
        <div className="w-[78px] flex-shrink-0" />

        <div className="flex items-center gap-1 px-4 lg:gap-2 lg:px-6 py-1.5">
          <SidebarTrigger
            className="-ml-1"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          />
        </div>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none select-none">
          <h1 className="text-base font-medium">{currentView || "Amical"}</h1>
        </div>

        {/* <div className="ml-auto flex items-center gap-2 px-4 lg:px-6">
          <Button 
            variant="ghost" 
            asChild 
            size="sm" 
            className="hidden sm:flex"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <a
              href="https://github.com/shadcn-ui/ui/tree/main/apps/v4/app/(examples)/dashboard"
              rel="noopener noreferrer"
              target="_blank"
              className="dark:text-foreground"
            >
              GitHub
            </a>
          </Button>
        </div> */}
      </div>
    </header>
  );
}
