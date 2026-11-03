// @vitest-environment jsdom

import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionsScreen } from "../../src/renderer/onboarding/components/screens/PermissionsScreen";

type MicStatus = "granted" | "denied" | "not-determined";

const mocks = vi.hoisted(() => ({
  requestMicPermission: vi.fn(),
  openExternal: vi.fn(),
  getUserMedia: vi.fn(),
  stopTrack: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/trpc/react", () => ({
  api: {
    onboarding: {
      requestMicrophonePermission: {
        useMutation: () => ({ mutateAsync: mocks.requestMicPermission }),
      },
      openExternal: {
        useMutation: () => ({ mutateAsync: mocks.openExternal }),
      },
    },
  },
}));

/** Holds the mic status like the onboarding App does; each check reports
 * `statusAfterCheck`, as Windows would after the mic open. */
function Harness({ statusAfterCheck }: { statusAfterCheck: MicStatus }) {
  const [microphone, setMicrophone] = useState<MicStatus>("denied");
  return React.createElement(PermissionsScreen, {
    onNext: vi.fn(),
    onBack: vi.fn(),
    permissions: { microphone, accessibility: true },
    platform: "win32",
    checkPermissions: async () => setMicrophone(statusAfterCheck),
  });
}

describe("PermissionsScreen on Windows", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: mocks.getUserMedia },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens and closes the mic, then shows the granted state", async () => {
    mocks.getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: mocks.stopTrack }],
    });
    render(React.createElement(Harness, { statusAfterCheck: "granted" }));

    fireEvent.click(screen.getByText("onboarding.permissions.actions.request"));

    await screen.findByText("onboarding.permissions.status.granted");
    expect(mocks.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(mocks.stopTrack).toHaveBeenCalled();
    expect(mocks.requestMicPermission).not.toHaveBeenCalled();
    expect(
      screen.queryByText("onboarding.permissions.microphone.windowsBlocked"),
    ).toBeNull();
  });

  it("shows the blocked hint and opens Windows settings when access stays off", async () => {
    mocks.getUserMedia.mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    render(React.createElement(Harness, { statusAfterCheck: "denied" }));

    fireEvent.click(screen.getByText("onboarding.permissions.actions.request"));

    await screen.findByText("onboarding.permissions.microphone.windowsBlocked");
    fireEvent.click(
      screen.getByText("onboarding.permissions.actions.openSettings"),
    );
    expect(mocks.openExternal).toHaveBeenCalledWith({
      url: "ms-settings:privacy-microphone",
    });
  });
});
