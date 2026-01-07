import * as fs from "node:fs";
import { logger } from "../main/logger";

/**
 * StreamingWavWriter allows incremental writing of audio data to a WAV file.
 * It writes a placeholder header initially and updates it when finalized.
 */
export class StreamingWavWriter {
  private fileStream: fs.WriteStream;
  private dataSize = 0;
  private sampleRate: number;
  private channels: number;
  private bitDepth: number;
  private isFinalized = false;

  constructor(
    filePath: string,
    sampleRate = 16000,
    channels = 1,
    bitDepth = 16,
  ) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.bitDepth = bitDepth;

    // Create write stream
    this.fileStream = fs.createWriteStream(filePath);

    // Write initial WAV header with placeholder sizes
    this.writeHeader();
  }

  /**
   * Write WAV header with current or placeholder sizes
   */
  private writeHeader(): void {
    const header = Buffer.alloc(44);

    // RIFF chunk
    header.write("RIFF", 0);
    header.writeUInt32LE(this.dataSize + 36, 4); // File size - 8
    header.write("WAVE", 8);

    // fmt sub-chunk
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16); // Sub-chunk size
    header.writeUInt16LE(1, 20); // Audio format (1 = PCM)
    header.writeUInt16LE(this.channels, 22);
    header.writeUInt32LE(this.sampleRate, 24);
    header.writeUInt32LE(
      (this.sampleRate * this.channels * this.bitDepth) / 8,
      28,
    ); // Byte rate
    header.writeUInt16LE((this.channels * this.bitDepth) / 8, 32); // Block align
    header.writeUInt16LE(this.bitDepth, 34);

    // data sub-chunk
    header.write("data", 36);
    header.writeUInt32LE(this.dataSize, 40);

    this.fileStream.write(header);
  }

  /**
   * Append audio data to the WAV file
   * @param audioData Float32Array of audio samples
   */
  async appendAudio(audioData: Float32Array): Promise<void> {
    if (!audioData.length) {
      return;
    }

    if (this.isFinalized) {
      throw new Error("Cannot append to finalized WAV file");
    }

    // Convert Float32Array to Int16 buffer
    const buffer = Buffer.alloc(audioData.length * 2);
    for (let i = 0; i < audioData.length; i++) {
      const sample = Math.max(-1, Math.min(1, audioData[i]));
      buffer.writeInt16LE(Math.floor(sample * 32767), i * 2);
    }

    // Write to file
    await new Promise<void>((resolve, reject) => {
      this.fileStream.write(buffer, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    this.dataSize += buffer.length;

    logger.transcription.debug("Appended audio to WAV file", {
      samplesWritten: audioData.length,
      bytesWritten: buffer.length,
      totalDataSize: this.dataSize,
    });
  }

  /**
   * Finalize the WAV file by updating the header with correct sizes
   */
  async finalize(): Promise<void> {
    if (this.isFinalized) return;

    this.isFinalized = true;

    // Close the stream
    await new Promise<void>((resolve) => {
      this.fileStream.end(() => resolve());
    });

    // Reopen file to update header with correct sizes
    const fd = await fs.promises.open(this.fileStream.path as string, "r+");

    try {
      // Update file size in RIFF header
      const fileSizeBuffer = Buffer.alloc(4);
      fileSizeBuffer.writeUInt32LE(this.dataSize + 36, 0);
      await fd.write(fileSizeBuffer, 0, 4, 4);

      // Update data size in data sub-chunk
      const dataSizeBuffer = Buffer.alloc(4);
      dataSizeBuffer.writeUInt32LE(this.dataSize, 0);
      await fd.write(dataSizeBuffer, 0, 4, 40);

      logger.transcription.info("Finalized WAV file", {
        path: this.fileStream.path,
        dataSize: this.dataSize,
        duration: this.dataSize / 2 / this.sampleRate, // seconds
      });
    } finally {
      await fd.close();
    }
  }

  /**
   * Abort writing and close the file stream without finalizing
   * Used when recording is cancelled
   */
  async abort(): Promise<void> {
    if (this.isFinalized) return;

    this.isFinalized = true; // Prevent further writes

    // Close the stream
    await new Promise<void>((resolve) => {
      this.fileStream.end(() => resolve());
    });

    logger.transcription.info("WAV writer aborted", {
      path: this.fileStream.path,
    });
  }

  /**
   * Get the current size of audio data written
   */
  getDataSize(): number {
    return this.dataSize;
  }

  /**
   * Get the file path
   */
  getFilePath(): string {
    return this.fileStream.path as string;
  }
}
