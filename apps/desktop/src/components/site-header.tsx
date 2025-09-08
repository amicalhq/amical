import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useRouter } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

interface SiteHeaderProps {
  currentView?: string;
}

const dragRegion = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDragRegion = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export function SiteHeader({ currentView }: SiteHeaderProps) {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  useEffect(() => {
    const updateNavigationState = () => {
      // Check browser history state
      // TanStack Router doesn't have canGoBack/canGoForward, use window.history instead
      setCanGoBack(
        window.history.length > 1 && window.history.state?.index > 0,
      );
      setCanGoForward(window.history.state?.index < window.history.length - 1);
    };

    updateNavigationState();

    // Listen for route changes to update button states
    const unsubscribe = router.subscribe("onResolved", updateNavigationState);

    // Listen for popstate events as well
    window.addEventListener("popstate", updateNavigationState);
    return () => {
      unsubscribe();
      window.removeEventListener("popstate", updateNavigationState);
    };
  }, [router]);

  const handleGoBack = () => {
    router.history.back();
  };

  const handleGoForward = () => {
    router.history.forward();
  };

  return (
    <header
      className="flex h-[var(--header-height)] shrink-0 items-center gap-2 backdrop-blur supports-[backdrop-filter]:bg-sidebar/60 sticky top-0 z-50 w-full"
      style={dragRegion}
    >
      <div className="flex w-full items-center gap-1">
        {/* macOS traffic light button spacing */}
        <div className="w-[78px] flex-shrink-0" />

        <div className="flex items-center gap-1 px-4 lg:gap-2 lg:px-6 py-1.5">
          <SidebarTrigger className="-ml-1" style={noDragRegion} />

          <Separator orientation="vertical" className="h-4" />

          {/* Navigation buttons */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleGoBack}
              disabled={!canGoBack}
              className="h-7 w-7 p-0"
              style={noDragRegion}
              title="Go back"
              aria-label="Go back"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleGoForward}
              disabled={!canGoForward}
              className="h-7 w-7 p-0"
              style={noDragRegion}
              title="Go forward"
              aria-label="Go forward"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
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
