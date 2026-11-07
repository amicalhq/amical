import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, Plus } from "lucide-react";
import { ShortcutInput } from "@/components/shortcut-input";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  canUnassignShortcut,
  type ShortcutBindings,
  type ShortcutsConfig,
  type ShortcutType,
} from "@/utils/shortcut-validation";

const EMPTY_SHORTCUTS: ShortcutsConfig = {
  pushToTalk: [],
  toggleRecording: [],
  pasteLastTranscript: [],
  newNote: [],
  draftMode: [],
};

type RecordingBinding = { type: ShortcutType; index: number } | null;

export function ShortcutBindingsEditor({
  type,
  bindings,
  recordingBinding,
  onRecordingBindingChange,
  onChange,
}: {
  type: ShortcutType;
  bindings: ShortcutBindings;
  recordingBinding: RecordingBinding;
  onRecordingBindingChange: (binding: RecordingBinding) => void;
  onChange: (bindings: ShortcutBindings) => void;
}) {
  const { t } = useTranslation();
  const setRecordingStateMutation =
    api.settings.setShortcutRecordingState.useMutation();
  const assignedBindings = bindings.filter((binding) => binding.length > 0);
  const addingIndex = assignedBindings.length;
  const isAdding =
    recordingBinding?.type === type && recordingBinding.index === addingIndex;

  const updateBinding = (index: number, shortcut: number[]) => {
    if (shortcut.length === 0) {
      onChange(
        assignedBindings.filter((_, bindingIndex) => bindingIndex !== index),
      );
      return;
    }

    if (index === assignedBindings.length) {
      onChange([...assignedBindings, shortcut]);
      return;
    }

    onChange(
      assignedBindings.map((binding, bindingIndex) =>
        bindingIndex === index ? shortcut : binding,
      ),
    );
  };

  const recorder = (shortcut: number[], index: number) => (
    <ShortcutInput
      key={`${type}-${index}`}
      value={shortcut}
      onChange={(nextShortcut) => updateBinding(index, nextShortcut)}
      isRecordingShortcut={
        recordingBinding?.type === type && recordingBinding.index === index
      }
      onRecordingShortcutChange={(recording) =>
        onRecordingBindingChange(recording ? { type, index } : null)
      }
      allowUnassign={canUnassignShortcut(type) || assignedBindings.length > 1}
    />
  );

  return (
    <div className="flex min-w-[260px] flex-col items-end gap-2">
      {assignedBindings.length === 0
        ? recorder([], 0)
        : assignedBindings.map(recorder)}
      {assignedBindings.length > 0 && isAdding && recorder([], addingIndex)}
      {assignedBindings.length > 0 && !isAdding && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onRecordingBindingChange({ type, index: addingIndex });
            setRecordingStateMutation.mutate(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("settings.shortcuts.input.add")}
        </Button>
      )}
    </div>
  );
}

