// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseAudioCaptureParams } from "@/hooks/useAudioCapture";

const mocks = vi.hoisted(() => ({
  captureStartFailed: vi.fn(),
  stateUpdates: vi.fn(),
  useAudioCapture: vi.fn(),
}));

vi.mock("@/hooks/useAudioCapture", () => ({
  useAudioCapture: mocks.useAudioCapture,
}));

vi.mock("@/trpc/react", () => {
  const asyncMutation = () => ({ mutateAsync: vi.fn() });
  return {
    api: {
      recording: {
        signalStart: { useMutation: asyncMutation },
        signalStop: { useMutation: asyncMutation },
        dismiss: { useMutation: asyncMutation },
        captureStarted: {
          useMutation: () => ({ mutate: vi.fn() }),
        },
        captureStartFailed: {
          useMutation: () => ({ mutate: mocks.captureStartFailed }),
        },
        stateUpdates: { useSubscription: mocks.stateUpdates },
      },
    },
  };
});

import { useRecording } from "@/hooks/useRecording";

beforeEach(() => {
  mocks.captureStartFailed.mockReset();
  mocks.stateUpdates.mockReset();
  mocks.useAudioCapture.mockReset();
  mocks.useAudioCapture.mockReturnValue({ audioLevels: [] });
});

describe("useRecording capture failure wiring", () => {
  it("forwards a capture failure to main", () => {
    renderHook(() => useRecording());
    const subscription = mocks.stateUpdates.mock.calls[0]?.[1] as
      | {
          onData?: (update: {
            sessionId: string;
            state: "recording";
            mode: "hands-free";
            isDraft: boolean;
          }) => void;
        }
      | undefined;

    act(() => {
      subscription?.onData?.({
        sessionId: "session-1",
        state: "recording",
        mode: "hands-free",
        isDraft: false,
      });
    });

    const captureParams = mocks.useAudioCapture.mock.lastCall?.[0] as
      | UseAudioCaptureParams
      | undefined;
    const failure = {
      sessionId: "session-1",
      name: "NotAllowedError",
      message: "Permission denied",
    };

    expect(captureParams).toEqual(
      expect.objectContaining({
        sessionId: "session-1",
        enabled: true,
      }),
    );

    act(() => {
      captureParams?.onCaptureStartFailure?.(failure);
    });

    expect(mocks.captureStartFailed).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });
});
