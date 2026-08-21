// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseAudioCaptureParams } from "@/hooks/useAudioCapture";

const mocks = vi.hoisted(() => ({
  captureStarted: vi.fn(),
  captureStartFailed: vi.fn(),
  dismiss: vi.fn(),
  sendAudioChunk: vi.fn(),
  signalStop: vi.fn(),
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
        signalStop: {
          useMutation: () => ({ mutateAsync: mocks.signalStop }),
        },
        dismiss: { useMutation: () => ({ mutateAsync: mocks.dismiss }) },
        captureStarted: {
          useMutation: () => ({ mutate: mocks.captureStarted }),
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
  mocks.captureStarted.mockReset();
  mocks.captureStartFailed.mockReset();
  mocks.dismiss.mockReset();
  mocks.dismiss.mockResolvedValue(undefined);
  mocks.signalStop.mockReset();
  mocks.signalStop.mockResolvedValue(undefined);
  mocks.sendAudioChunk.mockReset();
  mocks.sendAudioChunk.mockResolvedValue(undefined);
  mocks.stateUpdates.mockReset();
  mocks.useAudioCapture.mockReset();
  mocks.useAudioCapture.mockReturnValue({ audioLevels: [] });
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { sendAudioChunk: mocks.sendAudioChunk },
  });
});

describe("useRecording trigger forwarding", () => {
  it("I-51 forwards stop and dismiss to their distinct recording mutations", async () => {
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.stopRecording();
    });

    expect(mocks.signalStop).toHaveBeenCalledOnce();
    expect(mocks.dismiss).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.dismissRecording();
    });

    expect(mocks.signalStop).toHaveBeenCalledOnce();
    expect(mocks.dismiss).toHaveBeenCalledOnce();
  });
});

describe("useRecording capture failure wiring", () => {
  it("I-55 forwards a capture failure to main", () => {
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

describe("useRecording capture identity wiring", () => {
  it("I-54 forwards the capture session ID with microphone and audio reports", async () => {
    renderHook(() => useRecording());
    const captureParams = mocks.useAudioCapture.mock.lastCall?.[0] as
      | UseAudioCaptureParams
      | undefined;
    act(() => {
      captureParams?.onCaptureStarted?.(
        {
          name: "External Mic",
          deviceId: "external-mic",
          captureSource: "preferred",
        },
        "session-1",
      );
    });

    const frame = new Float32Array([0.1, 0.2]);
    await act(async () => {
      await captureParams?.onAudioChunk(
        "session-1",
        frame.buffer as ArrayBuffer,
        0,
        false,
      );
    });

    expect(mocks.captureStarted).toHaveBeenCalledWith(
      {
        sessionId: "session-1",
        microphoneName: "External Mic",
        captureSource: "preferred",
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(mocks.sendAudioChunk).toHaveBeenCalledWith(
      "session-1",
      expect.any(Float32Array),
      false,
    );
  });
});
