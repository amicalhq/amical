"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export default function AppleIntelligenceProvider() {
  const { t } = useTranslation();
  const [isSyncing, setIsSyncing] = useState(false);

  const isMac = window.electronAPI?.platform === "darwin";

  const availabilityQuery =
    api.models.checkAppleIntelligenceAvailability.useQuery(undefined, {
      enabled: isMac,
    });

  const utils = api.useUtils();
  const syncMutation = api.models.syncAppleIntelligenceModel.useMutation({
    onMutate: () => setIsSyncing(true),
    onSuccess: (result) => {
      setIsSyncing(false);
      if (result.available) {
        toast.success(t("settings.aiModels.appleIntelligence.toast.synced"));
        utils.models.getSyncedProviderModels.invalidate();
        utils.models.getDefaultLanguageModel.invalidate();
        utils.models.getModels.invalidate();
      } else {
        toast.error(
          t("settings.aiModels.appleIntelligence.toast.notAvailable"),
        );
      }
    },
    onError: () => {
      setIsSyncing(false);
      toast.error(t("settings.aiModels.appleIntelligence.toast.syncFailed"));
    },
  });

  if (!isMac) return null;

  const available = availabilityQuery.data?.available ?? false;
  const reason = availabilityQuery.data?.reason;
  const isLoading = availabilityQuery.isLoading;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium">
            {t("settings.aiModels.providers.appleIntelligence")}
          </span>
          {isLoading ? (
            <Badge variant="secondary" className="text-xs">
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
              {t("settings.aiModels.appleIntelligence.checking")}
            </Badge>
          ) : (
            <Badge
              variant="secondary"
              className={cn(
                "text-xs flex items-center gap-1",
                available
                  ? "text-green-500 border-green-500"
                  : "text-muted-foreground border-muted",
              )}
            >
              <span
                className={cn(
                  "w-2 h-2 rounded-full inline-block mr-1",
                  available ? "bg-green-500 animate-pulse" : "bg-muted-foreground",
                )}
              />
              {available
                ? t("settings.aiModels.appleIntelligence.available")
                : t("settings.aiModels.appleIntelligence.unavailable")}
            </Badge>
          )}
        </div>
        {available && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("settings.aiModels.appleIntelligence.syncing")}
              </>
            ) : (
              t("settings.aiModels.appleIntelligence.sync")
            )}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {available
          ? t("settings.aiModels.appleIntelligence.descriptionAvailable")
          : reason
            ? t("settings.aiModels.appleIntelligence.descriptionUnavailable", {
                reason,
              })
            : t(
                "settings.aiModels.appleIntelligence.descriptionUnavailableGeneric",
              )}
      </p>
    </div>
  );
}
