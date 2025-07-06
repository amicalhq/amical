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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { FormatterConfig } from "@/types/formatter";
import { api } from "@/trpc/react";
import { toast } from "sonner";

// OpenRouter models list
const OPENROUTER_MODELS = [
  { value: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
  { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { value: "anthropic/claude-3-haiku", label: "Claude 3 Haiku" },
  { value: "openai/gpt-4o", label: "GPT-4o" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  { value: "openai/gpt-4-turbo", label: "GPT-4 Turbo" },
  { value: "meta-llama/llama-3.1-8b-instruct", label: "Llama 3.1 8B" },
  { value: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B" },
  { value: "google/gemini-pro-1.5", label: "Gemini Pro 1.5" },
];

export function FormatterSettings() {
  const [formatterProvider, setFormatterProvider] =
    useState<"openrouter">("openrouter");
  const [openrouterModel, setOpenrouterModel] = useState("");
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [formatterEnabled, setFormatterEnabled] = useState(false);

  // tRPC queries and mutations
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

  // Load configuration when query data is available
  useEffect(() => {
    if (formatterConfigQuery.data) {
      const config = formatterConfigQuery.data;
      setFormatterProvider(config.provider);
      setOpenrouterModel(config.model);
      setOpenrouterApiKey(config.apiKey);
      setFormatterEnabled(config.enabled);
    }
  }, [formatterConfigQuery.data]);

  const saveFormatterConfig = async () => {
    const config: FormatterConfig = {
      provider: formatterProvider,
      model: openrouterModel,
      apiKey: openrouterApiKey,
      enabled: formatterEnabled,
    };

    setFormatterConfigMutation.mutate(config);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Text Formatting Configuration</CardTitle>
        <CardDescription>
          Configure AI-powered post-processing of transcriptions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="formatter-provider">Provider</Label>
          <Select
            value={formatterProvider}
            onValueChange={(value: "openrouter") => setFormatterProvider(value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openrouter">OpenRouter</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {formatterProvider === "openrouter" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="openrouter-model">Model</Label>
              <Select
                value={openrouterModel}
                onValueChange={setOpenrouterModel}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {OPENROUTER_MODELS.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="openrouter-api-key">API Key</Label>
              <Input
                id="openrouter-api-key"
                type="password"
                placeholder="Enter your OpenRouter API key"
                value={openrouterApiKey}
                onChange={(e) => setOpenrouterApiKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Get your API key from{" "}
                <a
                  href="https://openrouter.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  openrouter.ai
                </a>
              </p>
            </div>
          </>
        )}

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
            onCheckedChange={setFormatterEnabled}
          />
        </div>

        <div className="pt-4">
          <Button
            onClick={saveFormatterConfig}
            disabled={
              setFormatterConfigMutation.isPending ||
              !openrouterModel ||
              !openrouterApiKey
            }
          >
            {setFormatterConfigMutation.isPending
              ? "Saving..."
              : "Save Configuration"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
