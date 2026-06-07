const AUDIO_CAPTURE_DIAGNOSTICS_TAG = "AudioCaptureDiagnostics";

const logMessage = (message: string) =>
  `${AUDIO_CAPTURE_DIAGNOSTICS_TAG}: ${message}`;

const summarizeAudioInputDevices = (devices: MediaDeviceInfo[]) =>
  devices
    .filter((device) => device.kind === "audioinput")
    .map((device) => ({
      deviceId: device.deviceId,
      groupId: device.groupId,
      label: device.label || "Unknown Microphone",
    }));

const getTrackSnapshot = (track: MediaStreamTrack) => {
  let settings: MediaTrackSettings | undefined;
  try {
    settings = track.getSettings();
  } catch (error) {
    console.warn(logMessage("Failed to read audio track settings"), error);
  }

  return {
    label: track.label,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
    settings,
  };
};

export const audioCaptureDiagnostics = {
  logEnumerateDevicesTiming(durationMs: number) {
    console.log(logMessage("enumerateDevices timing"), {
      durationMs: Number(durationMs.toFixed(2)),
    });
  },
  logAudioInputDevices(message: string, devices: MediaDeviceInfo[]) {
    console.log(logMessage(message), {
      devices: summarizeAudioInputDevices(devices),
    });
  },
  logDeviceEnumerationFailure(message: string, error: unknown) {
    console.warn(logMessage(message), error);
  },
  logDeviceChange(isCapturing: boolean, track?: MediaStreamTrack) {
    console.warn(logMessage("Audio device change detected"), {
      isCapturing,
      track: track ? getTrackSnapshot(track) : undefined,
    });
  },
  logTrackState(track: MediaStreamTrack) {
    console.log(logMessage("Audio track state"), {
      track: getTrackSnapshot(track),
    });
  },
  logPreferredDeviceResolution(info: {
    matchedBy: "deviceId" | "label" | "none";
    device?: { deviceId: string; label: string };
    preferredDeviceId?: string;
    preferredName?: string;
  }) {
    if (info.matchedBy === "none") {
      console.warn(
        logMessage("Preferred microphone unavailable, using system default"),
        {
          preferredDeviceId: info.preferredDeviceId,
          preferredName: info.preferredName,
        },
      );
      return;
    }
    console.log(logMessage("Using preferred microphone"), {
      matchedBy: info.matchedBy,
      deviceId: info.device?.deviceId,
      label: info.device?.label ?? info.preferredName,
    });
  },
  registerTrack(track: MediaStreamTrack) {
    const onMute = () => {
      console.warn(logMessage("MediaStreamTrack mute event"), {
        track: getTrackSnapshot(track),
      });
    };
    const onUnmute = () => {
      console.log(logMessage("MediaStreamTrack unmute event"), {
        track: getTrackSnapshot(track),
      });
    };
    const onEnded = () => {
      console.warn(logMessage("MediaStreamTrack ended event"), {
        track: getTrackSnapshot(track),
      });
    };

    track.addEventListener("mute", onMute);
    track.addEventListener("unmute", onUnmute);
    track.addEventListener("ended", onEnded);

    return () => {
      track.removeEventListener("mute", onMute);
      track.removeEventListener("unmute", onUnmute);
      track.removeEventListener("ended", onEnded);
    };
  },
};
