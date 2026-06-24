export interface PreparedAudioContext {
  audioContext: AudioContext;
  createdAt?: number;
}

export const createOrResumeAudioContext = async ({
  currentAudioContext,
  sampleRate,
  audioWorkletUrl,
}: {
  currentAudioContext: AudioContext | null;
  sampleRate: number;
  audioWorkletUrl: string;
}): Promise<PreparedAudioContext> => {
  const audioContextStartTime = performance.now();

  if (currentAudioContext?.state === "suspended") {
    await currentAudioContext.resume();
    const resumeDuration = performance.now() - audioContextStartTime;
    console.log(
      `AudioCapture: AudioContext resumed took ${resumeDuration.toFixed(2)}ms`,
    );
    return { audioContext: currentAudioContext };
  }

  if (currentAudioContext) {
    console.log("AudioCapture: AudioContext already running");
    return { audioContext: currentAudioContext };
  }

  const audioContext = new AudioContext({
    sampleRate,
    latencyHint: "interactive",
  });
  const createdAt = performance.now();
  const audioContextDuration = performance.now() - audioContextStartTime;
  console.log(
    `AudioCapture: AudioContext creation took ${audioContextDuration.toFixed(2)}ms`,
  );

  try {
    const workletStartTime = performance.now();
    await audioContext.audioWorklet.addModule(audioWorkletUrl);
    const workletDuration = performance.now() - workletStartTime;
    console.log(
      `AudioCapture: audioWorklet.addModule took ${workletDuration.toFixed(2)}ms`,
    );
  } catch (error) {
    await audioContext.close().catch(() => {});
    throw error;
  }

  return { audioContext, createdAt };
};

export const createAudioCaptureGraph = (
  audioContext: AudioContext,
  stream: MediaStream,
): {
  source: MediaStreamAudioSourceNode;
  workletNode: AudioWorkletNode;
} => {
  const nodeCreationStartTime = performance.now();
  const source = audioContext.createMediaStreamSource(stream);
  const workletNode = new AudioWorkletNode(
    audioContext,
    "audio-recorder-processor",
  );
  const nodeCreationDuration = performance.now() - nodeCreationStartTime;
  console.log(
    `AudioCapture: Node creation took ${nodeCreationDuration.toFixed(2)}ms`,
  );

  return { source, workletNode };
};
