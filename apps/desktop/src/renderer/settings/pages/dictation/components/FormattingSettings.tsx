import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import type { ProviderModel } from "@/types/providers";

export function FormattingSettings() {
  const [syncedModels, setSyncedModels] = useState<ProviderModel[]>([]);
  const [formattingEnabled, setFormattingEnabled] = useState(false);
  const [formattingModel, setFormattingModel] = useState("");

  // tRPC queries and mutations
  const syncedModelsQuery = api.settings.getSyncedProviderModels.useQuery();
  const formatterConfigQuery = api.settings.getFormatterConfig.useQuery();
  const utils = api.useUtils();

  const setFormatterConfigMutation =
    api.settings.setFormatterConfig.useMutation({
      onSuccess: () => {
        toast.success("Formatting settings saved successfully!");
        utils.settings.getFormatterConfig.invalidate();
      },
      onError: (error) => {
        console.error("Failed to save formatting settings:", error);
        toast.error("Failed to save formatting settings. Please try again.");
      },
    });

  // Load synced models from database
  useEffect(() => {
    if (syncedModelsQuery.data) {
      setSyncedModels(syncedModelsQuery.data);
    }
  }, [syncedModelsQuery.data]);

  // Load formatter config from database
  useEffect(() => {
    if (formatterConfigQuery.data) {
      const config = formatterConfigQuery.data;
      setFormattingEnabled(config.enabled);
      setFormattingModel(config.model);
    }
  }, [formatterConfigQuery.data]);

  // Handle model validation and auto-selection when both models and config are loaded
  useEffect(() => {
    if (formatterConfigQuery.data !== undefined) {
      const config = formatterConfigQuery.data;

      if (syncedModels.length > 0) {
        // Auto-select first model if no model is currently configured or config is null
        if (!config || !config.model) {
          const firstModel = syncedModels[0];
          setFormattingModel(firstModel.id);
          saveFormatterConfig(firstModel.id, formattingEnabled);
          return;
        }

        // Check if currently selected model is still available
        const modelExists = syncedModels.some(
          (model) => model.id === config.model
        );
        if (!modelExists) {
          // Current model was removed, select first available model
          const firstModel = syncedModels[0];
          setFormattingModel(firstModel.id);
          saveFormatterConfig(firstModel.id, formattingEnabled);
          toast.info(
            `Previous formatting model was removed. Switched to ${firstModel.name}.`
          );
        }
      } else if (config && config.model) {
        // No models available but config has a model - clear it
        setFormattingModel("");
        saveFormatterConfig("", formattingEnabled);
      }
    }
  }, [syncedModels, formatterConfigQuery.data, formattingEnabled]);

  const handleFormattingEnabledChange = (enabled: boolean) => {
    setFormattingEnabled(enabled);
    saveFormatterConfig(formattingModel, enabled);
  };

  const handleFormattingModelChange = (model: string) => {
    setFormattingModel(model);
    saveFormatterConfig(model, formattingEnabled);
  };

  const saveFormatterConfig = (model: string, enabled: boolean) => {
    setFormatterConfigMutation.mutate({
      model,
      enabled,
    });
  };

  // Convert synced models to combobox options
  const formattingModelOptions = syncedModels.map((model) => ({
    value: model.id,
    label: model.name,
  }));
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
        <Switch
          checked={formattingEnabled}
          onCheckedChange={handleFormattingEnabledChange}
        />
      </div>

      <div className="flex items-start justify-between mt-6 border-border border rounded-md p-4">
        <Label
          className={cn(
            "text-sm font-medium text-foreground",
            !formattingEnabled && "opacity-50 pointer-events-none"
          )}
        >
          Formatting Model
        </Label>
        {formattingModelOptions.length === 0 ? (
          <div className="flex flex-col items-end gap-2">
            <Link to="/settings/ai-models?tab=language">
              <Button variant="outline" size={"sm"} className="ml-2">
                <Plus className="w-4 h-4 mr-1" />
                Sync models
              </Button>
            </Link>
            <span className="text-destructive text-xs">
              No models available. Please sync models first.
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-3">
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <div>
                  <Combobox
                    disabled={!formattingEnabled}
                    options={formattingModelOptions}
                    value={formattingModel}
                    onChange={handleFormattingModelChange}
                  />
                </div>
              </TooltipTrigger>
              {!formattingEnabled && (
                <TooltipContent className="max-w-sm text-center">
                  Enable formatting to select a formatting model. This will
                  improve the quality and structure of your transcribed text.
                </TooltipContent>
              )}
            </Tooltip>
            <Link
              to="/settings/ai-models?tab=language"
              className={cn(
                !formattingEnabled && "opacity-50 pointer-events-none"
              )}
            >
              <Button variant="link" className="text-xs px-0">
                <Plus className="w-4 h-4" />
                Add more models
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
