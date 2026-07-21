// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingState } from "@/types/recording";

const mocks = vi.hoisted(() => ({
  setVisible: vi.fn(),
  subscription: undefined as
    | {
        onData: (showWhileInactive: boolean) => void;
        onError: (error: unknown) => void;
      }
    | undefined,
}));

vi.mock("@/trpc/react", () => ({
  api: {
    settings: {
      widgetVisibilityPreference: {
        useSubscription: (
          _input: undefined,
          subscription: {
            onData: (showWhileInactive: boolean) => void;
            onError: (error: unknown) => void;
          },
        ) => {
          mocks.subscription = subscription;
        },
      },
    },
    widget: {
      setVisible: {
        useMutation: () => ({ mutate: mocks.setVisible }),
      },
    },
  },
}));

import { useWidgetVisibility } from "@/renderer/widget/hooks/useWidgetVisibility";

type HookProps = {
  recordingState: RecordingState;
  hasPendingDraft: boolean;
  hasVisibleNotification: boolean;
  notificationSequence: number;
};

const idleProps: HookProps = {
  recordingState: "idle",
  hasPendingDraft: false,
  hasVisibleNotification: false,
  notificationSequence: 0,
};

beforeEach(() => {
  mocks.setVisible.mockClear();
  mocks.subscription = undefined;
});

describe("useWidgetVisibility", () => {
  it("keeps the widget hidden while the inactive preference loads", () => {
    renderHook((props: HookProps) => useWidgetVisibility(props), {
      initialProps: idleProps,
    });

    expect(mocks.setVisible).toHaveBeenLastCalledWith({ visible: false });

    act(() => mocks.subscription?.onData(true));

    expect(mocks.setVisible).toHaveBeenLastCalledWith({ visible: true });
  });

  it("re-hides content that clears before the preference loads", () => {
    const { rerender } = renderHook(
      (props: HookProps) => useWidgetVisibility(props),
      {
        initialProps: {
          ...idleProps,
          hasVisibleNotification: true,
          notificationSequence: 1,
        },
      },
    );

    expect(mocks.setVisible).toHaveBeenLastCalledWith({ visible: true });

    rerender(idleProps);

    expect(mocks.setVisible).toHaveBeenLastCalledWith({ visible: false });
  });

  it("derives visibility from recording, draft, and notification content", () => {
    const { rerender } = renderHook(
      (props: HookProps) => useWidgetVisibility(props),
      { initialProps: idleProps },
    );
    act(() => mocks.subscription?.onData(false));

    rerender({ ...idleProps, recordingState: "recording" });
    expect(mocks.setVisible).toHaveBeenLastCalledWith({ visible: true });

    rerender({ ...idleProps, hasPendingDraft: true });
    expect(mocks.setVisible).toHaveBeenLastCalledWith({ visible: true });

    rerender({
      ...idleProps,
      hasVisibleNotification: true,
      notificationSequence: 1,
    });
    expect(mocks.setVisible).toHaveBeenLastCalledWith({ visible: true });

    rerender(idleProps);
    expect(mocks.setVisible).toHaveBeenLastCalledWith({ visible: false });
  });

  it("keeps a terminal notification visible after the FSM returns to idle", () => {
    const { rerender } = renderHook(
      (props: HookProps) => useWidgetVisibility(props),
      {
        initialProps: {
          ...idleProps,
          recordingState: "stopping",
          hasVisibleNotification: true,
          notificationSequence: 1,
        },
      },
    );
    act(() => mocks.subscription?.onData(false));

    rerender({
      ...idleProps,
      hasVisibleNotification: true,
      notificationSequence: 1,
    });

    expect(mocks.setVisible).toHaveBeenLastCalledWith({ visible: true });

    rerender(idleProps);

    expect(mocks.setVisible).toHaveBeenLastCalledWith({ visible: false });
  });

  it("reasserts visibility when new content appears while already shown", () => {
    const { rerender } = renderHook(
      (props: HookProps) => useWidgetVisibility(props),
      { initialProps: idleProps },
    );
    act(() => mocks.subscription?.onData(true));
    expect(mocks.setVisible).toHaveBeenCalledTimes(2);

    // The renderer may observe idle -> recording directly if the brief
    // starting state is batched away.
    rerender({ ...idleProps, recordingState: "recording" });
    expect(mocks.setVisible).toHaveBeenCalledTimes(3);
    expect(mocks.setVisible).toHaveBeenLastCalledWith({ visible: true });

    rerender({ ...idleProps, recordingState: "stopping" });
    rerender(idleProps);
    expect(mocks.setVisible).toHaveBeenCalledTimes(3);

    rerender({ ...idleProps, hasPendingDraft: true });
    expect(mocks.setVisible).toHaveBeenCalledTimes(4);

    rerender(idleProps);
    rerender({
      ...idleProps,
      hasVisibleNotification: true,
      notificationSequence: 1,
    });
    expect(mocks.setVisible).toHaveBeenCalledTimes(5);

    rerender({
      ...idleProps,
      hasVisibleNotification: true,
      notificationSequence: 2,
    });
    expect(mocks.setVisible).toHaveBeenCalledTimes(6);
    expect(mocks.setVisible).toHaveBeenLastCalledWith({ visible: true });
  });
});
