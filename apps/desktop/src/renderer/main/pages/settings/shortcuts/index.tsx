import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ShortcutInput } from "@/components/shortcut-input";
import { Separator } from "@/components/ui/separator";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function ShortcutsSettingsPage() {
  const { t } = useTranslation();
  const [pushToTalkShortcut, setPushToTalkShortcut] = useState<number[]>([]);
  const [toggleRecordingShortcut, setToggleRecordingShortcut] = useState<
    number[]
  >([]);
  const [pasteLastTranscriptShortcut, setPasteLastTranscriptShortcut] =
    useState<number[]>([]);
  const [recordingShortcut, setRecordingShortcut] = useState<
    "pushToTalk" | "toggleRecording" | "pasteLastTranscript" | null
  >(null);

  // tRPC queries and mutations
  const shortcutsQuery = api.settings.getShortcuts.useQuery();
  const utils = api.useUtils();

  const setShortcutMutation = api.settings.setShortcut.useMutation({
    onSuccess: (data, variables) => {
      if (!data.success) {
        toast.error(t(data.error.key, data.error.params));
        const cached = utils.settings.getShortcuts.getData();
        if (cached) {
          setPushToTalkShortcut(cached.pushToTalk);
          setToggleRecordingShortcut(cached.toggleRecording);
          setPasteLastTranscriptShortcut(cached.pasteLastTranscript);
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
