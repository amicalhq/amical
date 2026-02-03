import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Combobox } from "@/components/ui/combobox";
import { useFormattingSettings } from "../hooks/use-formatting-settings";
import { useTranslation } from "react-i18next";

export function FormattingSettings() {
  const { t } = useTranslation();
  const {
    formattingEnabled,
    selectedModelId,
    formattingOptions,
    disableFormattingToggle,
    hasFormattingOptions,
    showCloudRequiresSpeech,
    showCloudRequiresAuth,
    showCloudReady,
    showNoLanguageModels,
    handleFormattingEnabledChange,
    handleFormattingModelChange,
    handleCloudLogin,
    isLoginPending,
  } = useFormattingSettings();

  return (
    <div className="">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="flex items-center gap-2">
            <Label className="text-base font-semibold text-foreground">
              {t("settings.dictation.formatting.label")}
            </Label>
            <Badge className="text-[10px] px-1.5 py-0 bg-orange-500/20 text-orange-500 hover:bg-orange-500/20">
              {t("settings.dictation.formatting.badge")}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {t("settings.dictation.formatting.description")}
          </p>
        </div>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <div>
              <Switch
                checked={formattingEnabled}
                onCheckedChange={handleFormattingEnabledChange}
                disabled={disableFormattingToggle}
              />
            </div>
          </TooltipTrigger>
          {disableFormattingToggle && (
            <TooltipContent className="max-w-sm text-center">
              {t("settings.dictation.formatting.disabledTooltip")}
            </TooltipContent>
          )}
        </Tooltip>
      </div>

      <Link
        to="/settings/ai-models"
        search={{ tab: "language" }}
        className="inline-block"
      >
        <Button variant="link" className="text-xs px-0">
          <Plus className="w-4 h-4" />
          {t("settings.dictation.formatting.manageLanguageModels")}
        </Button>
      </Link>

      {formattingEnabled && (
        <div className="mt-6 border-border border rounded-md p-4">
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium text-foreground mb-2 block">
                {t("settings.dictation.formatting.modelLabel")}
              </Label>
              <p className="text-xs text-muted-foreground mb-4">
                {t("settings.dictation.formatting.modelDescription")}
              </p>
            </div>
            <div className="space-y-3">
              <Combobox
                options={formattingOptions}
                value={selectedModelId}
                onChange={handleFormattingModelChange}
                placeholder={t(
                  "settings.dictation.formatting.modelPlaceholder",
                )}
                disabled={!hasFormattingOptions}
              />
              {showCloudRequiresSpeech && (
                <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    {t("settings.dictation.formatting.requiresCloudSpeech")}
                  </span>
                  <Link to="/settings/ai-models" search={{ tab: "speech" }}>
                    <Button variant="outline" size="sm">
                      {t("settings.dictation.formatting.switchSpeechModel")}
                    </Button>
                  </Link>
                </div>
              )}
              {showCloudRequiresAuth && (
                <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <span>{t("settings.dictation.formatting.signInCloud")}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCloudLogin}
                    disabled={isLoginPending}
                  >
                    {t("settings.dictation.formatting.signIn")}
                  </Button>
                </div>
              )}
              {showCloudReady && (
                <p className="text-xs text-muted-foreground">
                  {t("settings.dictation.formatting.cloudReady")}
                </p>
              )}
              {showNoLanguageModels && (
                <div className="flex items-center justify-between rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    {t("settings.dictation.formatting.noLanguageModels")}
                  </span>
                  <Link to="/settings/ai-models" search={{ tab: "language" }}>
                    <Button variant="outline" size="sm">
                      <Plus className="w-4 h-4 mr-1" />
                      {t("settings.dictation.formatting.syncLanguageModels")}
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
