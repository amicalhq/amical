import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X, Pencil } from "lucide-react";
import { api } from "@/trpc/react";

const MODIFIER_KEYS = ["Cmd", "Win", "Ctrl", "Alt", "Shift", "Fn"];

/**
 * Simplified shortcut input component for onboarding - Push to Talk only
 */
export function OnboardingShortcutInput() {
  const [pushToTalkShortcut, setPushToTalkShortcut] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [activeKeys, setActiveKeys] = useState<string[]>([]);

  const utils = api.useUtils();
  const shortcutsQuery = api.settings.getShortcuts.useQuery();
  const setShortcutMutation = api.settings.setShortcut.useMutation({
    onSuccess: () => {
      utils.settings.getShortcuts.invalidate();
    },
  });
  const setRecordingStateMutation =
    api.settings.setShortcutRecordingState.useMutation();

  // Load current shortcut
  useEffect(() => {
    if (shortcutsQuery.data) {
      setPushToTalkShortcut(shortcutsQuery.data.pushToTalk);
    }
  }, [shortcutsQuery.data]);

  const handleStartRecording = () => {
    setIsRecording(true);
    setActiveKeys([]);
    setRecordingStateMutation.mutate(true);
  };

  const handleCancelRecording = () => {
    setIsRecording(false);
    setActiveKeys([]);
    setRecordingStateMutation.mutate(false);
  };

  // Subscribe to key events when recording
  api.settings.activeKeysUpdates.useSubscription(undefined, {
    enabled: isRecording,
    onData: (keys: string[]) => {
      const previousKeys = activeKeys;
      setActiveKeys(keys);

      // When any key is released, validate and save
      if (previousKeys.length > 0 && keys.length < previousKeys.length) {
        // Check if it has at least one modifier key
        const hasModifier = previousKeys.some((key) =>
          MODIFIER_KEYS.includes(key),
        );

        if (hasModifier) {
          const shortcut = previousKeys.join("+");
          setPushToTalkShortcut(shortcut);
          setShortcutMutation.mutate({
            type: "pushToTalk",
            shortcut: shortcut,
          });
        }

        setIsRecording(false);
        setRecordingStateMutation.mutate(false);
      }
    },
  });

  return (
    <div className="flex items-center justify-between">
      <div>
        <Label className="text-base font-semibold text-foreground">
          Push to talk
        </Label>
        <p className="text-xs text-muted-foreground mt-1">
          Hold to dictate while key is pressed
        </p>
      </div>
      <div className="min-w-[200px] flex justify-end">
        {isRecording ? (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md ring-2 ring-primary w-full">
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
              <span className="text-sm text-muted-foreground">
                Press keys...
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 ml-auto"
              onClick={handleCancelRecording}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2">
            {pushToTalkShortcut ? (
              <>
                <kbd
                  onClick={handleStartRecording}
                  className="inline-flex items-center px-3 py-1 bg-muted hover:bg-muted/70 rounded-md text-sm font-mono cursor-pointer transition-colors"
                >
                  {pushToTalkShortcut}
                </kbd>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={handleStartRecording}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStartRecording}
                className="text-xs"
              >
                Set shortcut
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
