// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RecordingStatus } from "@/hooks/useRecording";

vi.mock("@/components/Waveform", () => ({
  Waveform: () => null,
}));

vi.mock("@/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock("@/trpc/react", () => ({
  api: {
    widget: {
      openNotesWindow: {
        useMutation: () => ({ mutateAsync: vi.fn() }),
      },
    },
  },
}));

vi.mock("@/renderer/widget/pass-through", () => ({
  setPassThroughReason: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { FloatingButton } from "@/renderer/widget/pages/widget/components/FloatingButton";

describe("FloatingButton recording triggers", () => {
  it.each([
    {
      state: "recording",
      button: "Dismiss recording",
      expected: "dismiss",
    },
    {
      state: "starting",
      button: "Dismiss recording",
      expected: "dismiss",
    },
    {
      state: "recording",
      button: "Stop recording and transcribe",
      expected: "stop",
    },
    {
      state: "starting",
      button: "Stop recording and transcribe",
      expected: "stop",
    },
  ] as const)(
    "I-51 routes $button while $state",
    ({ state, button, expected }) => {
      const startRecording = vi.fn().mockResolvedValue(undefined);
      const stopRecording = vi.fn().mockResolvedValue(undefined);
      const dismissRecording = vi.fn().mockResolvedValue(undefined);
      const recordingStatus: RecordingStatus = {
        sessionId: "session-1",
        state,
        mode: "hands-free",
        isDraft: false,
        stopKind: "none",
        stopOrigin: "none",
      };

      render(
        React.createElement(FloatingButton, {
          recordingStatus,
          audioLevels: [],
          startRecording,
          stopRecording,
          dismissRecording,
        }),
      );

      fireEvent.click(screen.getByRole("button", { name: button }));

      expect(stopRecording).toHaveBeenCalledTimes(expected === "stop" ? 1 : 0);
      expect(dismissRecording).toHaveBeenCalledTimes(
        expected === "dismiss" ? 1 : 0,
      );
      expect(startRecording).not.toHaveBeenCalled();
    },
  );
});
