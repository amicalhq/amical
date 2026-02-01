import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Combobox } from "@/components/ui/combobox";
import { ComboboxMulti } from "@/components/ui/combobox-multi";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { AVAILABLE_LANGUAGES } from "@/constants/languages";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import type { ModeConfig } from "@/db/schema";
import { CustomInstructionsEditor } from "./CustomInstructionsEditor";
import type { ComboboxOption } from "@/components/ui/combobox";

const GLOBAL_DEFAULT_VALUE = "__global_default__";


interface ModeCardProps {
  mode: ModeConfig;
  isActive: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function ModeCard({
  mode,
  isActive,
  isExpanded,
  onToggleExpand,
}: ModeCardProps) {
  const utils = api.useUtils();

  // Local state for debounced updates
  const [localName, setLocalName] = useState(mode.name);
  const [localCustomInstructions, setLocalCustomInstructions] = useState(
    mode.customInstructions,
  );
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instructionsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Sync local state when mode changes externally
  useEffect(() => {
    setLocalName(mode.name);
  }, [mode.name]);

  useEffect(() => {
    setLocalCustomInstructions(mode.customInstructions);
  }, [mode.customInstructions]);

  // Language models query for formatting model selection
  const languageModelsQuery = api.models.getModels.useQuery({
    type: "language",
  });
  const languageModels = languageModelsQuery.data || [];

  const formattingOptions = useMemo<ComboboxOption[]>(() => {
    const options: ComboboxOption[] = [
      {
        value: "amical-cloud",
        label: "Amical Cloud (Amical)",
      },
    ];

    const languageOptions = languageModels.map((model) => ({
      value: model.id,
      label: `${model.name} (${model.provider})`,
    }));

    return [...options, ...languageOptions];
  }, [languageModels]);

  // Installed apps query for app bindings
  const installedAppsQuery = api.settings.getInstalledApps.useQuery();
  const installedApps = installedAppsQuery.data ?? [];

  const appBindingOptions = useMemo(() => {
    const installedOptions = installedApps.map((a) => ({
      value: a.bundleId,
      label: a.name,
      icon: a.icon,
    }));

    // Preserve existing bindings that may no longer be installed
    const installedIds = new Set(installedApps.map((a) => a.bundleId));
    const existingBindings = (mode.appBindings ?? [])
      .filter((id) => !installedIds.has(id))
      .map((id) => ({ value: id, label: id, icon: undefined }));

    return [...installedOptions, ...existingBindings];
  }, [installedApps, mode.appBindings]);

  // Speech model options: global default, cloud, or local whisper
  const speechModelOptions: ComboboxOption[] = [
    { value: GLOBAL_DEFAULT_VALUE, label: "Use global default" },
    { value: "amical-cloud", label: "Amical Cloud" },
    { value: "local-whisper", label: "Local Whisper" },
  ];

  // Mutations
  const updateModeMutation = api.settings.updateMode.useMutation({
    onSuccess: () => {
      utils.settings.getModes.invalidate();
    },
    onError: (error) => {
      console.error("Failed to update mode:", error);
      toast.error("Failed to update mode");
    },
  });

  const setActiveModeMutation = api.settings.setActiveMode.useMutation({
    onSuccess: () => {
      utils.settings.getModes.invalidate();
    },
    onError: (error) => {
      console.error("Failed to set active mode:", error);
      toast.error("Failed to set active mode");
    },
  });

  const deleteModeMutation = api.settings.deleteMode.useMutation({
    onSuccess: () => {
      utils.settings.getModes.invalidate();
      toast.success("Mode deleted");
    },
    onError: (error) => {
      console.error("Failed to delete mode:", error);
      toast.error(error.message || "Failed to delete mode");
    },
  });

  // Handlers
  const handleNameChange = useCallback(
    (name: string) => {
      setLocalName(name);
      if (nameDebounceRef.current !== null) {
        clearTimeout(nameDebounceRef.current);
      }
      nameDebounceRef.current = setTimeout(() => {
        if (name.trim()) {
          updateModeMutation.mutate({ modeId: mode.id, name: name.trim() });
        }
      }, 500);
    },
    [mode.id, updateModeMutation],
  );

  const handleAutoDetectChange = useCallback(
    (autoDetectEnabled: boolean) => {
      updateModeMutation.mutate({
        modeId: mode.id,
        dictation: {
          autoDetectEnabled,
          selectedLanguage: mode.dictation.selectedLanguage || "en",
        },
      });
    },
    [mode.id, mode.dictation.selectedLanguage, updateModeMutation],
  );

  const handleLanguageChange = useCallback(
    (selectedLanguage: string) => {
      updateModeMutation.mutate({
        modeId: mode.id,
        dictation: {
          autoDetectEnabled: mode.dictation.autoDetectEnabled,
          selectedLanguage,
        },
      });
    },
    [mode.id, mode.dictation.autoDetectEnabled, updateModeMutation],
  );

  const handleFormattingEnabledChange = useCallback(
    (enabled: boolean) => {
      updateModeMutation.mutate({
        modeId: mode.id,
        formatterConfig: {
          enabled,
          modelId: mode.formatterConfig.modelId,
          fallbackModelId: mode.formatterConfig.fallbackModelId,
        },
      });
    },
    [mode.id, mode.formatterConfig, updateModeMutation],
  );

  const handleFormattingModelChange = useCallback(
    (modelId: string) => {
      if (!modelId) return;
      updateModeMutation.mutate({
        modeId: mode.id,
        formatterConfig: {
          enabled: mode.formatterConfig.enabled,
          modelId,
          fallbackModelId:
            modelId !== "amical-cloud"
              ? modelId
              : mode.formatterConfig.fallbackModelId,
        },
      });
    },
    [mode.id, mode.formatterConfig, updateModeMutation],
  );

  const handleCustomInstructionsChange = useCallback(
    (value: string | undefined) => {
      setLocalCustomInstructions(value);
      if (instructionsDebounceRef.current !== null) {
        clearTimeout(instructionsDebounceRef.current);
      }
      instructionsDebounceRef.current = setTimeout(() => {
        updateModeMutation.mutate({
          modeId: mode.id,
          customInstructions: value ?? null,
        });
      }, 500);
    },
    [mode.id, updateModeMutation],
  );

  const handleSpeechModelChange = useCallback(
    (value: string) => {
      updateModeMutation.mutate({
        modeId: mode.id,
        speechModelId: value === GLOBAL_DEFAULT_VALUE ? null : value,
      });
    },
    [mode.id, updateModeMutation],
  );

  const handleAppBindingsChange = useCallback(
    (values: string[]) => {
      updateModeMutation.mutate({
        modeId: mode.id,
        appBindings: values.length > 0 ? values : null,
      });
    },
    [mode.id, updateModeMutation],
  );

  const handleSetActive = useCallback(() => {
    setActiveModeMutation.mutate({ modeId: mode.id });
  }, [mode.id, setActiveModeMutation]);

  const handleDelete = useCallback(() => {
    deleteModeMutation.mutate({ modeId: mode.id });
  }, [mode.id, deleteModeMutation]);

  // Cleanup debounce timers
  useEffect(() => {
    return () => {
      if (nameDebounceRef.current !== null)
        clearTimeout(nameDebounceRef.current);
      if (instructionsDebounceRef.current !== null)
        clearTimeout(instructionsDebounceRef.current);
    };
  }, []);

  // Badge info
  const languageLabel = mode.dictation.autoDetectEnabled
    ? "Auto"
    : AVAILABLE_LANGUAGES.find(
        (l) => l.value === mode.dictation.selectedLanguage,
      )?.label || mode.dictation.selectedLanguage;

  const formattingLabel = mode.formatterConfig.enabled
    ? formattingOptions.find(
        (o) => o.value === mode.formatterConfig.modelId,
      )?.label || "Enabled"
    : "Off";

  const speechModelLabel = mode.speechModelId
    ? speechModelOptions.find((o) => o.value === mode.speechModelId)?.label ||
      mode.speechModelId
    : null;

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
      <div className="border border-border rounded-lg">
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors rounded-lg cursor-pointer">
            <div className="flex items-center gap-3">
              {isActive && (
                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              )}
              <span className="font-medium text-sm">{mode.name}</span>
              <div className="flex items-center gap-1.5">
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {languageLabel}
                </Badge>
                {mode.formatterConfig.enabled && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0"
                  >
                    {formattingLabel}
                  </Badge>
                )}
                {speechModelLabel && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0"
                  >
                    {speechModelLabel}
                  </Badge>
                )}
                {mode.appBindings && mode.appBindings.length > 0 && (
                  <div className="flex items-center gap-1">
                    {mode.appBindings.slice(0, 5).map((bundleId) => {
                      const appOption = appBindingOptions.find(
                        (o) => o.value === bundleId,
                      );
                      return appOption?.icon ? (
                        <img
                          key={bundleId}
                          src={appOption.icon}
                          alt={appOption.label}
                          title={appOption.label}
                          className="h-5 w-5 rounded-sm"
                        />
                      ) : null;
                    })}
                    {mode.appBindings.length > 5 && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1 py-0 ml-1"
                      >
                        +{mode.appBindings.length - 5}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                isExpanded && "rotate-180",
              )}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-6">
            <Separator />

            {/* Mode name */}
            {!mode.isDefault && (
              <div>
                <Label className="text-sm font-medium text-foreground mb-2 block">
                  Mode name
                </Label>
                <Input
                  value={localName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Mode name"
                  className="max-w-xs"
                />
              </div>
            )}

            {/* Language settings */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <Label className="text-base font-semibold text-foreground">
                    Auto detect language
                  </Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Automatically detect spoken language. Turn off to select
                    specific languages.
                  </p>
                </div>
                <Switch
                  checked={mode.dictation.autoDetectEnabled}
                  onCheckedChange={handleAutoDetectChange}
                />
              </div>

              <div className="flex justify-between items-start mt-4 border-border border rounded-md p-4">
                <div
                  className={cn(
                    "flex items-start gap-2 flex-col",
                    mode.dictation.autoDetectEnabled &&
                      "opacity-50 pointer-events-none",
                  )}
                >
                  <Label className="text-sm font-medium text-foreground">
                    Languages
                  </Label>
                </div>
                <Tooltip delayDuration={100}>
                  <TooltipTrigger asChild>
                    <div>
                      <Combobox
                        options={AVAILABLE_LANGUAGES.filter(
                          (l) => l.value !== "auto",
                        )}
                        value={mode.dictation.selectedLanguage}
                        onChange={handleLanguageChange}
                        placeholder="Select languages..."
                        disabled={mode.dictation.autoDetectEnabled}
                      />
                    </div>
                  </TooltipTrigger>
                  {mode.dictation.autoDetectEnabled && (
                    <TooltipContent className="max-w-sm text-center">
                      Disable auto detection to select languages. Selecting
                      specific languages may increase accuracy.
                    </TooltipContent>
                  )}
                </Tooltip>
              </div>
            </div>

            <Separator />

            {/* Speech model settings */}
            <div>
              <Label className="text-base font-semibold text-foreground">
                Speech model
              </Label>
              <p className="text-xs text-muted-foreground mb-4">
                Choose the speech recognition model for this mode. Uses the
                global default when not set.
              </p>
              <Combobox
                options={speechModelOptions}
                value={mode.speechModelId ?? GLOBAL_DEFAULT_VALUE}
                onChange={handleSpeechModelChange}
                placeholder="Select a speech model..."
              />
            </div>

            <Separator />

            {/* Formatting settings */}
            <div>
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
                        checked={mode.formatterConfig.enabled}
                        onCheckedChange={handleFormattingEnabledChange}
                        disabled={
                          formattingOptions.length <= 1 &&
                          languageModels.length === 0
                        }
                      />
                    </div>
                  </TooltipTrigger>
                  {formattingOptions.length <= 1 &&
                    languageModels.length === 0 && (
                      <TooltipContent className="max-w-sm text-center">
                        Sync a language model or select Amical Cloud
                        transcription to enable formatting.
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

              {mode.formatterConfig.enabled && (
                <div className="mt-4 border-border border rounded-md p-4">
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">
                        Formatting model
                      </Label>
                      <p className="text-xs text-muted-foreground mb-4">
                        Choose the model used to format your transcription.
                      </p>
                    </div>
                    <Combobox
                      options={formattingOptions}
                      value={mode.formatterConfig.modelId ?? ""}
                      onChange={handleFormattingModelChange}
                      placeholder="Select a model..."
                    />
                  </div>
                </div>
              )}
            </div>

            {mode.formatterConfig.enabled && (
              <>
                <Separator />

                {/* Custom instructions */}
                <CustomInstructionsEditor
                  value={localCustomInstructions}
                  onChange={handleCustomInstructionsChange}
                />
              </>
            )}

            {appBindingOptions.length > 0 && (
              <>
                <Separator />

                {/* App bindings */}
                <div>
                  <Label className="text-base font-semibold text-foreground">
                    Auto-switch apps
                  </Label>
                  <p className="text-xs text-muted-foreground mb-4">
                    Automatically activate this mode when any of these apps are
                    in the foreground. If multiple modes match, the first one in
                    the list wins.
                  </p>
                  <ComboboxMulti
                    options={appBindingOptions}
                    value={mode.appBindings ?? []}
                    onChange={handleAppBindingsChange}
                    placeholder="Select apps..."
                  />
                </div>
              </>
            )}

            <Separator />

            {/* Actions */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {!isActive && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSetActive}
                    disabled={setActiveModeMutation.isPending}
                  >
                    Set as active
                  </Button>
                )}
                {isActive && (
                  <Badge
                    variant="secondary"
                    className="text-xs bg-green-500/10 text-green-600"
                  >
                    Active
                  </Badge>
                )}
              </div>

              {!mode.isDefault && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                    >
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete mode</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete "{mode.name}"? This
                        action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
