/**
 * Convert raw PCM audio data to WAV format
 * @param rawData Raw audio buffer (Float32 PCM)
 * @param sampleRate Sample rate (default: 16000)
 * @returns WAV file buffer
 */
export function convertRawToWav(
  rawData: Buffer,
  sampleRate: number = 16000,
): Buffer {
  // Convert Float32 buffer to Float32Array
  const float32Data = new Float32Array(
    rawData.buffer,
    rawData.byteOffset,
    rawData.length / 4,
  );

  // Convert Float32 to Int16
  const int16Data = new Int16Array(float32Data.length);
  for (let i = 0; i < float32Data.length; i++) {
    // Clamp to [-1, 1] range and convert to int16
    const sample = Math.max(-1, Math.min(1, float32Data[i]));
    int16Data[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  // WAV file parameters
  const channels = 1; // Mono
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = int16Data.length * 2;
  const fileSize = 36 + dataSize;

  // Create WAV header
  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;

  // RIFF chunk descriptor
  buffer.write("RIFF", offset);
  offset += 4;
  buffer.writeUInt32LE(fileSize, offset);
  offset += 4;
  buffer.write("WAVE", offset);
  offset += 4;

  // fmt sub-chunk
  buffer.write("fmt ", offset);
  offset += 4;
  buffer.writeUInt32LE(16, offset); // Subchunk1Size
  offset += 4;
  buffer.writeUInt16LE(1, offset); // AudioFormat (PCM)
  offset += 2;
  buffer.writeUInt16LE(channels, offset);
  offset += 2;
  buffer.writeUInt32LE(sampleRate, offset);
  offset += 4;
  buffer.writeUInt32LE(byteRate, offset);
  offset += 4;
  buffer.writeUInt16LE(blockAlign, offset);
  offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset);
  offset += 2;

  // data sub-chunk
  buffer.write("data", offset);
  offset += 4;
  buffer.writeUInt32LE(dataSize, offset);
  offset += 4;

  // Write audio data
  for (let i = 0; i < int16Data.length; i++) {
    buffer.writeInt16LE(int16Data[i], offset);
    offset += 2;
  }

  return buffer;
}
