import React, { useState, useEffect } from "react";
import { UnifiedPermissionsStep } from "./components/UnifiedPermissionsStep";

interface PermissionStatus {
  microphone: "granted" | "denied" | "not-determined";
  accessibility: boolean;
}

export function App() {
  const [permissions, setPermissions] = useState<PermissionStatus>({
    microphone: "not-determined",
    accessibility: false,
  });
  const [platform, setPlatform] = useState<string>("");

  useEffect(() => {
    // Check initial permissions and platform
    checkPermissions();
    window.onboardingAPI.getPlatform().then(setPlatform);
  }, []);

  const checkPermissions = async () => {
    const [micStatus, accessStatus] = await Promise.all([
      window.onboardingAPI.checkMicrophonePermission(),
      window.onboardingAPI.checkAccessibilityPermission(),
    ]);

    setPermissions({
      microphone: micStatus as "granted" | "denied" | "not-determined",
      accessibility: accessStatus,
    });
  };

  const handleComplete = () => {
    window.onboardingAPI.completeOnboarding();
  };

  return (
    <div className="h-screen w-screen bg-background text-foreground overflow-hidden">
      <div className="h-full flex items-center justify-center p-10">
        <UnifiedPermissionsStep
          permissions={permissions}
          platform={platform}
          onComplete={handleComplete}
          checkPermissions={checkPermissions}
        />
      </div>
    </div>
  );
}
