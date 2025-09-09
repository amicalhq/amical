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
          <DialogTitle>Change Default Model</DialogTitle>
          <DialogDescription>
            Are you sure you want to set "{selectedModel?.name}" as your default{" "}
            {modelType} model?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>Change Default</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
