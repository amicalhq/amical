import React, { useEffect, useState } from "react";
import { api } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CheckCircle,
  AlertCircle,
  Mic,
  Accessibility,
  ExternalLink,
  RefreshCw,
} from "lucide-react";

interface UnifiedPermissionsStepProps {
  permissions: {
    microphone: "granted" | "denied" | "not-determined";
    accessibility: boolean;
  };
  platform: string;
  onComplete: () => void;
  checkPermissions: () => Promise<void>;
}

export function UnifiedPermissionsStep({
  permissions,
  platform,
  onComplete,
  checkPermissions,
}: UnifiedPermissionsStepProps) {
  const [isRequestingMic, setIsRequestingMic] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  // tRPC mutations
  const requestMicPermission =
    api.onboarding.requestMicrophonePermission.useMutation();
  const openExternal = api.onboarding.openExternal.useMutation();
  const quitApp = api.onboarding.quitApp.useMutation();

  const allPermissionsGranted =
    permissions.microphone === "granted" &&
    (permissions.accessibility || platform !== "darwin");

  // Poll for permission changes continuously to keep UI in sync
  useEffect(() => {
    // Always poll to detect permission changes in real-time
    const interval = setInterval(async () => {
      await checkPermissions();
    }, 2000);

    // Show polling indicator only when permissions are not all granted
    setIsPolling(!allPermissionsGranted);

    return () => {
      clearInterval(interval);
    };
  }, [checkPermissions, allPermissionsGranted]);

  const handleRequestMicrophone = async () => {
    setIsRequestingMic(true);
    try {
      await requestMicPermission.mutateAsync();
      await checkPermissions();
    } finally {
      setIsRequestingMic(false);
    }
  };

  const handleOpenAccessibility = async () => {
    // Open System Preferences > Security & Privacy > Privacy > Accessibility
    await openExternal.mutateAsync({
      url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    });
  };

  const handleOpenMicrophoneSettings = async () => {
    // Open platform-specific microphone privacy settings
    const url =
      platform === "darwin"
        ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        : "ms-settings:privacy-microphone";
    await openExternal.mutateAsync({ url });
  };

  const getMicrophoneStatus = () => {
    switch (permissions.microphone) {
      case "granted":
        return {
          icon: CheckCircle,
          color: "text-green-500",
          bg: "bg-green-500/10",
        };
      case "denied":
        return {
          icon: AlertCircle,
          color: "text-red-500",
          bg: "bg-red-500/10",
        };
      default:
        return {
          icon: RefreshCw,
          color: "text-blue-500",
          bg: "bg-blue-500/10",
        };
    }
  };

  const getAccessibilityStatus = () => {
    if (permissions.accessibility) {
      return {
        icon: CheckCircle,
        color: "text-green-500",
        bg: "bg-green-500/10",
      };
    }
    return {
      icon: AlertCircle,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    };
  };

  const micStatus = getMicrophoneStatus();
  const accessStatus = getAccessibilityStatus();

  return (
    <div className="max-w-lg w-full space-y-6">
      {/* Header with logo */}
      <div className="text-center space-y-4">
        <img src="assets/logo.svg" alt="Vox" className="w-20 h-20 mx-auto" />
        <div>
          <h1 className="text-2xl font-bold">Permissions Required</h1>
          <p className="text-muted-foreground mt-2">
            Vox needs these permissions to work properly
          </p>
        </div>
      </div>

      {/* Permission Cards */}
      <div className="space-y-3">
        {/* Microphone Permission */}
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${micStatus.bg}`}
            >
              <Mic className={`w-5 h-5 ${micStatus.color}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Microphone</h3>
                <div className={`flex items-center gap-1 ${micStatus.color}`}>
                  <micStatus.icon className="w-4 h-4" />
                  <span className="text-sm capitalize">
                    {permissions.microphone}
                  </span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Required to transcribe your voice into text
              </p>

              {permissions.microphone === "denied" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenMicrophoneSettings}
                  className="mt-3 w-full"
                >
                  Open Microphone Settings
                  <ExternalLink className="w-3 h-3 ml-2" />
                </Button>
              )}

              {permissions.microphone === "not-determined" && (
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  onClick={handleRequestMicrophone}
                  disabled={isRequestingMic}
                >
                  {isRequestingMic ? "Requesting..." : "Grant Permission"}
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Accessibility Permission (macOS only) */}
        {platform === "darwin" && (
          <Card className="p-4">
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${accessStatus.bg}`}
              >
                <Accessibility className={`w-5 h-5 ${accessStatus.color}`} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">Accessibility</h3>
                  <div
                    className={`flex items-center gap-1 ${accessStatus.color}`}
                  >
                    <accessStatus.icon className="w-4 h-4" />
                    <span className="text-sm">
                      {permissions.accessibility ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Required for context based formating and push to talk
                </p>

                {!permissions.accessibility && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleOpenAccessibility}
                    className="mt-3 w-full"
                  >
                    Open Accessibility Settings
                    <ExternalLink className="w-3 h-3 ml-2" />
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Status message */}
      {isPolling && !allPermissionsGranted && (
        <div className="text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Checking permissions...
        </div>
      )}

      {/* Action buttons */}
      <div className="flex justify-between gap-4 pt-4">
        <Button onClick={() => quitApp.mutate()} variant="outline" size="lg">
          Quit Vox
        </Button>
        <Button
          onClick={onComplete}
          size="lg"
          disabled={!allPermissionsGranted}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
