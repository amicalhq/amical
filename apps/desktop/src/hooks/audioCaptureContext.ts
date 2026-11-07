import type { AudioCaptureTimings } from "./audioCaptureTimings";
import { reportAudioContextFailure } from "./audioCaptureTelemetry";

export interface PreparedAudioContext {
  audioContext: AudioContext;
  createdAt?: number;
}

export const createOrResumeAudioContext = async ({
  currentAudioContext,
  sampleRate,
  audioWorkletUrl,
  timings,
  sessionId,
}: {
  currentAudioContext: AudioContext | null;
  sampleRate: number;
  audioWorkletUrl: string;
  timings?: AudioCaptureTimings;
  sessionId?: string;
}): Promise<PreparedAudioContext> => {
  const audioContextStartTime = performance.now();

  if (currentAudioContext?.state === "suspended") {
    try {
      await (timings
        ? timings.measure("capture.audio-context-resume", () =>
            currentAudioContext.resume(),
          )
        : currentAudioContext.resume());
    } catch (error) {
      reportAudioContextFailure(
        error,
        "resume",
        currentAudioContext,
        sessionId,
        timings,
      );
      throw error;
    }
    const resumeDuration = performance.now() - audioContextStartTime;
    console.log(
      `AudioCapture: AudioContext resumed took ${resumeDuration.toFixed(2)}ms`,
    );
    return { audioContext: currentAudioContext };
  }

  if (currentAudioContext && currentAudioContext.state !== "closed") {
    console.log("AudioCapture: AudioContext already running");
    return { audioContext: currentAudioContext };
  }

  const finishCreate = timings?.start("capture.audio-context-create");
  let audioContext: AudioContext;
  try {
    audioContext = new AudioContext({
      sampleRate,
      latencyHint: "interactive",
    });
  } catch (error) {
    reportAudioContextFailure(error, "create", undefined, sessionId, timings);
    throw error;
  }
  finishCreate?.();
  const createdAt = Date.now();
  const audioContextDuration = performance.now() - audioContextStartTime;
  console.log(
    `AudioCapture: AudioContext creation took ${audioContextDuration.toFixed(2)}ms`,
  );

  let operation: "resume" | "worklet-load" = "resume";
  try {
    if (audioContext.state === "suspended") {
      await (timings
        ? timings.measure("capture.audio-context-resume", () =>
            audioContext.resume(),
          )
        : audioContext.resume());
    }
    operation = "worklet-load";
    const workletStartTime = performance.now();
    await audioContext.audioWorklet.addModule(audioWorkletUrl);
    const workletDuration = performance.now() - workletStartTime;
    console.log(
      `AudioCapture: audioWorklet.addModule took ${workletDuration.toFixed(2)}ms`,
    );
  } catch (error) {
    reportAudioContextFailure(
      error,
      operation,
      audioContext,
      sessionId,
      timings,
    );
    await audioContext.close().catch(() => {});
    throw error;
  }

  return { audioContext, createdAt };
};

export const createAudioCaptureWorklet = (
  audioContext: AudioContext,
  sessionId?: string,
  timings?: AudioCaptureTimings,
): AudioWorkletNode => {
  const nodeCreationStartTime = performance.now();
  let workletNode: AudioWorkletNode;
  try {
    workletNode = new AudioWorkletNode(
      audioContext,
      "audio-recorder-processor",
      {
        channelCountMode: "max",
        channelInterpretation: "discrete",
      },
    );
    workletNode.connect(audioContext.destination);
  } catch (error) {
    reportAudioContextFailure(
      error,
      "graph-setup",
      audioContext,
      sessionId,
      timings,
    );
    throw error;
  }
  const nodeCreationDuration = performance.now() - nodeCreationStartTime;
  console.log(
    `AudioCapture: Node creation took ${nodeCreationDuration.toFixed(2)}ms`,
  );

  return workletNode;
};

export const createAudioCaptureSource = (
  audioContext: AudioContext,
  stream: MediaStream,
  sessionId?: string,
  timings?: AudioCaptureTimings,
): MediaStreamAudioSourceNode => {
  try {
    return audioContext.createMediaStreamSource(stream);
  } catch (error) {
    reportAudioContextFailure(
      error,
      "graph-setup",
      audioContext,
      sessionId,
      timings,
    );
    throw error;
  }
};
