import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { ShortcutInput } from "@/components/shortcut-input";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

/**
 * Push to Talk shortcut input for onboarding
 * Wraps ShortcutInput with label and handles data fetching/saving
 */
export function OnboardingShortcutInput() {
  const { t } = useTranslation();
  const [pushToTalkShortcut, setPushToTalkShortcut] = useState<number[]>([]);
  const [isRecording, setIsRecording] = useState(false);

  const utils = api.useUtils();
  const shortcutsQuery = api.settings.getShortcuts.useQuery();
  const setShortcutMutation = api.settings.setShortcut.useMutation({
    onSuccess: (data) => {
      if (!data.success) {
        toast.error(t(data.error.key, data.error.params));
        // Revert to saved value
        utils.settings.getShortcuts.invalidate();
        return;
      }

      if (data.warning) {
        toast.warning(t(data.warning.key, data.warning.params));
      }
      utils.settings.getShortcuts.invalidate();
    },
    onError: (error) => {
      console.error(error);
      toast.error(t("errors.generic"));
      // Revert to saved value
      utils.settings.getShortcuts.invalidate();
    },
  });

  // Load current shortcut
  useEffect(() => {
    if (shortcutsQuery.data) {
      setPushToTalkShortcut(shortcutsQuery.data.pushToTalk);
    }
  }, [shortcutsQuery.data]);

  const handleShortcutChange = (shortcut: number[]) => {
    setPushToTalkShortcut(shortcut);
    setShortcutMutation.mutate({
      type: "pushToTalk",
      shortcut: shortcut,
    });
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <Label className="text-base font-semibold text-foreground">
          {t("settings.shortcuts.pushToTalk.label")}
        </Label>
        <p className="text-xs text-muted-foreground mt-1">
          {t("settings.shortcuts.pushToTalk.description")}
        </p>
      </div>
      <div className="min-w-[200px] flex justify-end">
        <ShortcutInput
          value={pushToTalkShortcut}
          onChange={handleShortcutChange}
          isRecordingShortcut={isRecording}
          onRecordingShortcutChange={setIsRecording}
        />
      </div>
    </div>
  );
}
