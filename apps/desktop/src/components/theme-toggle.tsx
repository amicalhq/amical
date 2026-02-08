import * as React from "react";
import { Moon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ThemeToggle() {
  const [open, setOpen] = React.useState(false);
  const timeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const showComingSoonTooltip = () => {
    setOpen(true);
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      setOpen(false);
      timeoutRef.current = null;
    }, 1200);
  };

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          onClick={showComingSoonTooltip}
          aria-label="Theme switching is coming soon"
        >
          <Moon className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">Theme switching coming soon</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        comming soon...
      </TooltipContent>
    </Tooltip>
  );
}
