"use client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Model } from "@/db/schema";
import { useTranslation } from "react-i18next";

interface ChangeDefaultModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedModel: Model | undefined;
  onConfirm: () => void;
  modelType?: "language" | "embedding";
}

export default function ChangeDefaultModelDialog({
  open,
  onOpenChange,
  selectedModel,
  onConfirm,
  modelType = "language",
}: ChangeDefaultModelDialogProps) {
  const { t } = useTranslation();
  const modelTypeLabel = t(`settings.aiModels.modelTypes.${modelType}`);

  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("settings.aiModels.changeDefaultDialog.title")}
          </DialogTitle>
          <DialogDescription>
            {t("settings.aiModels.changeDefaultDialog.description", {
              modelName: selectedModel?.name ?? "",
              modelType: modelTypeLabel,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t("settings.aiModels.changeDefaultDialog.cancel")}
          </Button>
          <Button onClick={handleConfirm}>
            {t("settings.aiModels.changeDefaultDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
