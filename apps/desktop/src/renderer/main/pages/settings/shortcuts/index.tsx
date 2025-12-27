import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ShortcutInput } from "@/components/shortcut-input";
import { Separator } from "@/components/ui/separator";
import { api } from "@/trpc/react";
import { toast } from "sonner";

export function ShortcutsSettingsPage() {
  const [pushToTalkShortcut, setPushToTalkShortcut] = useState<string[]>([]);
  const [toggleRecordingShortcut, setToggleRecordingShortcut] = useState<
    string[]
  >([]);
  const [recordingShortcut, setRecordingShortcut] = useState<
    "pushToTalk" | "toggleRecording" | null
  >(null);

  // tRPC queries and mutations
  const shortcutsQuery = api.settings.getShortcuts.useQuery();
  const utils = api.useUtils();

  const setShortcutMutation = api.settings.setShortcut.useMutation({
    onSuccess: (data, variables) => {
      utils.settings.getShortcuts.invalidate();

      // Show warning if there is one
      if (data.warning) {
        toast.warning(data.warning);
      } else {
        toast.success(
          variables.type === "pushToTalk"
            ? "Push to talk shortcut updated"
            : "Toggle Recording shortcut updated",
        );
      }
    },
    onError: (error) => {
      toast.error(error.message);
      // Revert to saved value
      utils.settings.getShortcuts.invalidate();
    },
  });

  // Load shortcuts when query data is available
  useEffect(() => {
    if (shortcutsQuery.data) {
      setPushToTalkShortcut(shortcutsQuery.data.pushToTalk);
      setToggleRecordingShortcut(shortcutsQuery.data.toggleRecording);
    }
  }, [shortcutsQuery.data]);

  const handlePushToTalkChange = (shortcut: string[]) => {
    setPushToTalkShortcut(shortcut);
    setShortcutMutation.mutate({
      type: "pushToTalk",
      shortcut: shortcut,
    });
  };

  const handleToggleRecordingChange = (shortcut: string[]) => {
    setToggleRecordingShortcut(shortcut);
    setShortcutMutation.mutate({
      type: "toggleRecording",
      shortcut: shortcut,
    });
  };

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-xl font-bold">Shortcuts</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Configure keyboard shortcuts for dictation and hands-free modes
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-8">
            <div>
              <div className="flex flex-col md:flex-row md:justify-between gap-4">
                <div>
                  <Label className="text-base font-semibold text-foreground">
                    Push to talk
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1 max-w-md">
                    Hold to dictate while key is pressed
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
                    Hands-free mode
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1 max-w-md">
                    Start/stop dictation by pressing once to start and pressing
                    again to stop
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
