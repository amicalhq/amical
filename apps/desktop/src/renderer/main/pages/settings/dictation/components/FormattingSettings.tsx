import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import DefaultModelCombobox from "@/renderer/main/pages/settings/ai-models/components/default-model-combobox";

export function FormattingSettings() {
  const [formattingEnabled, setFormattingEnabled] = useState(false);

  // tRPC queries and mutations
  const formatterConfigQuery = api.settings.getFormatterConfig.useQuery();
  const modelsQuery = api.models.getModels.useQuery({
    type: "language",
  });
  const defaultLanguageModelQuery = api.models.getDefaultModel.useQuery({
    type: "language",
  });
  const utils = api.useUtils();

  const setFormatterConfigMutation =
    api.settings.setFormatterConfig.useMutation({
      onSuccess: () => {
        utils.settings.getFormatterConfig.invalidate();
      },
      onError: (error) => {
        console.error("Failed to save formatting settings:", error);
        toast.error("Failed to save formatting settings. Please try again.");
      },
    });

  // Load formatter config from database
  useEffect(() => {
    if (formatterConfigQuery.data) {
      const config = formatterConfigQuery.data;
      setFormattingEnabled(config.enabled);
    }
  }, [formatterConfigQuery.data]);

  const handleFormattingEnabledChange = (enabled: boolean) => {
    setFormattingEnabled(enabled);
    // Save with the current default language model
    const model = defaultLanguageModelQuery.data || "";
    saveFormatterConfig(model, enabled);
  };

  const saveFormatterConfig = (model: string, enabled: boolean) => {
    setFormatterConfigMutation.mutate({
      model,
      enabled,
    });
  };

  const hasModels = (modelsQuery.data?.length ?? 0) > 0;
  return (
    <div className="">
      <div className="flex items-center justify-between mb-2">
        <div>
          <Label className="text-base font-semibold text-foreground">
            Formatting
          </Label>
          <p className="text-xs text-muted-foreground mb-2">
            Enable formatting and select the AI model for formatting output.
          </p>
        </div>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <div>
              <Switch
                checked={formattingEnabled}
                onCheckedChange={handleFormattingEnabledChange}
                disabled={!hasModels}
              />
            </div>
          </TooltipTrigger>
          {!hasModels && (
            <TooltipContent className="max-w-sm text-center">
              Please sync AI models first to enable formatting functionality.
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
                Formatting Model
              </Label>
              <p className="text-xs text-muted-foreground mb-4">
                Select the language model to use for formatting transcriptions.
              </p>
            </div>
            {!hasModels ? (
              <div className="flex flex-col items-center gap-2">
                <span className="text-destructive text-sm">
                  No models available. Please sync models first.
                </span>
                <Link to="/settings/ai-models" search={{ tab: "language" }}>
                  <Button variant="outline" size={"sm"}>
                    <Plus className="w-4 h-4 mr-1" />
                    Sync models
                  </Button>
                </Link>
              </div>
            ) : (
              <DefaultModelCombobox
                modelType="language"
                title="Default Language Model"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
