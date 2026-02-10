import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Combobox } from "@/components/ui/combobox";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { AVAILABLE_LANGUAGES } from "@/constants/languages";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import type { ModeConfig } from "@/db/schema";
import { CustomInstructionsEditor } from "./CustomInstructionsEditor";
import type { ComboboxOption } from "@/components/ui/combobox";

interface ModeCardProps {
  mode: ModeConfig;
  isActive: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

const PROVIDER_ICON_MAP: Record<string, string | undefined> = {
  OpenAI: "icons/models/openai_dark.svg",
  "local-whisper": "icons/models/pc.svg",
  "Whisper (Offline)": "icons/models/pc.svg",
  Google: "icons/models/gemini.svg",
  OpenRouter: "icons/models/open_router.svg",
  Ollama: "icons/models/ollama.svg",
  Anthropic: "icons/models/anthropic.svg",
  Groq: "icons/models/groq.svg",
  Grok: "icons/models/grok.svg",
};

const PROVIDER_ICON_FRAME: Record<string, string> = {
  OpenAI: "bg-[#10A37F] border-[#10A37F]",
  "local-whisper": "bg-white border-slate-200",
  "Whisper (Offline)": "bg-white border-slate-200",
  Anthropic: "bg-[#D4B097] border-[#D4B097]",
  Google: "bg-white border-white",
  OpenRouter: "bg-[#6066F2] border-[#6066F2]",
  Ollama: "bg-white border-slate-200",
  Groq: "bg-[#F55036] border-[#F55036]",
  Grok: "bg-black border-black",
};

const PROVIDER_ICON_CLASS: Record<string, string> = {
  OpenAI: "",
  "local-whisper": "",
  "Whisper (Offline)": "",
  Anthropic: "",
  Google: "",
  OpenRouter: "brightness-0 invert",
  Ollama: "",
  Groq: "",
  Grok: "brightness-0 invert",
};

const PROVIDER_ICON_FALLBACK: Record<string, string> = {
  OpenAI: "text-white",
  "local-whisper": "text-slate-900",
  "Whisper (Offline)": "text-slate-900",
  Anthropic: "text-slate-900",
  Google: "text-slate-900",
  OpenRouter: "text-white",
  Ollama: "text-slate-900",
  Groq: "text-white",
  Grok: "text-white",
};

const getProviderFallback = (provider?: string) => {
  if (!provider) return "AI";
  if (provider === "local-whisper" || provider === "Whisper (Offline)") {
    return "WO";
  }
  const caps = provider.replace(/[^A-Z]/g, "");
  if (caps.length >= 2) return caps.slice(0, 2);
  return provider.slice(0, 2).toUpperCase();
};

const getProviderIconMeta = (provider?: string) => {
  const key = provider ?? "";
  return {
    icon: PROVIDER_ICON_MAP[key],
    iconFrameClass: PROVIDER_ICON_FRAME[key] ?? "border-border bg-background",
    iconClassName: PROVIDER_ICON_CLASS[key],
    iconFallback: getProviderFallback(provider),
    iconFallbackClassName: PROVIDER_ICON_FALLBACK[key],
  };
};

const APP_BINDINGS_LIMIT = 20;

const getAppFallback = (label: string) => {
  const normalized = label.trim();
  if (!normalized) return "AP";

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
};


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
  const [localAppBindings, setLocalAppBindings] = useState<string[]>(
    mode.appBindings ?? [],
  );
  const [appPickerOpen, setAppPickerOpen] = useState(false);
  const [appPickerQuery, setAppPickerQuery] = useState("");
  const [showActivationPulse, setShowActivationPulse] = useState(false);
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instructionsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const activationPulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const prevIsActiveRef = useRef(isActive);

  // Sync local state when mode changes externally
  useEffect(() => {
    setLocalName(mode.name);
  }, [mode.name]);

  useEffect(() => {
    setLocalCustomInstructions(mode.customInstructions);
  }, [mode.customInstructions]);

  useEffect(() => {
    setLocalAppBindings(mode.appBindings ?? []);
  }, [mode.appBindings]);

  useEffect(() => {
    const becameActive = !prevIsActiveRef.current && isActive;
    prevIsActiveRef.current = isActive;

    if (!isActive) {
      setShowActivationPulse(false);
      if (activationPulseTimeoutRef.current !== null) {
        clearTimeout(activationPulseTimeoutRef.current);
        activationPulseTimeoutRef.current = null;
      }
      return;
    }

    if (!becameActive) {
      return;
    }

    setShowActivationPulse(true);
    if (activationPulseTimeoutRef.current !== null) {
      clearTimeout(activationPulseTimeoutRef.current);
    }
    activationPulseTimeoutRef.current = setTimeout(() => {
      setShowActivationPulse(false);
      activationPulseTimeoutRef.current = null;
    }, 750);
  }, [isActive]);

