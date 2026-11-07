import type { AudioCaptureInfo } from "@/types/audio-capture";

export type AudioChunkForwarder = (
  arrayBuffer: ArrayBuffer,
  speechProbability: number,
  isFinalChunk: boolean,
  captureInfo?: AudioCaptureInfo,
) => Promise<void> | void;

export interface PendingWorkletFlush {
  finish: (didFlush?: boolean) => void;
}

const logAudioFrameForwardError = (error: unknown) =>
  console.error("AudioCapture: Error forwarding audio frame:", error);

export const attachAudioWorkletFrameHandler = ({
  workletNode,
  onAudioChunk,
  finishPendingFlush,
  captureConfig,
  onFirstFrame,
}: {
  workletNode: AudioWorkletNode;
  onAudioChunk: AudioChunkForwarder;
  finishPendingFlush: (didFlush?: boolean) => void;
  captureConfig: Omit<AudioCaptureInfo, "inputChannelCount">;
  onFirstFrame?: () => void;
}) => {
  let firstFrameReceived = false;
  let lastInputChannelCount: number | undefined;
  const firstFrameStartTime = performance.now();

  workletNode.port.onmessage = async (event: MessageEvent) => {
    const data = event.data as {
      type?: string;
      frame?: Float32Array;
      isFinal?: boolean;
      inputChannelCount?: number;
    };
    if (data.type !== "audioFrame" || !data.frame) {
      return;
    }

    if (!firstFrameReceived && data.frame.length > 0) {
      firstFrameReceived = true;
      onFirstFrame?.();
      const firstFrameDuration = performance.now() - firstFrameStartTime;
      console.log(
        `AudioCapture: First audio frame received after ${firstFrameDuration.toFixed(2)}ms`,
      );
    }

    const frame = data.frame;
    let captureInfo: AudioCaptureInfo | undefined;
    if (
      data.inputChannelCount !== undefined &&
      data.inputChannelCount > 0 &&
      data.inputChannelCount !== lastInputChannelCount
    ) {
      lastInputChannelCount = data.inputChannelCount;
      captureInfo = {
        ...captureConfig,
        inputChannelCount: data.inputChannelCount,
      };
      console.log("AudioCapture: Received microphone channels", captureInfo);
    }
    const isFinal = data.isFinal || false;
    const arrayBuffer = frame.buffer.slice(
      frame.byteOffset,
      frame.byteOffset + frame.byteLength,
    ) as ArrayBuffer;

    // For the final frame, unblock teardown once the frame has been handed off;
    // main-process finalization can take much longer.
    let sendPromise: Promise<void> | void;
    try {
      sendPromise = onAudioChunk(arrayBuffer, 0, isFinal, captureInfo);
    } catch (error) {
      logAudioFrameForwardError(error);
      if (isFinal) {
        finishPendingFlush(false);
      }
      return;
    }

    if (isFinal) {
      finishPendingFlush();
    }

    try {
      await sendPromise;
    } catch (error) {
      logAudioFrameForwardError(error);
    }
  };
};

export interface WorkletFlushRequest extends PendingWorkletFlush {
  promise: Promise<boolean>;
  request: () => void;
}

export const createWorkletFlushRequest = ({
  workletNode,
  timeoutMs,
}: {
  workletNode: AudioWorkletNode;
  timeoutMs: number;
}): WorkletFlushRequest => {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const finish = (didFlush = true) => {
    if (settled) {
      return;
    }
    settled = true;
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    workletNode.port.onmessage = null;
    resolve(didFlush);
  };

  const request = () => {
    timeoutHandle = setTimeout(() => {
      console.warn("AudioCapture: Timed out waiting for worklet flush", {
        timeoutMs,
      });
      finish(false);
    }, timeoutMs);

    try {
      workletNode.port.postMessage({ type: "flush" });
    } catch (error) {
      console.error("AudioCapture: Failed to request worklet flush:", error);
      finish(false);
    }
  };

  return { finish, promise, request };
};
