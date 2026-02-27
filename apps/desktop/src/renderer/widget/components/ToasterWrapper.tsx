import React from "react";
import { Toaster } from "@/components/ui/sonner";

/**
 * Pure positioning wrapper for widget toasts.
 * Pass-through is managed in notification lifecycle to avoid hover races.
 */
export const ToasterWrapper: React.FC = () => {
  return (
    <div
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
