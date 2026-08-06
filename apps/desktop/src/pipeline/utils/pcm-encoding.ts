export const float32ToPcmS16le = (samples: Float32Array): Uint8Array => {
  const buffer = Buffer.alloc(samples.length * 2);

  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!;
    const normalized = Number.isFinite(sample)
      ? Math.max(-1, Math.min(1, sample))
      : 0;
    const int16 =
      normalized < 0
        ? Math.round(normalized * 32768)
        : Math.round(normalized * 32767);
    buffer.writeInt16LE(int16, index * 2);
  }

  return buffer;
};
