import React, { useState, useEffect } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ShortcutInput } from "@/components/shortcut-input";
import { api } from "@/trpc/react";
import { toast } from "sonner";

export function ShortcutsSettings() {
  const [pushToTalkShortcut, setPushToTalkShortcut] = useState("");
  const [toggleRecordingShortcut, setToggleRecordingShortcut] = useState("");
  const [recordingShortcut, setRecordingShortcut] = useState<
    "pushToTalk" | "toggleRecording" | null
  >(null);

  // tRPC queries and mutations
  const shortcutsQuery = api.settings.getShortcuts.useQuery();
  const utils = api.useUtils();

  const setShortcutMutation = api.settings.setShortcut.useMutation({
    onSuccess: () => {
      utils.settings.getShortcuts.invalidate();
    },
    onError: (error) => {
      console.error("Failed to save shortcut:", error);
      toast.error("Failed to save shortcut. Please try again.");
    },
  });

  // Load shortcuts when query data is available
  useEffect(() => {
    if (shortcutsQuery.data) {
      setPushToTalkShortcut(shortcutsQuery.data.pushToTalk);
      setToggleRecordingShortcut(shortcutsQuery.data.toggleRecording);
    }
  }, [shortcutsQuery.data]);

  const handlePushToTalkChange = (shortcut: string) => {
    setPushToTalkShortcut(shortcut);
    setShortcutMutation.mutate({
      type: "pushToTalk",
      shortcut: shortcut,
    });
    toast.success("Push to Talk shortcut updated");
  };

  const handleToggleRecordingChange = (shortcut: string) => {
    setToggleRecordingShortcut(shortcut);
    setShortcutMutation.mutate({
      type: "toggleRecording",
      shortcut: shortcut,
    });
    toast.success("Toggle Recording shortcut updated");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Keyboard Shortcuts</CardTitle>
        <CardDescription>Customize your keyboard shortcuts</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Push to Talk</Label>
            <p className="text-sm text-muted-foreground">
              Hold to dictate while key is pressed
            </p>
          </div>
          <ShortcutInput
            value={pushToTalkShortcut}
            onChange={handlePushToTalkChange}
            isRecordingShortcut={recordingShortcut === "pushToTalk"}
            onRecordingShortcutChange={(recording) =>
              setRecordingShortcut(recording ? "pushToTalk" : null)
            }
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label>Toggle Recording</Label>
            <p className="text-sm text-muted-foreground">
              Start/stop dictation
            </p>
          </div>
          <ShortcutInput
            value={toggleRecordingShortcut}
            onChange={handleToggleRecordingChange}
            isRecordingShortcut={recordingShortcut === "toggleRecording"}
            onRecordingShortcutChange={(recording) =>
              setRecordingShortcut(recording ? "toggleRecording" : null)
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
