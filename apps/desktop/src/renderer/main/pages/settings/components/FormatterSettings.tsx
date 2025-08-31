import React, { useState, useEffect } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Combobox } from "@/components/ui/combobox";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import type { ProviderModel } from "@/types/providers";

export function FormatterSettings() {
  const [syncedModels, setSyncedModels] = useState<ProviderModel[]>([]);
  const [formatterModel, setFormatterModel] = useState("");
  const [formatterEnabled, setFormatterEnabled] = useState(false);

  // tRPC queries and mutations
  const syncedModelsQuery = api.settings.getSyncedProviderModels.useQuery();
  const formatterConfigQuery = api.settings.getFormatterConfig.useQuery();
  const utils = api.useUtils();

  const setFormatterConfigMutation =
    api.settings.setFormatterConfig.useMutation({
      onSuccess: () => {
        toast.success("Configuration saved successfully!");
        utils.settings.getFormatterConfig.invalidate();
      },
      onError: (error) => {
        console.error("Failed to save formatter config:", error);
        toast.error("Failed to save configuration. Please try again.");
      },
    });

  // Load synced models from database
  useEffect(() => {
    if (syncedModelsQuery.data) {
      setSyncedModels(syncedModelsQuery.data);
    }
  }, [syncedModelsQuery.data]);

  // Load configuration when query data is available
  useEffect(() => {
    if (formatterConfigQuery.data) {
      const config = formatterConfigQuery.data;
      setFormatterModel(config.model);
      setFormatterEnabled(config.enabled);
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
          setFormatterModel(firstModel.id);
          saveFormatterConfig(firstModel.id, formatterEnabled);
          return;
        }

        // Check if currently selected model is still available
        const modelExists = syncedModels.some(
          (model) => model.id === config.model
        );
        if (!modelExists) {
          // Current model was removed, select first available model
          const firstModel = syncedModels[0];
          setFormatterModel(firstModel.id);
          saveFormatterConfig(firstModel.id, formatterEnabled);
          toast.info(
            `Previous formatting model was removed. Switched to ${firstModel.name}.`
          );
        }
      } else if (config && config.model) {
        // No models available but config has a model - clear it
        setFormatterModel("");
        saveFormatterConfig("", formatterEnabled);
      }
    }
  }, [syncedModels, formatterConfigQuery.data, formatterEnabled]);

  const handleFormattingEnabledChange = (enabled: boolean) => {
    setFormatterEnabled(enabled);
    saveFormatterConfig(formatterModel, enabled);
  };

  const handleFormattingModelChange = (model: string) => {
    setFormatterModel(model);
    saveFormatterConfig(model, formatterEnabled);
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
    <Card>
      <CardHeader>
        <CardTitle>Text Formatting Configuration</CardTitle>
        <CardDescription>
          Configure AI-powered post-processing of transcriptions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="enable-formatter">Enable Formatter</Label>
            <p className="text-sm text-muted-foreground">
              Apply AI formatting to transcriptions
            </p>
          </div>
          <Switch
            id="enable-formatter"
            checked={formatterEnabled}
            onCheckedChange={handleFormattingEnabledChange}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="formatter-model">Formatting Model</Label>
          {formattingModelOptions.length === 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-destructive">
                No models available. Please sync models first.
              </span>
              <Link to="/settings/ai-models?tab=language">
                <Button variant="outline">
                  <Plus className="w-4 h-4 mr-1" />
                  Sync models
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <Combobox
                disabled={!formatterEnabled}
                options={formattingModelOptions}
                value={formatterModel}
                onChange={handleFormattingModelChange}
                placeholder="Select a formatting model..."
              />
              <Link to="/settings/ai-models?tab=language">
                <Button variant="link" className="text-xs px-0">
                  <Plus className="w-4 h-4 mr-1" />
                  Add more models
                </Button>
              </Link>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
