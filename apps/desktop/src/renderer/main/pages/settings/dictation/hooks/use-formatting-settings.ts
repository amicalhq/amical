import { useMemo, useCallback } from "react";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import type { FormatterConfig } from "@/types/formatter";

import type { ComboboxOption } from "@/components/ui/combobox";

interface UseFormattingSettingsReturn {
  // State
  formattingEnabled: boolean;
  selectedModelId: string;
  formattingOptions: ComboboxOption[];

  // Derived booleans
  disableFormattingToggle: boolean;
  hasFormattingOptions: boolean;
  showNoLanguageModels: boolean;

  // Handlers
  handleFormattingEnabledChange: (enabled: boolean) => void;
  handleFormattingModelChange: (modelId: string) => void;

}

export function useFormattingSettings(): UseFormattingSettingsReturn {
  // tRPC queries
  const formatterConfigQuery = api.settings.getFormatterConfig.useQuery();
  const languageModelsQuery = api.models.getModels.useQuery({
    type: "language",
  });
  const utils = api.useUtils();

  // Use query data directly
  const formatterConfig = formatterConfigQuery.data ?? null;

  // Mutations with optimistic updates
  const setFormatterConfigMutation =
    api.settings.setFormatterConfig.useMutation({
      onMutate: async (newConfig) => {
        // Cancel outgoing refetches
        await utils.settings.getFormatterConfig.cancel();

        // Snapshot previous value
        const previousConfig = utils.settings.getFormatterConfig.getData();

        // Optimistically update
        utils.settings.getFormatterConfig.setData(undefined, newConfig);

        return { previousConfig };
      },
      onError: (error, _newConfig, context) => {
        // Rollback on error
        if (context?.previousConfig) {
          utils.settings.getFormatterConfig.setData(
            undefined,
            context.previousConfig,
          );
        }
        console.error("Failed to save formatting settings:", error);
        toast.error("Failed to save formatting settings. Please try again.");
      },
      onSettled: () => {
        // Refetch to ensure consistency
        utils.settings.getFormatterConfig.invalidate();
      },
    });

  // Subscriptions
  api.models.onSelectionChanged.useSubscription(undefined, {
    onData: ({ modelType }) => {
      if (modelType === "speech") {
        utils.settings.getFormatterConfig.invalidate();
        utils.models.getSelectedModel.invalidate();
      }
    },
    onError: (error) => {
      console.error("Selection changed subscription error:", error);
    },
  });

  // Derived values
  const languageModels = languageModelsQuery.data || [];
  const hasLanguageModels = languageModels.length > 0;
  const hasFormattingOptions = hasLanguageModels;
  const formattingEnabled = formatterConfig?.enabled ?? false;
  const disableFormattingToggle = !hasFormattingOptions;

  const formattingOptions = useMemo<ComboboxOption[]>(() => {
    const languageOptions = languageModels.map((model) => ({
      value: model.id,
      label: `${model.name} (${model.provider})`,
    }));

    return languageOptions;
  }, [languageModels]);

  const optionValues = useMemo(() => {
    return new Set(formattingOptions.map((option) => option.value));
  }, [formattingOptions]);

  const selectedModelId = useMemo(() => {
    const preferredModelId = formatterConfig?.modelId || "";

    return optionValues.has(preferredModelId) ? preferredModelId : "";
  }, [formatterConfig?.modelId, optionValues]);

  // Inline state conditions
  const showNoLanguageModels =
    !hasLanguageModels;

  // Handlers
  const handleFormattingEnabledChange = useCallback(
    (enabled: boolean) => {
      const nextConfig: FormatterConfig = {
        enabled,
        modelId: formatterConfig?.modelId,
        fallbackModelId: formatterConfig?.fallbackModelId,
      };
      setFormatterConfigMutation.mutate(nextConfig);
    },
    [formatterConfig, setFormatterConfigMutation],
  );

  const handleFormattingModelChange = useCallback(
    (modelId: string) => {
      if (!modelId) {
        return;
      }

      const currentModelId =
        formatterConfig?.modelId || "";

      if (modelId === currentModelId) {
        return;
      }

      const nextConfig: FormatterConfig = {
        enabled: formatterConfig?.enabled ?? false,
        modelId,
        fallbackModelId: modelId,
      };

      setFormatterConfigMutation.mutate(nextConfig);
    },
    [
      formatterConfig,
      setFormatterConfigMutation,
    ],
  );

  return {
    // State
    formattingEnabled,
    selectedModelId,
    formattingOptions,

    // Derived booleans
    disableFormattingToggle,
    hasFormattingOptions,
    showNoLanguageModels,

    // Handlers
    handleFormattingEnabledChange,
    handleFormattingModelChange,

  };
}
