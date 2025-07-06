import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Pencil, X } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/trpc/react";
import { toast } from "sonner";

interface ShortcutInputProps {
  value?: string;
  onChange: (value: string) => void;
  isRecordingShortcut?: boolean;
  onRecordingShortcutChange: (recording: boolean) => void;
}

const MODIFIER_KEYS = ["Cmd", "Ctrl", "Alt", "Shift", "Fn"];
const MAX_KEY_COMBINATION_LENGTH = 3;

type ValidationResult = {
  valid: boolean;
  shortcut?: string;
  error?: string;
};

function validateShortcut(keys: string[]): ValidationResult {
  if (keys.length === 0) {
    return { valid: false, error: "No keys detected" };
  }

  if (keys.length > MAX_KEY_COMBINATION_LENGTH) {
    return { valid: false, error: "Maximum 3 keys allowed" };
  }

  const modifierKeys = keys.filter((key) => MODIFIER_KEYS.includes(key));
  const regularKeys = keys.filter((key) => !MODIFIER_KEYS.includes(key));

  // Single modifier key (e.g., Fn for PTT)
  if (keys.length === 1 && modifierKeys.length === 1) {
    return { valid: true, shortcut: modifierKeys[0] };
  }

  // Single regular key
  if (modifierKeys.length === 0 && regularKeys.length === 1) {
    return { valid: true, shortcut: regularKeys[0] };
  }

  // Modifier(s) + up to 2 regular keys
  if (
    modifierKeys.length > 0 &&
    regularKeys.length > 0 &&
    regularKeys.length <= 2
  ) {
    return {
      valid: true,
      shortcut: [...modifierKeys, ...regularKeys].join("+"),
    };
  }

  // Multiple regular keys without modifiers
  if (modifierKeys.length === 0 && regularKeys.length > 1) {
    return {
      valid: false,
      error:
        "Multiple keys require at least one modifier (Cmd, Ctrl, Alt, Shift, or Fn)",
    };
  }

  return { valid: false, error: "Invalid key combination" };
}

function RecordingDisplay({
  activeKeys,
  onCancel,
}: {
  activeKeys: string[];
  onCancel: () => void;
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
              {key}
            </kbd>
          ))}
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">Press keys...</span>
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
  value?: string;
  onEdit: () => void;
}) {
  return (
    <>
      {value && (
        <kbd
          onClick={onEdit}
          className="inline-flex items-center px-3 py-1 bg-muted hover:bg-muted/70 rounded-md text-sm font-mono cursor-pointer transition-colors"
        >
          {value}
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
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
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
  api.settings.activeKeysUpdates.useSubscription(undefined, {
    enabled: isRecordingShortcut,
    onData: (keys: string[]) => {
      const previousKeys = activeKeys;
      setActiveKeys(keys);

      // When any key is released, validate the combination
      if (previousKeys.length > 0 && keys.length < previousKeys.length) {
        const result = validateShortcut(previousKeys);

        if (result.valid && result.shortcut) {
          onChange(result.shortcut);
        } else {
          toast.error(result.error || "Invalid key combination");
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
          />
        ) : (
          <ShortcutDisplay value={value} onEdit={handleStartRecording} />
        )}
      </div>
    </TooltipProvider>
  );
}
