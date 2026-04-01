import type { CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useSettingsHeaderActions } from "../routes/settings/header-actions-context";

interface SettingsNavigationControlsProps {
  className?: string;
  interactiveStyle?: CSSProperties;
  style?: CSSProperties;
  showNavigation?: boolean;
  showSidebarTrigger?: boolean;
}

export function SettingsNavigationControls({
  className,
  interactiveStyle,
  style,
  showNavigation = true,
  showSidebarTrigger = true,
}: SettingsNavigationControlsProps) {
  const {
    navigation: { canGoBack, canGoForward, goBack, goForward },
  } = useSettingsHeaderActions();

  return (
    <div className={cn("flex items-center gap-1.5", className)} style={style}>
      {showSidebarTrigger ? <SidebarTrigger style={interactiveStyle} /> : null}
      {showNavigation ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={goBack}
            disabled={!canGoBack}
            className="h-7 w-7 p-0"
            style={interactiveStyle}
            title="Go back"
            aria-label="Go back"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={goForward}
            disabled={!canGoForward}
            className="h-7 w-7 p-0"
            style={interactiveStyle}
            title="Go forward"
            aria-label="Go forward"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </>
      ) : null}
    </div>
  );
}