  // Language models query for formatting model selection
  const languageModelsQuery = api.models.getModels.useQuery({
    type: "language",
  });
  const languageModels = languageModelsQuery.data || [];

  // Speech models available for mode selection
  const speechModelsQuery = api.models.getModels.useQuery({
    type: "speech",
    selectable: true,
  });
  const speechModels = speechModelsQuery.data || [];

  const formattingOptions = useMemo<ComboboxOption[]>(() => {
    const languageOptions = languageModels.map((model) => ({
      value: model.id,
      label: model.name || model.id,
      ...getProviderIconMeta(model.provider),
    }));

    return languageOptions;
  }, [languageModels]);
  const hasFormattingOptions = formattingOptions.length > 0;
  const isFormattingOptionsLoading =
    (languageModelsQuery.isLoading || languageModelsQuery.isFetching) &&
    languageModels.length === 0;
  const hasFormattingOptionsError =
    !!languageModelsQuery.error && !isFormattingOptionsLoading;
  const formattingDisabledReason = hasFormattingOptions
    ? null
    : isFormattingOptionsLoading
      ? "Loading synced language models..."
      : hasFormattingOptionsError
        ? "Couldn't load synced language models."
        : "No synced language models. Sync one in AI Models to enable formatting.";

  // Installed apps query for app bindings
  const installedAppsQuery = api.settings.getInstalledApps.useQuery();
  const installedApps = installedAppsQuery.data ?? [];
  const installedAppOptions = useMemo(
    () =>
      installedApps.map((a) => ({
        value: a.bundleId,
        label: a.name,
        icon: a.icon,
      })),
    [installedApps],
  );

  const appBindingOptions = useMemo(() => {
    // Preserve existing bindings that may no longer be installed
    const installedIds = new Set(installedAppOptions.map((a) => a.value));
    const existingBindings = localAppBindings
      .filter((id) => !installedIds.has(id))
      .map((id) => ({ value: id, label: id, icon: undefined }));

    return [...installedAppOptions, ...existingBindings];
  }, [installedAppOptions, localAppBindings]);

  const selectedAppOptions = useMemo(
    () =>
      localAppBindings.map((id) => {
        return (
          appBindingOptions.find((option) => option.value === id) ?? {
            value: id,
            label: id,
            icon: undefined,
          }
        );
      }),
    [appBindingOptions, localAppBindings],
  );

  const filteredInstalledAppOptions = useMemo(() => {
    const query = appPickerQuery.trim().toLowerCase();
    if (!query) return installedAppOptions;
    return installedAppOptions.filter(
      (option) =>
        option.label.toLowerCase().includes(query) ||
        option.value.toLowerCase().includes(query),
    );
  }, [appPickerQuery, installedAppOptions]);

  const isAtAppBindingLimit = localAppBindings.length >= APP_BINDINGS_LIMIT;
  const shouldShowAppBindingsSection =
    installedAppsQuery.isLoading || appBindingOptions.length > 0;

  const speechModelOptions = useMemo<ComboboxOption[]>(() => {
    return speechModels.map((model) => {
      const name = model.name || model.id;
      return {
        value: model.id,
        label: name,
        ...getProviderIconMeta(model.provider),
      };
    });
  }, [speechModels]);

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

