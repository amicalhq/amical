import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { KeyboardShortcut } from "@/components/ui/keyboard-shortcut";
import { X } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/trpc/react";
import { toast } from "sonner";

interface ShortcutInputProps {
  value?: string[];
  onChange: (value: string[]) => void;
  isRecordingShortcut?: boolean;
  onRecordingShortcutChange: (recording: boolean) => void;
}

const MODIFIER_KEYS = ["Cmd", "Win", "Ctrl", "Alt", "Shift", "Fn"];
const MAX_KEY_COMBINATION_LENGTH = 4;

type ValidationResult = {
  valid: boolean;
  shortcut?: string[];
  error?: string;
};

/**
 * Basic format validation only - business logic validation happens on backend
 */
function validateShortcutFormat(keys: string[]): ValidationResult {
  if (keys.length === 0) {
    return { valid: false, error: "No keys detected" };
  }

  if (keys.length > MAX_KEY_COMBINATION_LENGTH) {
    return {
      valid: false,
      error: `Too many keys - use ${MAX_KEY_COMBINATION_LENGTH} or fewer`,
    };
  }

  const modifierKeys = keys.filter((key) => MODIFIER_KEYS.includes(key));
  const regularKeys = keys.filter((key) => !MODIFIER_KEYS.includes(key));

  // Return array format: modifiers first, then regular keys
  return {
    valid: true,
    shortcut: [...modifierKeys, ...regularKeys],
  };
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
        <KeyboardShortcut
          keys={activeKeys}
          keyClassName="h-6 min-w-6 text-xs px-2"
          separatorClassName="text-xs"
        />
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
  value?: string[];
  onEdit: () => void;
}) {
  if (!value?.length) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={onEdit}
      >
        Set shortcut
      </Button>
    );
  }

  return (
    <button
      type="button"
      onClick={onEdit}
      className="inline-flex items-center rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <KeyboardShortcut
        keys={value}
        className="pointer-events-none"
        keyClassName="h-6 min-w-6 text-xs px-2"
        separatorClassName="text-xs text-muted-foreground"
      />
    </button>
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
  // Note: activeKeys closure is fresh on each render because useSubscription
  // updates its callback reference, so previousKeys correctly captures the
  // previous state value when onData fires.
  api.settings.activeKeysUpdates.useSubscription(undefined, {
    enabled: isRecordingShortcut,
    onData: (keys: string[]) => {
      const previousKeys = activeKeys;
      setActiveKeys(keys);

      // When any key is released, validate the combination
      if (previousKeys.length > 0 && keys.length < previousKeys.length) {
        const result = validateShortcutFormat(previousKeys);

        if (result.valid && result.shortcut) {
          // Basic format is valid - let parent handle backend validation
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
