import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { ShortcutInput } from "@/components/shortcut-input";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

/** Which shortcut binding the input edits; labels come from the matching
 *  settings.shortcuts.* strings. */
const BINDING_LABELS = {
  pushToTalk: "settings.shortcuts.pushToTalk",
  draftMode: "settings.shortcuts.draft",
} as const;

type Binding = keyof typeof BINDING_LABELS;

/**
 * Shortcut input for onboarding (push-to-talk by default, or the Draft
 * binding). Wraps ShortcutInput with label and handles data fetching/saving.
 */
export function OnboardingShortcutInput({
  binding = "pushToTalk",
}: {
  binding?: Binding;
}) {
  const { t } = useTranslation();
  const [shortcut, setShortcut] = useState<number[]>([]);
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
      setShortcut(shortcutsQuery.data[binding]);
    }
  }, [shortcutsQuery.data, binding]);

  const handleShortcutChange = (newShortcut: number[]) => {
    setShortcut(newShortcut);
    setShortcutMutation.mutate({
      type: binding,
      shortcut: newShortcut,
    });
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <Label className="text-base font-semibold text-foreground">
          {t(`${BINDING_LABELS[binding]}.label`)}
        </Label>
        <p className="text-xs text-muted-foreground mt-1">
          {t(`${BINDING_LABELS[binding]}.description`)}
        </p>
      </div>
      <div className="min-w-[200px] flex justify-end">
        <ShortcutInput
          value={shortcut}
          onChange={handleShortcutChange}
          isRecordingShortcut={isRecording}
          onRecordingShortcutChange={setIsRecording}
        />
      </div>
    </div>
  );
}
