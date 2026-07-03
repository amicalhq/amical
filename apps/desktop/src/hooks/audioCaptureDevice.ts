import { audioCaptureDiagnostics } from "./audioCaptureDiagnostics";
import {
  DEFAULT_DEVICE_ID,
  resolveActiveMicrophone,
  type MicrophonePriorityEntry,
} from "@/utils/audio-devices";

export interface AcquireMicrophoneStreamOptions {
  microphonePriority: MicrophonePriorityEntry[] | undefined;
  sampleRate: number;
}

export interface AcquiredMicrophoneMetadata {
  name?: string;
  deviceId?: string;
  captureSource: "preferred" | "default";
}

export interface AcquiredMicrophoneStream {
  stream: MediaStream;
  audioTrack: MediaStreamTrack;
  microphone: AcquiredMicrophoneMetadata;
}

export const acquireMicrophoneStream = async ({
  microphonePriority,
  sampleRate,
}: AcquireMicrophoneStreamOptions): Promise<AcquiredMicrophoneStream> => {
  const audioConstraints: MediaTrackConstraints = {
    channelCount: 1,
    sampleRate,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };

  let preferredDevice: MediaDeviceInfo | undefined;
  if (microphonePriority?.length) {
    const enumerateStartTime = performance.now();
    const devices = await navigator.mediaDevices.enumerateDevices();
    const enumerateDuration = performance.now() - enumerateStartTime;
    const audioInputDevices = devices.filter(
      (device) => device.kind === "audioinput",
    );
    audioCaptureDiagnostics.logEnumerateDevicesTiming(enumerateDuration);
    audioCaptureDiagnostics.logAudioInputDevices(
      "Available audio input devices",
      devices,
    );

    const activeDeviceId = resolveActiveMicrophone(
      microphonePriority,
      audioInputDevices,
    );
    preferredDevice =
      activeDeviceId === DEFAULT_DEVICE_ID
        ? undefined
        : audioInputDevices.find(
            (device) => device.deviceId === activeDeviceId,
          );
    audioCaptureDiagnostics.logPreferredDeviceResolution({
      matchedBy: preferredDevice ? "deviceId" : "none",
      device: preferredDevice,
      preferredDeviceId: activeDeviceId,
      preferredName: preferredDevice?.label ?? undefined,
    });
  }

  const captureSource: "preferred" | "default" = preferredDevice
    ? "preferred"
    : "default";
  audioConstraints.deviceId = {
    exact: preferredDevice ? preferredDevice.deviceId : DEFAULT_DEVICE_ID,
  };
  if (captureSource === "default") {
    console.log("AudioCapture: Using Chromium default microphone alias", {
      deviceId: DEFAULT_DEVICE_ID,
    });
  }

  const getUserMediaStartTime = performance.now();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: audioConstraints,
  });
  console.log(
    `AudioCapture: getUserMedia (${captureSource}) took ${(
      performance.now() - getUserMediaStartTime
    ).toFixed(2)}ms`,
  );

  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("No audio tracks available from microphone");
  }

  const trackSettings = audioTrack.getSettings?.() ?? {};
  const microphoneName = audioTrack.label || preferredDevice?.label;
  const microphoneDeviceId =
    trackSettings.deviceId ||
    preferredDevice?.deviceId ||
    (captureSource === "default" ? DEFAULT_DEVICE_ID : undefined);

  return {
    stream,
    audioTrack,
    microphone: {
      name: microphoneName || undefined,
      deviceId: microphoneDeviceId,
      captureSource,
    },
  };
};
