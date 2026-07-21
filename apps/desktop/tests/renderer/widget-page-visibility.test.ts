import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useWidgetNotifications: vi.fn(() => ({
    hasVisibleNotification: true,
    notificationSequence: 7,
  })),
  useWidgetVisibility: vi.fn(),
}));

vi.mock("@/hooks/useRecording", () => ({
  useRecording: () => ({
    recordingStatus: {
      state: "idle",
      mode: "idle",
      isDraft: false,
    },
    audioLevels: [],
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    dismissRecording: vi.fn(),
  }),
}));

vi.mock("@/renderer/widget/hooks/useDraftReview", () => ({
  useDraftReview: () => ({
    review: { sessionId: "draft-session", text: "Draft text" },
    insert: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/renderer/widget/hooks/useWidgetNotifications", () => ({
  useWidgetNotifications: mocks.useWidgetNotifications,
}));

vi.mock("@/renderer/widget/hooks/useWidgetVisibility", () => ({
  useWidgetVisibility: mocks.useWidgetVisibility,
}));

vi.mock("@/renderer/widget/hooks/useRecordingSettingsSync", () => ({
  useRecordingSettingsSync: vi.fn(),
}));

vi.mock("@/renderer/widget/hooks/useHealPendingMicrophone", () => ({
  useHealPendingMicrophone: vi.fn(),
}));

vi.mock("@/renderer/widget/pages/widget/components/FloatingButton", () => ({
  FloatingButton: vi.fn(() => null),
}));

vi.mock("@/renderer/widget/pages/widget/components/DraftReview", () => ({
  DraftReview: vi.fn(() => null),
}));

import { WidgetPage } from "@/renderer/widget/pages/widget";

beforeEach(() => {
  mocks.useWidgetNotifications.mockClear();
  mocks.useWidgetVisibility.mockClear();
});

describe("WidgetPage visibility composition", () => {
  it("passes recording, draft, and notification state to visibility policy", () => {
    WidgetPage();

    expect(mocks.useWidgetNotifications).toHaveBeenCalledWith("idle");
    expect(mocks.useWidgetVisibility).toHaveBeenCalledWith({
      recordingState: "idle",
      hasPendingDraft: true,
      hasVisibleNotification: true,
      notificationSequence: 7,
    });
  });
});
