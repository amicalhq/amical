import * as fs from "node:fs";

/**
 * Reads a WAV file and converts it to Float32Array format for transcription
 * @param filePath Path to the WAV file
 * @returns Audio data as Float32Array, sample rate, and duration in seconds
 */
export async function readWavToFloat32(filePath: string): Promise<{
  audioData: Float32Array;
  sampleRate: number;
  duration: number;
}> {
  // Read the entire file
  const buffer = await fs.promises.readFile(filePath);

  // Parse RIFF header
  const riff = buffer.toString("ascii", 0, 4);
  if (riff !== "RIFF") {
    throw new Error("Invalid WAV file: missing RIFF header");
  }

  const wave = buffer.toString("ascii", 8, 12);
  if (wave !== "WAVE") {
    throw new Error("Invalid WAV file: missing WAVE format");
  }

  // Parse fmt sub-chunk
  const fmt = buffer.toString("ascii", 12, 16);
  if (fmt !== "fmt ") {
    throw new Error("Invalid WAV file: missing fmt chunk");
  }

  const audioFormat = buffer.readUInt16LE(20);
  if (audioFormat !== 1) {
    throw new Error(
      `Unsupported audio format: ${audioFormat} (only PCM is supported)`,
    );
  }

  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitDepth = buffer.readUInt16LE(34);

  if (bitDepth !== 16) {
    throw new Error(
      `Unsupported bit depth: ${bitDepth} (only 16-bit is supported)`,
    );
  }

  // Find data sub-chunk (may not be immediately after fmt chunk)
  let dataOffset = 36;
  while (dataOffset < buffer.length - 8) {
    const chunkId = buffer.toString("ascii", dataOffset, dataOffset + 4);
    const chunkSize = buffer.readUInt32LE(dataOffset + 4);

    if (chunkId === "data") {
      dataOffset += 8; // Move past chunk header
      break;
    }

    // Move to next chunk
    dataOffset += 8 + chunkSize;
  }

  if (dataOffset >= buffer.length) {
    throw new Error("Invalid WAV file: data chunk not found");
  }

  const dataSize = buffer.readUInt32LE(dataOffset - 4);
  const dataBuffer = buffer.subarray(dataOffset, dataOffset + dataSize);

  // Convert Int16 PCM to Float32
  const samples = dataBuffer.length / 2 / channels;
  const audioData = new Float32Array(samples);

  for (let i = 0; i < samples; i++) {
    if (channels === 1) {
      // Mono: read single sample
      const sample = dataBuffer.readInt16LE(i * 2);
      audioData[i] = sample / 32768;
    } else {
      // Stereo or multi-channel: average all channels
      let sum = 0;
      for (let ch = 0; ch < channels; ch++) {
        const sample = dataBuffer.readInt16LE((i * channels + ch) * 2);
        sum += sample / 32768;
      }
      audioData[i] = sum / channels;
    }
  }

  const duration = samples / sampleRate;

  return {
    audioData,
    sampleRate,
    duration,
  };
}
