import React, { useState, useEffect } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { X, Undo2 } from "lucide-react";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { getKeyFromKeycode } from "@/utils/keycode-map";
import { cn } from "@/lib/utils";

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
  error?: string;
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
    return { valid: false, error: "No keys detected" };
  }

  if (keys.length > MAX_KEY_COMBINATION_LENGTH) {
    return {
      valid: false,
      error: `Too many keys - use ${MAX_KEY_COMBINATION_LENGTH} or fewer`,
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
}: {
  activeKeys: number[];
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
              {keycodeToDisplay(key)}
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
  onClear,
}: {
  value?: number[];
  onEdit: () => void;
  onClear: () => void;
}) {
  // Format array as display string (e.g., ["Fn", "Space"] -> "Fn+Space")
  const displayValue = value?.length
    ? value.map((key) => keycodeToDisplay(key)).join("+")
    : undefined;

  return (
    <div
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        "gap-2",
      )}
    >
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
        onClick={onClear}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

export function ShortcutInput({
  value,
  onChange,
  isRecordingShortcut = false,
  onRecordingShortcutChange,
}: ShortcutInputProps) {
  const [activeKeys, setActiveKeys] = useState<number[]>([]);
  const [previousKeys, setPreviousKeys] = useState<number[] | null>(() => {
    const stored = localStorage.getItem("shortcuts");
    return stored ? JSON.parse(stored) : null;
  });
  const setRecordingStateMutation =
    api.settings.setShortcutRecordingState.useMutation();

  const hasShortcut = value && value.length > 0;

  const handleStartRecording = () => {
    onRecordingShortcutChange(true);
    setRecordingStateMutation.mutate(true);
  };

  const handleCancelRecording = () => {
    onRecordingShortcutChange(false);
    setActiveKeys([]);
    setRecordingStateMutation.mutate(false);
  };

  const handleClearRecording = () => {
    if (value && value.length > 0) {
      setPreviousKeys(value);
    }
    onChange([]);
  };

  const handleRestorePrevious = () => {
    if (previousKeys && previousKeys.length > 0) {
      onChange(previousKeys);
      setPreviousKeys(null);
    }
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
          setPreviousKeys(null);
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

  // Sync previousValue to localStorage
  useEffect(() => {
    if (previousKeys) {
      localStorage.setItem("shortcuts", JSON.stringify(previousKeys));
    } else {
      localStorage.removeItem("shortcuts");
    }
  }, [previousKeys]);

  return (
    <TooltipProvider>
      {isRecordingShortcut ? (
        <RecordingDisplay
          activeKeys={activeKeys}
          onCancel={handleCancelRecording}
        />
      ) : hasShortcut ? (
        <ShortcutDisplay
          value={value}
          onEdit={handleStartRecording}
          onClear={handleClearRecording}
        />
      ) : (
        <div className="inline-flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleStartRecording}>
            Set shortcut...
          </Button>
          {previousKeys && previousKeys.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={handleRestorePrevious}
              title="Restore previous shortcut"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </TooltipProvider>
  );
}