  const handleLanguageChange = useCallback(
    (selectedLanguage: string) => {
      updateModeMutation.mutate({
        modeId: mode.id,
        dictation: {
          autoDetectEnabled: selectedLanguage === "auto",
          selectedLanguage,
        },
      });
    },
    [mode.id, updateModeMutation],
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
          fallbackModelId: modelId,
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
        speechModelId: value || null,
      });
    },
    [mode.id, updateModeMutation],
  );

  const handleAppBindingsChange = useCallback(
    (values: string[]) => {
      const dedupedValues = Array.from(new Set(values));
      setLocalAppBindings(dedupedValues);
      updateModeMutation.mutate({
        modeId: mode.id,
        appBindings: dedupedValues.length > 0 ? dedupedValues : null,
      });
    },
    [mode.id, updateModeMutation],
  );

  const handleAddAppBinding = useCallback(
    (bundleId: string) => {
      if (localAppBindings.includes(bundleId)) {
        setAppPickerOpen(false);
        setAppPickerQuery("");
        return;
      }
      if (isAtAppBindingLimit) {
        toast.error(`You can add up to ${APP_BINDINGS_LIMIT} apps per mode`);
        return;
      }
      handleAppBindingsChange([...localAppBindings, bundleId]);
      setAppPickerOpen(false);
      setAppPickerQuery("");
    },
    [handleAppBindingsChange, isAtAppBindingLimit, localAppBindings],
  );

  const handleRemoveAppBinding = useCallback(
    (bundleId: string) => {
      handleAppBindingsChange(
        localAppBindings.filter((value) => value !== bundleId),
      );
    },
    [handleAppBindingsChange, localAppBindings],
  );

  const handleAppPickerOpenChange = useCallback((open: boolean) => {
    setAppPickerOpen(open);
    if (!open) {
      setAppPickerQuery("");
    }
  }, []);

  const handleSetActive = useCallback(() => {
    if (isActive || setActiveModeMutation.isPending) {
      return;
    }
    setActiveModeMutation.mutate({ modeId: mode.id });
  }, [isActive, mode.id, setActiveModeMutation]);

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
      if (activationPulseTimeoutRef.current !== null)
        clearTimeout(activationPulseTimeoutRef.current);
    };
  }, []);

  // Badge info
  const selectedLanguageValue = mode.dictation.autoDetectEnabled
    ? "auto"
    : mode.dictation.selectedLanguage;
  const languageLabel =
    AVAILABLE_LANGUAGES.find((l) => l.value === selectedLanguageValue)?.label ||
    selectedLanguageValue;

  const selectedFormattingModel = mode.formatterConfig.enabled
    ? languageModels.find((model) => model.id === mode.formatterConfig.modelId)
    : undefined;

  const selectedSpeechModel = mode.speechModelId
    ? speechModels.find((model) => model.id === mode.speechModelId)
    : undefined;

  const formattingMeta = selectedFormattingModel
    ? getProviderIconMeta(selectedFormattingModel.provider)
    : null;
  const speechMeta = selectedSpeechModel
    ? getProviderIconMeta(selectedSpeechModel.provider)
    : null;

  const renderProviderIcon = (
    meta: ReturnType<typeof getProviderIconMeta> | null,
    title?: string,
  ) => {
    if (!meta) return null;
    return (
      <span
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-md border",
          meta.iconFrameClass,
        )}
        title={title}
      >
        {meta.icon ? (
          <img
            src={meta.icon}
            alt={title ?? meta.iconFallback ?? "Model"}
            className={cn("h-4 w-4 object-contain", meta.iconClassName)}
          />
        ) : (
          <span className={cn("text-[9px] font-semibold", meta.iconFallbackClassName)}>
            {meta.iconFallback}
          </span>
        )}
      </span>
    );
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
      <div className="border border-border rounded-lg">
        <div
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors rounded-lg cursor-pointer"
          onClick={onToggleExpand}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggleExpand();
            }
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleSetActive();
              }}
              onKeyDown={(event) => event.stopPropagation()}
              disabled={isActive || setActiveModeMutation.isPending}
              className={cn(
                "relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors",
                !isActive && "border border-border hover:border-muted-foreground/50",
                (isActive || setActiveModeMutation.isPending) &&
                  "cursor-default",
              )}
              aria-label={
                isActive
                  ? `"${mode.name}" is active`
                  : `Set "${mode.name}" as active`
              }
              aria-pressed={isActive}
            >
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute h-4 w-4 rounded-full border border-green-400/45 bg-green-500/10 shadow-[0_0_8px_rgba(34,197,94,0.28)] mode-active-ring motion-reduce:animate-none"
                />
              )}
              {isActive && showActivationPulse && (
                <span
                  aria-hidden="true"
                  className="absolute h-4 w-4 rounded-full bg-green-500/28 mode-active-dot-ping motion-reduce:hidden"
                />
              )}
              {isActive && (
                <span className="relative z-[1] h-2.5 w-2.5 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]" />
              )}
            </button>
            {isExpanded && !mode.isDefault ? (
              <div
                className="w-56"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <Input
                  value={localName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Mode name"
                  className="h-8"
                />
              </div>
            ) : (
              <span className="font-medium text-sm truncate">{mode.name}</span>
            )}
            <Badge
              variant="secondary"
              className="bg-white/12 text-foreground text-[10px] px-1.5 py-0 font-semibold"
            >
              {languageLabel}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            {(selectedFormattingModel || selectedSpeechModel) && (
              <div className="flex items-center gap-2">
                {selectedFormattingModel &&
                  renderProviderIcon(
                    formattingMeta,
                    selectedFormattingModel.name,
                  )}
                {selectedSpeechModel &&
                  renderProviderIcon(speechMeta, selectedSpeechModel.name)}
              </div>
            )}
            {(selectedFormattingModel || selectedSpeechModel) &&
              localAppBindings.length > 0 && (
                <span className="h-6 w-px bg-white/30" aria-hidden="true" />
              )}
            {localAppBindings.length > 0 && (
              <div className="flex items-center gap-2">
                {localAppBindings.slice(0, 5).map((bundleId) => {
                  const appOption = appBindingOptions.find(
                    (o) => o.value === bundleId,
                  );
                  return appOption?.icon ? (
                    <img
                      key={bundleId}
                      src={appOption.icon}
                      alt={appOption.label}
                      title={appOption.label}
                      className="h-6 w-6 rounded-sm"
                    />
                  ) : null;
                })}
                {localAppBindings.length > 5 && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1 py-0"
                  >
                    +{localAppBindings.length - 5}
                  </Badge>
                )}
              </div>
            )}
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                isExpanded && "rotate-180",
              )}
            />
          </div>
        </div>

        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-6">
            <Separator />

            {/* Transcription settings */}
            <div>
              <Label className="text-base font-semibold text-foreground">
                Transcription
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                Configure language detection and speech recognition model.
              </p>
              <div className="mt-4 space-y-4">
                <div>
                  <Label className="text-sm font-medium text-foreground mb-2 block">
                    Language
                  </Label>
                  <Combobox
                    options={AVAILABLE_LANGUAGES}
                    value={selectedLanguageValue}
                    onChange={handleLanguageChange}
                    placeholder="Select language..."
                  />
                </div>

                {/* Speech model settings */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-2 block">
                    Speech model
                  </Label>
                  <Combobox
                    options={speechModelOptions}
                    value={mode.speechModelId ?? ""}
                    onChange={handleSpeechModelChange}
                    placeholder="Select a speech model..."
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Formatting settings */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <Label className="text-base font-semibold text-foreground">
                    Formatting
                  </Label>
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
                        disabled={!hasFormattingOptions}
                      />
                    </div>
                  </TooltipTrigger>
                  {!hasFormattingOptions && formattingDisabledReason && (
                      <TooltipContent className="max-w-sm text-center">
                        {formattingDisabledReason}
                      </TooltipContent>
                    )}
                </Tooltip>
              </div>

              {!hasFormattingOptions && (
                <Link
                  to="/settings/ai-models"
                  className="inline-block"
                >
                  <Button variant="link" className="text-xs px-0">
                    <Plus className="w-4 h-4" />
                    Manage language models
                  </Button>
                </Link>
              )}
              {!hasFormattingOptions && (
                <div className="mt-2 flex items-center gap-2">
                  <p
                    className={cn(
                      "text-xs",
                      hasFormattingOptionsError
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {formattingDisabledReason}
                  </p>
                  {hasFormattingOptionsError && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => void languageModelsQuery.refetch()}
                      disabled={languageModelsQuery.isFetching}
                    >
                      Retry
                    </Button>
                  )}
                </div>
              )}

              {mode.formatterConfig.enabled && (
                <div className="mt-4 space-y-4">
                  <div>
                    <Label className="text-sm font-medium text-foreground mb-2 block">
                      Formatting model
                    </Label>
                    <Combobox
                      options={formattingOptions}
                      value={mode.formatterConfig.modelId ?? ""}
                      onChange={handleFormattingModelChange}
                      placeholder="Select a model..."
                    />
                  </div>
                  <CustomInstructionsEditor
                    value={localCustomInstructions}
                    onChange={handleCustomInstructionsChange}
                  />
                </div>
              )}
            </div>

            {shouldShowAppBindingsSection && (
              <>
                <Separator />

                {/* App bindings */}
                <div>
                  <Label className="text-base font-semibold text-foreground">
                    Activate when using
                  </Label>
                  <p className="text-xs text-muted-foreground mb-4">
                    Automatically activate this mode when any of these apps are
                    in the foreground. If multiple modes match, the first one in
                    the list wins.
                  </p>
                  <div className="mt-4 flex flex-wrap items-start gap-4">
                    <Dialog
                      open={appPickerOpen}
                      onOpenChange={handleAppPickerOpenChange}
                    >
                      <DialogTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "group flex w-[92px] flex-col items-center gap-2 text-center transition-opacity",
                            (installedAppsQuery.isLoading ||
                              installedAppOptions.length === 0 ||
                              isAtAppBindingLimit) &&
                              "cursor-not-allowed opacity-60",
                          )}
                          disabled={
                            installedAppsQuery.isLoading ||
                            installedAppOptions.length === 0 ||
                            isAtAppBindingLimit
                          }
                        >
                          <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border/70 bg-muted/30">
                            <Plus className="h-6 w-6 text-primary" />
                          </span>
                          <span className="text-sm font-medium">Add App</span>
                        </button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-3xl">
                        <DialogHeader>
                          <DialogTitle>Select apps</DialogTitle>
                          <DialogDescription>
                            Add one app at a time to activate this mode.
                          </DialogDescription>
                        </DialogHeader>
                        <Input
                          value={appPickerQuery}
                          onChange={(event) =>
                            setAppPickerQuery(event.target.value)
                          }
                          placeholder="Search apps..."
                          className="h-10"
                        />
                        <div className="max-h-[420px] overflow-y-auto pr-1">
                          {installedAppsQuery.isLoading ? (
                            <p className="text-sm text-muted-foreground py-6 text-center">
                              Loading installed apps...
                            </p>
                          ) : filteredInstalledAppOptions.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-6 text-center">
                              {appPickerQuery
                                ? "No apps match your search."
                                : "No installed apps found."}
                            </p>
                          ) : (
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                              {filteredInstalledAppOptions.map((app) => {
                                const isSelected = localAppBindings.includes(
                                  app.value,
                                );
                                const isDisabled =
                                  isSelected || isAtAppBindingLimit;
                                return (
                                  <button
                                    key={app.value}
                                    type="button"
                                    disabled={isDisabled}
                                    onClick={() =>
                                      handleAddAppBinding(app.value)
                                    }
                                    className={cn(
                                      "group relative flex flex-col items-center gap-2 rounded-xl px-2 py-3 text-center transition-colors",
                                      isSelected
                                        ? "bg-primary/10"
                                        : "hover:bg-muted/60",
                                      isDisabled &&
                                        !isSelected &&
                                        "cursor-not-allowed opacity-50",
                                    )}
                                  >
                                    <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-border/70 bg-muted/30 p-2">
                                      {app.icon ? (
                                        <img
                                          src={app.icon}
                                          alt={app.label}
                                          className="h-10 w-10 rounded-xl object-contain"
                                        />
                                      ) : (
                                        <span className="text-xs font-semibold text-muted-foreground">
                                          {getAppFallback(app.label)}
                                        </span>
                                      )}
                                      {isSelected && (
                                        <span className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                          <Check className="h-3 w-3" />
                                        </span>
                                      )}
                                    </span>
                                    <span className="w-full truncate text-xs font-medium">
                                      {app.label}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        {isAtAppBindingLimit && (
                          <p className="text-xs text-muted-foreground">
                            You can add up to {APP_BINDINGS_LIMIT} apps per
                            mode.
                          </p>
                        )}
                      </DialogContent>
                    </Dialog>

                    {selectedAppOptions.map((app) => (
                      <div
                        key={app.value}
                        className="group flex w-[92px] flex-col items-center gap-2"
                      >
                        <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-border/70 bg-muted/30 p-2">
                          <button
                            type="button"
                            onClick={() => handleRemoveAppBinding(app.value)}
                            className="absolute -right-1 -top-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-slate-700 opacity-0 shadow transition-opacity hover:text-slate-900 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                            aria-label={`Remove ${app.label}`}
                            title={`Remove ${app.label}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                          {app.icon ? (
                            <img
                              src={app.icon}
                              alt={app.label}
                              className="h-11 w-11 rounded-xl object-contain"
                            />
                          ) : (
                            <span className="text-xs font-semibold text-muted-foreground">
                              {getAppFallback(app.label)}
                            </span>
                          )}
                        </span>
                        <span
                          className="w-full truncate text-center text-xs font-medium"
                          title={app.label}
                        >
                          {app.label}
                        </span>
                      </div>
                    ))}
                  </div>
                  {selectedAppOptions.length === 0 &&
                    !installedAppsQuery.isLoading && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        No apps selected yet.
                      </p>
                    )}
                </div>
              </>
            )}

            {!mode.isDefault && (
              <>
                <Separator />
                <div className="flex justify-end">
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
                </div>
              </>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
