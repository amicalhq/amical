// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dismiss: vi.fn(),
  navigate: vi.fn(),
  setPassThroughReason: vi.fn(),
  subscription: undefined as
    | {
        onData: (notification: unknown) => void;
        onError: (error: unknown) => void;
      }
    | undefined,
  toastId: 0,
  toastOptions: new Map<
    number,
    { onDismiss: () => void; onAutoClose: () => void }
  >(),
  track: vi.fn(),
}));

vi.mock("@/trpc/react", () => ({
  api: {
    recording: {
      widgetNotifications: {
        useSubscription: (
          _input: undefined,
          subscription: {
            onData: (notification: unknown) => void;
            onError: (error: unknown) => void;
          },
        ) => {
          mocks.subscription = subscription;
        },
      },
    },
    telemetry: {
      trackEvent: { useMutation: () => ({ mutate: mocks.track }) },
    },
    widget: {
      navigateMainWindow: {
        useMutation: () => ({ mutate: mocks.navigate }),
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    custom: vi.fn(
      (
        _render: unknown,
        options: { onDismiss: () => void; onAutoClose: () => void },
      ) => {
        const id = ++mocks.toastId;
        mocks.toastOptions.set(id, options);
        return id;
      },
    ),
    dismiss: mocks.dismiss,
  },
}));

vi.mock("@/renderer/widget/pass-through", () => ({
  setPassThroughReason: mocks.setPassThroughReason,
}));

import { useWidgetNotifications } from "@/renderer/widget/hooks/useWidgetNotifications";

const notification = {
  id: "notification-id",
  type: "no_audio" as const,
  title: "No audio",
  description: "Check your microphone",
  timestamp: 1,
};

beforeEach(() => {
  mocks.dismiss.mockClear();
  mocks.navigate.mockClear();
  mocks.setPassThroughReason.mockClear();
  mocks.subscription = undefined;
  mocks.toastId = 0;
  mocks.toastOptions.clear();
  mocks.track.mockClear();
});

describe("useWidgetNotifications", () => {
  it("keeps the visibility hold until the last toast closes", () => {
    const { result, unmount } = renderHook(() =>
      useWidgetNotifications("idle"),
    );

    act(() => {
      mocks.subscription?.onData(notification);
      mocks.subscription?.onData({ ...notification, id: "second" });
    });

    expect(result.current).toEqual({
      hasVisibleNotification: true,
      notificationSequence: 2,
    });
    expect(mocks.setPassThroughReason).toHaveBeenLastCalledWith("toast", true);

    act(() => mocks.toastOptions.get(1)?.onDismiss());

    expect(result.current.hasVisibleNotification).toBe(true);

    act(() => mocks.toastOptions.get(2)?.onAutoClose());

    expect(result.current).toEqual({
      hasVisibleNotification: false,
      notificationSequence: 2,
    });
    expect(mocks.setPassThroughReason).toHaveBeenLastCalledWith("toast", false);

    unmount();
  });

  it("clears stale toasts when a new recording starts", () => {
    const { rerender, result, unmount } = renderHook(
      ({ state }: { state: "idle" | "recording" }) =>
        useWidgetNotifications(state),
      { initialProps: { state: "idle" } },
    );

    act(() => mocks.subscription?.onData(notification));
    rerender({ state: "recording" });

    expect(mocks.dismiss).toHaveBeenCalledWith(1);
    expect(result.current).toEqual({
      hasVisibleNotification: false,
      notificationSequence: 1,
    });
    expect(mocks.setPassThroughReason).toHaveBeenLastCalledWith("toast", false);

    unmount();
  });
});
