import { Cloud, Info, TestTubeDiagonal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/trpc/react";

export default function LabsSettingsPage() {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const labsQuery = api.settings.getLabsSettings.useQuery();
  const updateLabsMutation = api.settings.setLabsSettings.useMutation({
    onSuccess: () => {
      toast.success(t("settings.labs.toast.updated"));
      utils.settings.getLabsSettings.invalidate();
    },
    onError: (error) => {
      console.error("Failed to update labs settings:", error);
      toast.error(t("settings.labs.toast.updateFailed"));
    },
  });

  const selfCorrection = labsQuery.data?.selfCorrection ?? false;
  const isBusy = labsQuery.isLoading || updateLabsMutation.isPending;

  const handleSelfCorrectionChange = (checked: boolean) => {
    updateLabsMutation.mutate({ selfCorrection: checked });
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-bold">{t("settings.labs.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("settings.labs.description")}
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardContent>
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
                  <TestTubeDiagonal className="size-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label className="text-base font-medium text-foreground">
                      {t("settings.labs.selfCorrection.label")}
                    </Label>
                    <Badge variant="secondary" className="gap-1">
                      <Cloud className="size-3" aria-hidden="true" />
                      {t("settings.labs.selfCorrection.cloudOnly")}
                    </Badge>
                    <Tooltip delayDuration={100}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={t(
                            "settings.labs.selfCorrection.cloudTooltip",
                          )}
                        >
                          <Info className="size-4" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-center">
                        {t("settings.labs.selfCorrection.cloudTooltip")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="max-w-2xl text-xs text-muted-foreground">
                    {t("settings.labs.selfCorrection.description")}
                  </p>
                </div>
              </div>
              <Switch
                checked={selfCorrection}
                onCheckedChange={handleSelfCorrectionChange}
                disabled={isBusy}
                aria-label={t("settings.labs.selfCorrection.ariaLabel")}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
