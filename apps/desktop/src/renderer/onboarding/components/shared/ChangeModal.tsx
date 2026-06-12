import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";
import { ObButton } from "./ui";

/**
 * The one shared "Change X" modal shell. Every reconfigure action (shortcut,
 * language) opens this same dialog, and the body is the REAL settings
 * component — never a bespoke onboarding widget — so it renders with the app
 * theme like it does in Settings.
 */
export function ChangeModal({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="py-1">{children}</div>
        <DialogFooter>
          <ObButton onClick={() => onOpenChange(false)}>
            {t("onboarding.navigation.done")}
          </ObButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