export function ShortcutsSettingsPage() {
  const { t } = useTranslation();
  // The injected-keys toggle only has an effect on Windows (the injected-key
  // filter lives in the Windows native hook); hide it everywhere else.
  const isWindows = window.electronAPI.platform === "win32";
  const [shortcuts, setShortcuts] = useState<ShortcutsConfig>(EMPTY_SHORTCUTS);
  const [recordingBinding, setRecordingBinding] =
    useState<RecordingBinding>(null);

  // tRPC queries and mutations
  const shortcutsQuery = api.settings.getShortcuts.useQuery();
  const utils = api.useUtils();

  // Allow-injected-keys preference (Windows only, see isWindows above).
  const preferencesQuery = api.settings.getPreferences.useQuery();
  const allowInjectedKeys = preferencesQuery.data?.allowInjectedKeys ?? false;
  const updatePreferencesMutation = api.settings.updatePreferences.useMutation({
    onSuccess: () => utils.settings.getPreferences.invalidate(),
    onError: () => {
      toast.error(t("errors.generic"));
      utils.settings.getPreferences.invalidate();
    },
  });
  const handleAllowInjectedKeysChange = (checked: boolean) => {
    updatePreferencesMutation.mutate({ allowInjectedKeys: checked });
  };
  const handleOpenInjectedKeysDocs = () => {
    window.electronAPI.openExternal(
      "https://amical.ai/docs/custom-hotkeys#allow-injected-keystrokes-windows",
    );
  };

  const restoreCachedShortcuts = () => {
    const cached = utils.settings.getShortcuts.getData();
    if (cached) {
      setShortcuts(cached);
    } else {
      utils.settings.getShortcuts.invalidate();
    }
  };

  const setShortcutMutation = api.settings.setShortcutBindings.useMutation({
    onSuccess: (data, variables) => {
      if (!data.success) {
        toast.error(t(data.error.key, data.error.params));
        restoreCachedShortcuts();
        return;
      }

      utils.settings.getShortcuts.invalidate();

      // Show warning if there is one
      if (data.warning) {
        toast.warning(t(data.warning.key, data.warning.params));
      } else {
        const successMessages = {
          pushToTalk: t("settings.shortcuts.toast.pushToTalkUpdated"),
          toggleRecording: t("settings.shortcuts.toast.handsFreeUpdated"),
          pasteLastTranscript: t(
            "settings.shortcuts.toast.pasteLastTranscriptUpdated",
          ),
          newNote: t("settings.shortcuts.toast.newNoteUpdated"),
          draftMode: t("settings.shortcuts.toast.draftModeUpdated"),
        } as const;
        toast.success(successMessages[variables.type]);
      }
    },
    onError: (error) => {
      console.error(error);
      toast.error(t("errors.generic"));
      restoreCachedShortcuts();
    },
  });

  // Load shortcuts when query data is available
  useEffect(() => {
    if (shortcutsQuery.data) {
      setShortcuts(shortcutsQuery.data);
    }
  }, [shortcutsQuery.data]);

  const handleBindingsChange = (
    type: ShortcutType,
    bindings: ShortcutBindings,
  ) => {
    setShortcuts((current) => ({ ...current, [type]: bindings }));
    setShortcutMutation.mutate({
      type,
      bindings,
    });
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-bold">{t("settings.shortcuts.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("settings.shortcuts.description")}
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-8">
            <div>
              <div className="flex flex-col md:flex-row md:justify-between gap-4">
                <div>
                  <Label className="text-base font-semibold text-foreground">
                    {t("settings.shortcuts.pushToTalk.label")}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1 max-w-md">
                    {t("settings.shortcuts.pushToTalk.description")}
                  </p>
                </div>
                <ShortcutBindingsEditor
                  type="pushToTalk"
                  bindings={shortcuts.pushToTalk}
                  recordingBinding={recordingBinding}
                  onRecordingBindingChange={setRecordingBinding}
                  onChange={(bindings) =>
                    handleBindingsChange("pushToTalk", bindings)
                  }
                />
              </div>
              <Separator className="my-4" />
            </div>

            <div>
              <div className="flex flex-col md:flex-row md:justify-between gap-4">
                <div>
                  <Label className="text-base font-semibold text-foreground">
                    {t("settings.shortcuts.handsFree.label")}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1 max-w-md">
                    {t("settings.shortcuts.handsFree.description")}
                  </p>
                </div>
                <ShortcutBindingsEditor
                  type="toggleRecording"
                  bindings={shortcuts.toggleRecording}
                  recordingBinding={recordingBinding}
                  onRecordingBindingChange={setRecordingBinding}
                  onChange={(bindings) =>
                    handleBindingsChange("toggleRecording", bindings)
                  }
                />
              </div>
            </div>

            <div>
              <Separator className="my-4" />
              <div className="flex flex-col md:flex-row md:justify-between gap-4">
                <div>
                  <Label className="text-base font-semibold text-foreground">
                    {t("settings.shortcuts.pasteLastTranscript.label")}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1 max-w-md">
                    {t("settings.shortcuts.pasteLastTranscript.description")}
                  </p>
                </div>
                <ShortcutBindingsEditor
                  type="pasteLastTranscript"
                  bindings={shortcuts.pasteLastTranscript}
                  recordingBinding={recordingBinding}
                  onRecordingBindingChange={setRecordingBinding}
                  onChange={(bindings) =>
                    handleBindingsChange("pasteLastTranscript", bindings)
                  }
                />
              </div>
            </div>

            <div>
              <Separator className="my-4" />
              <div className="flex flex-col md:flex-row md:justify-between gap-4">
                <div>
                  <Label className="text-base font-semibold text-foreground">
                    {t("settings.shortcuts.newNote.label")}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1 max-w-md">
                    {t("settings.shortcuts.newNote.description")}
                  </p>
                </div>
                <ShortcutBindingsEditor
                  type="newNote"
                  bindings={shortcuts.newNote}
                  recordingBinding={recordingBinding}
                  onRecordingBindingChange={setRecordingBinding}
                  onChange={(bindings) =>
                    handleBindingsChange("newNote", bindings)
                  }
                />
              </div>
            </div>

            <div>
              <Separator className="my-4" />
              <div className="flex flex-col md:flex-row md:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Label className="text-base font-semibold text-foreground">
                      {t("settings.shortcuts.draft.label")}
                    </Label>
                    {/* Reuse the app's shared (localized) alpha-stage badge. */}
                    <Badge className="text-[10px] px-1.5 py-0 bg-orange-500/20 text-orange-500 hover:bg-orange-500/20">
                      {t("settings.dictation.formatting.badge")}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 max-w-md">
                    {t("settings.shortcuts.draft.description")}
                  </p>
                </div>
                <ShortcutBindingsEditor
                  type="draftMode"
                  bindings={shortcuts.draftMode}
                  recordingBinding={recordingBinding}
                  onRecordingBindingChange={setRecordingBinding}
                  onChange={(bindings) =>
                    handleBindingsChange("draftMode", bindings)
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {isWindows && (
          <Card>
            <CardContent className="space-y-4">
              <div className="flex flex-col md:flex-row md:justify-between gap-4">
                <div>
                  <Label className="text-base font-semibold text-foreground">
                    {t("settings.shortcuts.allowInjectedKeys.label")}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1 max-w-md">
                    {t("settings.shortcuts.allowInjectedKeys.description")}
                  </p>
                </div>
                <div className="flex items-center min-w-[260px] md:justify-end">
                  <Switch
                    checked={allowInjectedKeys}
                    onCheckedChange={handleAllowInjectedKeysChange}
                    disabled={updatePreferencesMutation.isPending}
                    aria-label={t("settings.shortcuts.allowInjectedKeys.label")}
                  />
                </div>
              </div>
              <Alert>
                <Info />
                <AlertDescription>
                  <p>
                    {t("settings.shortcuts.allowInjectedKeys.callout")}{" "}
                    <button
                      type="button"
                      onClick={handleOpenInjectedKeysDocs}
                      className="text-primary hover:underline"
                    >
                      {t("settings.shortcuts.allowInjectedKeys.learnMore")}
                    </button>
                  </p>
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
