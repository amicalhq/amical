import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Pencil, X } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { getKeyFromKeycode } from "@/utils/keycode-map";
import { useTranslation } from "react-i18next";

interface ShortcutInputProps {
  value?: number[];
  onChange: (value: number[]) => void;
  isRecordingShortcut?: boolean;
  onRecordingShortcutChange: (recording: boolean) => void;
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

function keycodeToDisplay(keycode: number): string {
  return getKeyFromKeycode(keycode) ?? `Key${keycode}`;
}

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
}: {
  activeKeys: number[];
  onCancel: () => void;
  pressKeysText: string;
}) {
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1 bg-muted rounded-md ring-2 ring-primary"
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
        className="h-6 w-6 p-0"
        onClick={onCancel}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

function ShortcutDisplay({
  value,
  onEdit,
}: {
  value?: number[];
  onEdit: () => void;
}) {
  // Format array as display string (e.g., ["Fn", "Space"] -> "Fn+Space")
  const displayValue = value?.length
    ? value.map((key) => keycodeToDisplay(key)).join("+")
    : undefined;

  return (
    <>
      {displayValue && (
        <kbd
          onClick={onEdit}
          className="inline-flex items-center px-3 py-1 bg-muted hover:bg-muted/70 rounded-md text-sm font-mono cursor-pointer transition-colors"
        >
          {displayValue}
        </kbd>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={onEdit}
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
}: ShortcutInputProps) {
  const { t } = useTranslation();
  const [activeKeys, setActiveKeys] = useState<number[]>([]);
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

  // Subscribe to key events when recording
  // Note: activeKeys closure is fresh on each render because useSubscription
  // updates its callback reference, so previousKeys correctly captures the
  // previous state value when onData fires.
  api.settings.activeKeysUpdates.useSubscription(undefined, {
    enabled: isRecordingShortcut,
    onData: (keys: number[]) => {
      const previousKeys = activeKeys;
      setActiveKeys(keys);

      // When any key is released, validate the combination
      if (previousKeys.length > 0 && keys.length < previousKeys.length) {
        const result = validateShortcutFormat(previousKeys);

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
      setActiveKeys([]);
    }
  }, [isRecordingShortcut]);

  return (
    <TooltipProvider>
      <div className="inline-flex items-center gap-2">
        {isRecordingShortcut ? (
          <RecordingDisplay
            activeKeys={activeKeys}
            onCancel={handleCancelRecording}
            pressKeysText={t("settings.shortcuts.input.pressKeys")}
          />
        ) : (
          <ShortcutDisplay value={value} onEdit={handleStartRecording} />
        )}
      </div>
    </TooltipProvider>
  );
}
