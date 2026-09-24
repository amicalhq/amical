import { audioCaptureDiagnostics } from "./audioCaptureDiagnostics";
import type { AudioCaptureTimings } from "./audioCaptureTimings";
import {
  DEFAULT_DEVICE_ID,
  resolveActiveMicrophone,
  type MicrophonePriorityEntry,
} from "@/utils/audio-devices";

export interface AcquireMicrophoneStreamOptions {
  microphonePriority: MicrophonePriorityEntry[] | undefined;
  deviceCache: AudioInputDeviceCache;
  refreshDeviceCache: boolean;
  sampleRate: number;
  timings: AudioCaptureTimings;
}

/** The recorder's device snapshot. Refreshes also run while dictation is idle. */
export class AudioInputDeviceCache {
  private devices: MediaDeviceInfo[] | null = null;
  private pending: PromiseWithResolvers<boolean> | null = null;
  private generation = 0;
  private permissionRefreshDone = false;

  refresh(): Promise<boolean> {
    const generation = ++this.generation;
    // Overlapping refreshes share a wait for the newest snapshot. An obsolete
    // enumeration must not block capture once that snapshot is available.
    const pending = (this.pending ??= Promise.withResolvers<boolean>());
    const startedAt = performance.now();
    const operation = (async () => {
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        if (generation === this.generation) {
          this.devices = allDevices.filter(
            (device) => device.kind === "audioinput",
          );
        }
        audioCaptureDiagnostics.logEnumerateDevicesTiming(
          performance.now() - startedAt,
        );
        audioCaptureDiagnostics.logAudioInputDevices(
          "Available audio input devices",
          allDevices,
        );
        return generation === this.generation;
      } catch (error) {
        if (generation === this.generation) this.devices = null;
        audioCaptureDiagnostics.logDeviceEnumerationFailure(
          "Failed to enumerate audio input devices",
          error,
        );
        return false;
      }
    })();
    void operation.then((success) => {
      if (generation !== this.generation) return;
      this.pending = null;
      pending.resolve(success);
    });
    return pending.promise;
  }

  current(): MediaDeviceInfo[] | null {
    return this.pending ? null : this.devices;
  }

  async ready(): Promise<MediaDeviceInfo[]> {
    if (!this.pending && !this.devices) await this.refresh();
    while (this.pending) await this.pending.promise;
    return this.devices ?? [];
  }

  afterPermission(): void {
    if (this.permissionRefreshDone) return;
    if (this.pending) {
      void this.pending.promise.then(() => this.afterPermission());
      return;
    }
    if (
      this.devices?.length &&
      this.devices.every((device) => device.deviceId && device.label)
    ) {
      this.permissionRefreshDone = true;
      return;
    }
    void this.refresh().then((success) => {
      if (success) this.permissionRefreshDone = true;
    });
  }
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
  deviceCache,
  refreshDeviceCache,
  sampleRate,
  timings,
}: AcquireMicrophoneStreamOptions): Promise<AcquiredMicrophoneStream> => {
  const audioConstraints: MediaTrackConstraints = {
    channelCount: 1,
    sampleRate,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };

  const refreshDevices = () =>
    timings.measure("capture.enumerate-devices", async () => {
      await deviceCache.refresh();
      return deviceCache.ready();
    });

  // Remote safeguard for devices that miss change notifications.
  const refreshedDevices = refreshDeviceCache ? await refreshDevices() : null;

  const selectPreferredDevice = (audioInputDevices: MediaDeviceInfo[]) => {
    const activeDeviceId = resolveActiveMicrophone(
      microphonePriority,
      audioInputDevices,
    );
    const preferredDevice =
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
    return preferredDevice;
  };

  let preferredDevice: MediaDeviceInfo | undefined;
  if (microphonePriority?.length) {
    const cached = refreshedDevices ?? deviceCache.current();
    const devices =
      cached ??
      (await timings.measure("capture.enumerate-devices", () =>
        deviceCache.ready(),
      ));
    preferredDevice = selectPreferredDevice(devices);
  }

  const openStream = async (device: MediaDeviceInfo | undefined) => {
    const captureSource = device ? "preferred" : "default";
    const constraints: MediaTrackConstraints = {
      ...audioConstraints,
      deviceId: { exact: device?.deviceId ?? DEFAULT_DEVICE_ID },
    };
    if (!device) {
      console.log("AudioCapture: Using Chromium default microphone alias", {
        deviceId: DEFAULT_DEVICE_ID,
      });
    }
    const startedAt = performance.now();
    const stream = await timings.measure("capture.get-user-media", () =>
      navigator.mediaDevices.getUserMedia({ audio: constraints }),
    );
    console.log(
      `AudioCapture: getUserMedia (${captureSource}) took ${(
        performance.now() - startedAt
      ).toFixed(2)}ms`,
    );
    return stream;
  };

  let stream: MediaStream;
  try {
    stream = await openStream(preferredDevice);
  } catch (error) {
    const errorName =
      typeof error === "object" && error !== null && "name" in error
        ? error.name
        : undefined;
    if (
      !preferredDevice ||
      (errorName !== "NotFoundError" && errorName !== "OverconstrainedError")
    ) {
      throw error;
    }
    const failedDeviceId = preferredDevice.deviceId;
    const refreshed = await refreshDevices();
    const devices = refreshed.filter(
      (device) => device.deviceId !== failedDeviceId,
    );
    preferredDevice = selectPreferredDevice(devices);
    stream = await openStream(preferredDevice);
  }

  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("No audio tracks available from microphone");
  }

  deviceCache.afterPermission();

  const trackSettings = audioTrack.getSettings?.() ?? {};
  const captureSource: "preferred" | "default" = preferredDevice
    ? "preferred"
    : "default";
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
