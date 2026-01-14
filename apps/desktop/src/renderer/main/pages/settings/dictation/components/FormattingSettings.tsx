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

export function FormattingSettings() {
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
              Formatting
            </Label>
            <Badge className="text-[10px] px-1.5 py-0 bg-orange-500/20 text-orange-500 hover:bg-orange-500/20">
              Alpha
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Apply punctuation and structure to your transcriptions.
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
              Sync a language model or select Amical Cloud transcription to
              enable formatting.
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
          Manage language models
        </Button>
      </Link>

      {formattingEnabled && (
        <div className="mt-6 border-border border rounded-md p-4">
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium text-foreground mb-2 block">
                Formatting model
              </Label>
              <p className="text-xs text-muted-foreground mb-4">
                Choose the model used to format your transcription.
              </p>
            </div>
            <div className="space-y-3">
              <Combobox
                options={formattingOptions}
                value={selectedModelId}
                onChange={handleFormattingModelChange}
                placeholder="Select a model..."
                disabled={!hasFormattingOptions}
              />
              {showCloudRequiresSpeech && (
                <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <span>Requires Amical Cloud transcription.</span>
                  <Link to="/settings/ai-models" search={{ tab: "speech" }}>
                    <Button variant="outline" size="sm">
                      Switch speech model
                    </Button>
                  </Link>
                </div>
              )}
              {showCloudRequiresAuth && (
                <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <span>Sign in to use Amical Cloud formatting.</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCloudLogin}
                    disabled={isLoginPending}
                  >
                    Sign in
                  </Button>
                </div>
              )}
              {showCloudReady && (
                <p className="text-xs text-muted-foreground">
                  Using Amical Cloud formatting.
                </p>
              )}
              {showNoLanguageModels && (
                <div className="flex items-center justify-between rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    Formatting won't run — no language model available.
                  </span>
                  <Link to="/settings/ai-models" search={{ tab: "language" }}>
                    <Button variant="outline" size="sm">
                      <Plus className="w-4 h-4 mr-1" />
                      Sync language models
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
