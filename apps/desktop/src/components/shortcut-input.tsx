import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, X } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { getKeyFromKeycode, keycodeToDisplay } from "@/utils/keycode-map";
import {
  handleActiveKeysEmission,
  initialShortcutRecordingState,
} from "@/utils/shortcut-recording";
import { useTranslation } from "react-i18next";

interface ShortcutInputProps {
  value?: number[];
  onChange: (value: number[]) => void;
  isRecordingShortcut?: boolean;
  onRecordingShortcutChange: (recording: boolean) => void;
  allowUnassign: boolean;
}

const MODIFIER_KEYS = new Set([
  "Cmd",
  "RCmd",
  "Win",
  "RWin",
  "Ctrl",
  "RCtrl",
  "Alt",
  "RAlt",
  "Shift",
  "RShift",
  "Fn",
]);
const MAX_KEY_COMBINATION_LENGTH = 4;

type ValidationResult = {
  valid: boolean;
  shortcut?: number[];
  error?: {
    key: string;
    params?: Record<string, string | number>;
  };
};

function isModifierKeycode(keycode: number): boolean {
  const name = getKeyFromKeycode(keycode);
  return name ? MODIFIER_KEYS.has(name) : false;
}

/**
 * Basic format validation only - business logic validation happens on backend
 */
function validateShortcutFormat(keys: number[]): ValidationResult {
  if (keys.length === 0) {
    return {
      valid: false,
      error: { key: "settings.shortcuts.validation.noKeysDetected" },
    };
  }

  if (keys.length > MAX_KEY_COMBINATION_LENGTH) {
    return {
      valid: false,
      error: {
        key: "settings.shortcuts.validation.tooManyKeys",
        params: { max: MAX_KEY_COMBINATION_LENGTH },
      },
    };
  }

  const modifierKeys = keys.filter((keycode) => isModifierKeycode(keycode));
  const regularKeys = keys.filter((keycode) => !isModifierKeycode(keycode));

  // Return array format: modifiers first, then regular keys
  return {
    valid: true,
    shortcut: [...modifierKeys, ...regularKeys],
  };
}

function RecordingDisplay({
  activeKeys,
  onCancel,
  pressKeysText,
  cancelLabel,
}: {
  activeKeys: number[];
  onCancel: () => void;
  pressKeysText: string;
  cancelLabel: string;
}) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-md bg-primary/5 px-3 py-1 ring-2 ring-primary"
      tabIndex={0}
    >
      {activeKeys.length > 0 ? (
        <div className="flex items-center gap-1">
          {activeKeys.map((key, index) => (
            <kbd
              key={index}
              className="px-1.5 py-0.5 text-xs bg-background rounded border"
            >
              {keycodeToDisplay(key)}
            </kbd>
          ))}
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">{pressKeysText}</span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
        onClick={onCancel}
        aria-label={cancelLabel}
        title={cancelLabel}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

function ShortcutDisplay({
  value,
  onEdit,
  unassignedText,
  editLabel,
}: {
  value?: number[];
  onEdit: () => void;
  unassignedText: string;
  editLabel: string;
}) {
  const hasShortcut = !!value?.length;

  return (
    <>
      {hasShortcut ? (
        <div
          onClick={onEdit}
          className="flex cursor-pointer items-center gap-1"
        >
          {value.map((key, index) => (
            <kbd
              key={index}
              className="inline-flex items-center rounded-md border bg-muted px-2 py-0.5 font-mono text-sm transition-colors hover:bg-muted/70"
            >
              {keycodeToDisplay(key)}
            </kbd>
          ))}
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">{unassignedText}</span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={onEdit}
        aria-label={editLabel}
        title={editLabel}
      >
        <Pencil className="h-3 w-3" />
      </Button>
    </>
  );
}

export function ShortcutInput({
  value,
  onChange,
  isRecordingShortcut = false,
  onRecordingShortcutChange,
  allowUnassign,
}: ShortcutInputProps) {
  const { t } = useTranslation();
  const [activeKeys, setActiveKeys] = useState<number[]>([]);
  // Recording state lives in a ref (not closure-captured state) so rapid
  // emissions can never read a stale snapshot between renders.
  const recordingStateRef = useRef(initialShortcutRecordingState);
  const setRecordingStateMutation =
    api.settings.setShortcutRecordingState.useMutation();

  const handleStartRecording = () => {
    onRecordingShortcutChange(true);
    setRecordingStateMutation.mutate(true);
  };

  const handleCancelRecording = () => {
    onRecordingShortcutChange(false);
    setActiveKeys([]);
    setRecordingStateMutation.mutate(false);
  };

  const handleClearShortcut = () => {
    handleCancelRecording();
    onChange([]);
  };

  // Subscribe to key events when recording. Keys held before recording
  // started (e.g. the previous chord still being released after a quick
  // re-edit) are ignored until the set drains to empty — see
  // handleActiveKeysEmission.
  api.settings.activeKeysUpdates.useSubscription(undefined, {
    enabled: isRecordingShortcut,
    onData: (keys: number[]) => {
      const { state, completedKeys } = handleActiveKeysEmission(
        recordingStateRef.current,
        keys,
      );
      recordingStateRef.current = state;
      setActiveKeys(state.activeKeys);

      // A key was released: validate the combination held just before it
      if (completedKeys) {
        const result = validateShortcutFormat(completedKeys);

        if (result.valid && result.shortcut) {
          // Basic format is valid - let parent handle backend validation
          onChange(result.shortcut);
        } else {
          toast.error(
            result.error
              ? t(result.error.key, result.error.params)
              : t("settings.shortcuts.validation.invalidKeyCombination"),
          );
        }

        onRecordingShortcutChange(false);
        setRecordingStateMutation.mutate(false);
      }
    },
    onError: (error) => {
      console.error("Error subscribing to active keys", error);
    },
  });

  // Reset state when recording starts
  useEffect(() => {
    if (isRecordingShortcut) {
      recordingStateRef.current = initialShortcutRecordingState;
      setActiveKeys([]);
    }
  }, [isRecordingShortcut]);

  return (
    <TooltipProvider>
      <div className="inline-flex items-center gap-2">
        {isRecordingShortcut ? (
          <>
            <RecordingDisplay
              activeKeys={activeKeys}
              onCancel={handleCancelRecording}
              pressKeysText={t("settings.shortcuts.input.pressKeys")}
              cancelLabel={t("settings.shortcuts.input.cancel")}
            />
            {allowUnassign && !!value?.length && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                onClick={handleClearShortcut}
                aria-label={t("settings.shortcuts.input.clear")}
                title={t("settings.shortcuts.input.clear")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        ) : (
          <ShortcutDisplay
            value={value}
            onEdit={handleStartRecording}
            unassignedText={t("settings.shortcuts.input.unassigned")}
            editLabel={t("settings.shortcuts.input.edit")}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
