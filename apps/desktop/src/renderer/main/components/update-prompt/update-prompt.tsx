import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UpdatePrompt as UpdatePromptData } from "@/main/services/update-prompt";
import { ReleaseNotes } from "./release-notes";

export function UpdatePrompt() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState<UpdatePromptData | null>(null);
  const quitAndInstall = api.updater.quitAndInstall.useMutation();
  const dismiss = api.updater.dismissUpdatePrompt.useMutation();

  // eslint-disable-next-line deprecation/deprecation
  api.updater.updatePrompt.useSubscription(undefined, {
    onData: (data) => setPrompt(data),
  });

  const isForce = prompt?.action === "force";
  const open = prompt !== null;

  const handleLater = () => {
    dismiss.mutate();
    setPrompt(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isForce) handleLater();
      }}
    >
      <DialogContent
        showCloseButton={!isForce}
        className="sm:max-w-xl"
        onEscapeKeyDown={(e) => {
          if (isForce) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (isForce) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t(isForce ? "updater.requiredUpdate" : "updater.updateAvailable")}
          </DialogTitle>
          {prompt?.version && (
            <p className="text-muted-foreground text-sm">
              {t(
                isForce ? "updater.versionRequired" : "updater.versionAvailable",
                { version: prompt.version },
              )}
            </p>
          )}
        </DialogHeader>
        {prompt?.releaseNotes && (
          <div className="max-h-[50vh] overflow-y-auto pr-1">
            <ReleaseNotes markdown={prompt.releaseNotes} />
          </div>
        )}
        <DialogFooter>
          {!isForce && (
            <Button variant="outline" onClick={handleLater}>
              {t("updater.later")}
            </Button>
          )}
          <Button onClick={() => quitAndInstall.mutate()}>
            {t("updater.restartAndUpdate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
