import { z } from "zod";

export const DESKTOP_STEREO_MIC_DOWNMIX_FLAG = "desktop-stereo-mic-downmix";

export const AudioCaptureInfoSchema = z.object({
  // Channels delivered to the worklet, before our mono conversion.
  inputChannelCount: z.number().int().positive(),
  trackChannelCount: z.number().int().positive().optional(),
  stereoDownmixEnabled: z.boolean(),
});

export type AudioCaptureInfo = z.infer<typeof AudioCaptureInfoSchema>;
