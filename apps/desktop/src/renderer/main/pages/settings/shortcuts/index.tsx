import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { ShortcutInput } from "@/components/shortcut-input";
import { Separator } from "@/components/ui/separator";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function ShortcutsSettingsPage() {
  const { t } = useTranslation();
  // The injected-keys toggle only has an effect on Windows (the injected-key
  // filter lives in the Windows native hook); hide it everywhere else.
  const isWindows = window.electronAPI.platform === "win32";
  const [pushToTalkShortcut, setPushToTalkShortcut] = useState<number[]>([]);
  const [toggleRecordingShortcut, setToggleRecordingShortcut] = useState<
    number[]
  >([]);
  const [pasteLastTranscriptShortcut, setPasteLastTranscriptShortcut] =
    useState<number[]>([]);
  const [newNoteShortcut, setNewNoteShortcut] = useState<number[]>([]);
  const [draftModeShortcut, setDraftModeShortcut] = useState<number[]>([]);
  const [recordingShortcut, setRecordingShortcut] = useState<
    | "pushToTalk"
    | "toggleRecording"
    | "pasteLastTranscript"
    | "newNote"
    | "draftMode"
    | null
  >(null);

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

  const setShortcutMutation = api.settings.setShortcut.useMutation({
    onSuccess: (data, variables) => {
      if (!data.success) {
        toast.error(t(data.error.key, data.error.params));
        const cached = utils.settings.getShortcuts.getData();
        if (cached) {
          setPushToTalkShortcut(cached.pushToTalk);
          setToggleRecordingShortcut(cached.toggleRecording);
          setPasteLastTranscriptShortcut(cached.pasteLastTranscript);
          setNewNoteShortcut(cached.newNote);
          setDraftModeShortcut(cached.draftMode);
        } else {
          utils.settings.getShortcuts.invalidate();
        }
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
      const cached = utils.settings.getShortcuts.getData();
      if (cached) {
        setPushToTalkShortcut(cached.pushToTalk);
        setToggleRecordingShortcut(cached.toggleRecording);
        setPasteLastTranscriptShortcut(cached.pasteLastTranscript);
        setNewNoteShortcut(cached.newNote);
        setDraftModeShortcut(cached.draftMode);
      } else {
        utils.settings.getShortcuts.invalidate();
      }
    },
  });

  // Load shortcuts when query data is available
  useEffect(() => {
    if (shortcutsQuery.data) {
      setPushToTalkShortcut(shortcutsQuery.data.pushToTalk);
      setToggleRecordingShortcut(shortcutsQuery.data.toggleRecording);
      setPasteLastTranscriptShortcut(shortcutsQuery.data.pasteLastTranscript);
      setNewNoteShortcut(shortcutsQuery.data.newNote);
      setDraftModeShortcut(shortcutsQuery.data.draftMode);
    }
  }, [shortcutsQuery.data]);

  const handlePushToTalkChange = (shortcut: number[]) => {
    setPushToTalkShortcut(shortcut);
    setShortcutMutation.mutate({
      type: "pushToTalk",
      shortcut: shortcut,
    });
  };

  const handleToggleRecordingChange = (shortcut: number[]) => {
    setToggleRecordingShortcut(shortcut);
    setShortcutMutation.mutate({
      type: "toggleRecording",
      shortcut: shortcut,
    });
  };

  const handlePasteLastTranscriptChange = (shortcut: number[]) => {
    setPasteLastTranscriptShortcut(shortcut);
    setShortcutMutation.mutate({
      type: "pasteLastTranscript",
      shortcut: shortcut,
    });
  };

  const handleNewNoteChange = (shortcut: number[]) => {
    setNewNoteShortcut(shortcut);
    setShortcutMutation.mutate({
      type: "newNote",
      shortcut: shortcut,
    });
  };

  const handleDraftModeChange = (shortcut: number[]) => {
    setDraftModeShortcut(shortcut);
    setShortcutMutation.mutate({
      type: "draftMode",
      shortcut: shortcut,
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
                <div className="flex flex-col gap-2 items-end min-w-[260px]">
                  <ShortcutInput
                    value={pushToTalkShortcut}
                    onChange={handlePushToTalkChange}
                    isRecordingShortcut={recordingShortcut === "pushToTalk"}
                    onRecordingShortcutChange={(recording) =>
                      setRecordingShortcut(recording ? "pushToTalk" : null)
                    }
                  />
                </div>
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
                <div className="flex flex-col gap-2 items-end min-w-[260px]">
                  <ShortcutInput
                    value={toggleRecordingShortcut}
                    onChange={handleToggleRecordingChange}
                    isRecordingShortcut={
                      recordingShortcut === "toggleRecording"
                    }
                    onRecordingShortcutChange={(recording) =>
                      setRecordingShortcut(recording ? "toggleRecording" : null)
                    }
                  />
                </div>
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
                <div className="flex flex-col gap-2 items-end min-w-[260px]">
                  <ShortcutInput
                    value={pasteLastTranscriptShortcut}
                    onChange={handlePasteLastTranscriptChange}
                    isRecordingShortcut={
                      recordingShortcut === "pasteLastTranscript"
                    }
                    onRecordingShortcutChange={(recording) =>
                      setRecordingShortcut(
                        recording ? "pasteLastTranscript" : null,
                      )
                    }
                  />
                </div>
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
                <div className="flex flex-col gap-2 items-end min-w-[260px]">
                  <ShortcutInput
                    value={newNoteShortcut}
                    onChange={handleNewNoteChange}
                    isRecordingShortcut={recordingShortcut === "newNote"}
                    onRecordingShortcutChange={(recording) =>
                      setRecordingShortcut(recording ? "newNote" : null)
                    }
                  />
                </div>
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
                <div className="flex flex-col gap-2 items-end min-w-[260px]">
                  <ShortcutInput
                    value={draftModeShortcut}
                    onChange={handleDraftModeChange}
                    isRecordingShortcut={recordingShortcut === "draftMode"}
                    onRecordingShortcutChange={(recording) =>
                      setRecordingShortcut(recording ? "draftMode" : null)
                    }
                  />
                </div>
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
