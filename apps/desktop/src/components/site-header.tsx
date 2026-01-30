import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useRouter } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

interface SiteHeaderProps {
  currentView?: string;
}

const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties;
const noDragRegion = { WebkitAppRegion: "no-drag" } as CSSProperties;

export function SiteHeader({ currentView }: SiteHeaderProps) {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isMacOS, setIsMacOS] = useState(false);

  useEffect(() => {
    // Detect if running on macOS
    const platform = navigator.platform || navigator.userAgent;
    setIsMacOS(/Mac|Darwin/i.test(platform));
  }, []);

  useEffect(() => {
    // Track navigation history in session storage
    const HISTORY_KEY = "navigation-history";
    const INDEX_KEY = "navigation-index";

    // Initialize or get existing history
    let history: string[] = JSON.parse(
      sessionStorage.getItem(HISTORY_KEY) || "[]",
    );

    // If this is the first load, initialize with current path
    if (history.length === 0) {
      history = [router.state.location.pathname];
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      sessionStorage.setItem(INDEX_KEY, "0");
    }

    const updateNavigationState = () => {
      const storedHistory = JSON.parse(
        sessionStorage.getItem(HISTORY_KEY) || "[]",
      );
      const storedIndex = parseInt(sessionStorage.getItem(INDEX_KEY) || "0");

      setCanGoBack(storedIndex > 0);
      setCanGoForward(storedIndex < storedHistory.length - 1);
    };

    let isNavigatingProgrammatically = false;

    const handleNavigation = () => {
      const currentPath = router.state.location.pathname;
      let storedHistory: string[] = JSON.parse(
        sessionStorage.getItem(HISTORY_KEY) || "[]",
      );
      let storedIndex = parseInt(sessionStorage.getItem(INDEX_KEY) || "0");

      if (isNavigatingProgrammatically) {
        // Navigation was triggered by back/forward buttons, index already updated
        isNavigatingProgrammatically = false;
      } else {
        // Check if this is a back/forward navigation by comparing with history
        const previousPath = storedHistory[storedIndex - 1];
        const nextPath = storedHistory[storedIndex + 1];

        if (previousPath === currentPath) {
          // User went back
          storedIndex = Math.max(0, storedIndex - 1);
        } else if (nextPath === currentPath) {
          // User went forward
          storedIndex = Math.min(storedHistory.length - 1, storedIndex + 1);
        } else {
          // New navigation - truncate forward history and add new entry
          storedHistory = storedHistory.slice(0, storedIndex + 1);
          storedHistory.push(currentPath);
          storedIndex = storedHistory.length - 1;
        }

        sessionStorage.setItem(HISTORY_KEY, JSON.stringify(storedHistory));
        sessionStorage.setItem(INDEX_KEY, storedIndex.toString());
      }

      updateNavigationState();
    };

    // Initial state
    updateNavigationState();

    // Listen for route changes
    const unsubscribe = router.subscribe("onResolved", handleNavigation);

    // Override the navigation methods to track programmatic navigation
    const originalBack = router.history.back.bind(router.history);
    const originalForward = router.history.forward.bind(router.history);

    router.history.back = () => {
      const storedIndex = parseInt(sessionStorage.getItem(INDEX_KEY) || "0");
      if (storedIndex > 0) {
        isNavigatingProgrammatically = true;
        sessionStorage.setItem(INDEX_KEY, (storedIndex - 1).toString());
        originalBack();
      }
    };

    router.history.forward = () => {
      const storedHistory = JSON.parse(
        sessionStorage.getItem(HISTORY_KEY) || "[]",
      );
      const storedIndex = parseInt(sessionStorage.getItem(INDEX_KEY) || "0");
      if (storedIndex < storedHistory.length - 1) {
        isNavigatingProgrammatically = true;
        sessionStorage.setItem(INDEX_KEY, (storedIndex + 1).toString());
        originalForward();
      }
    };

    return () => {
      unsubscribe();
      // Restore original methods
      router.history.back = originalBack;
      router.history.forward = originalForward;
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
        {isMacOS && <div className="w-[78px] flex-shrink-0" />}

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
          <h1 className="text-base font-medium">{currentView || "Vox"}</h1>
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
