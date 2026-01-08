import React, { useRef } from "react";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/trpc/react";

const DEBOUNCE_DELAY = 100;

/**
 * Wrapper for Toaster that handles mouse events to enable/disable
 * pass-through on the widget window, making toasts clickable.
 */
export const ToasterWrapper: React.FC = () => {
  const setIgnoreMouseEvents = api.widget.setIgnoreMouseEvents.useMutation();
  const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = async () => {
    console.log("ToasterWrapper: mouse enter");
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    // Disable pass-through to make toast clickable
    await setIgnoreMouseEvents.mutateAsync({ ignore: false });
    console.log("ToasterWrapper: pass-through disabled");
  };

  const handleMouseLeave = () => {
    console.log("ToasterWrapper: mouse leave");
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
    }
    leaveTimeoutRef.current = setTimeout(async () => {
      // Re-enable pass-through
      await setIgnoreMouseEvents.mutateAsync({ ignore: true });
      console.log("ToasterWrapper: pass-through re-enabled");
    }, DEBOUNCE_DELAY);
  };

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        pointerEvents: "auto",
        zIndex: 9999,
      }}
    >
      <Toaster position="bottom-center" />
    </div>
  );
};
