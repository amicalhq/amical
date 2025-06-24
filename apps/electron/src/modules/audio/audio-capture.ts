import fs, { statSync } from 'node:fs'; // Import statSync
import path from 'node:path';
import { app } from 'electron'; // To get a writable path like appData
import { EventEmitter } from 'node:events';

export class AudioCapture extends EventEmitter {
  private currentRecordingPath: string | null = null;
  private writableStream: fs.WriteStream | null = null;
  private chunkCounter: number = 0;
  private sessionId: string | null = null;

  constructor() {
    super();
    // Ensure the recordings directory exists
    const recordingsDir = path.join(app.getPath('userData'), 'recordings');
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }
  }

  public isCurrentlyRecording(): boolean {
    return this.writableStream !== null;
  }

  private finalizeRecording(): void {
    if (!this.writableStream) {
      console.warn(
        'AudioCapture: finalizeRecording called but no writableStream active. This might indicate a prior error or premature call.'
      );
      return;
    }

    console.log('AudioCapture: finalizeRecording() called, ending writable stream.');
    const streamToClose = this.writableStream;
    const recordingPathToFinalize = this.currentRecordingPath;

    this.writableStream = null; // Prevent new writes and signal "not recording"

    streamToClose.end(() => {
      console.log(`AudioCapture: Writable stream .end() callback for: ${recordingPathToFinalize}`);
      if (recordingPathToFinalize) {
        try {
          const stats = statSync(recordingPathToFinalize);
          console.log(
            `AudioCapture: File size of ${recordingPathToFinalize} is ${stats.size} bytes before emitting 'recording-finished'.`
          );
          if (stats.size === 0) {
            console.warn(
              `AudioCapture: File ${recordingPathToFinalize} is empty. Transcription will likely fail.`
            );
          }
          this.emit('recording-finished', recordingPathToFinalize);
        } catch (error: any) {
          console.error(
            `AudioCapture: Error getting file stats for ${recordingPathToFinalize}:`,
            error
          );
          this.emit(
            'recording-error',
            new Error(`Failed to get stats for ${recordingPathToFinalize}: ${error.message}`)
          );
        }
        // Only nullify currentRecordingPath if it matches the one being finalized.
        if (this.currentRecordingPath === recordingPathToFinalize) {
          this.currentRecordingPath = null;
          this.sessionId = null;
          this.chunkCounter = 0;
        }
      }
    });

    // The 'finish' event on streamToClose is mostly for logging here.
    streamToClose.on('finish', () => {
      console.log(
        `AudioCapture: Writable stream 'finish' event for the recording at ${recordingPathToFinalize}.`
      );
      // Clean up path if still relevant, though .end() callback should handle primary cleanup.
      if (this.currentRecordingPath === recordingPathToFinalize) {
        this.currentRecordingPath = null;
        this.sessionId = null;
        this.chunkCounter = 0;
      }
    });
    // Note: The 'error' handler for streamToClose was set up when it was created.
    // That handler is responsible for nulling writableStream and currentRecordingPath if an error occurs on *that* stream instance.
  }

  public handleAudioChunk(chunk: Buffer, isFinalChunk: boolean = false): void {
    if (!this.writableStream) {
      // No active stream, this could be the start of a new recording
      if (chunk.length > 0) {
        // First non-empty chunk: Start a new recording
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.sessionId = `session-${timestamp}`;
        this.chunkCounter = 0;
        this.currentRecordingPath = path.join(
          app.getPath('userData'),
          'recordings',
          `recording-${timestamp}.webm`
        );

        const newStream = fs.createWriteStream(this.currentRecordingPath);
        const recordingPathForThisStream = this.currentRecordingPath; // Capture path for this specific stream instance
        console.log(
          `AudioCapture: New recording started by first chunk. Saving to: ${recordingPathForThisStream}`
        );

        newStream.on('error', (err) => {
          console.error(
            `AudioCapture: Error on writable stream for ${recordingPathForThisStream}:`,
            err
          );
          this.emit('recording-error', err);

          // If the currently active stream in the class is the one that errored, nullify it.
          if (this.writableStream === newStream) {
            this.writableStream = null;
          }
          // If the current recording path in the class is for the stream that errored, nullify it.
          if (this.currentRecordingPath === recordingPathForThisStream) {
            this.currentRecordingPath = null;
          }
          // Ensure the stream is closed/destroyed to release resources
          if (!newStream.destroyed) {
            newStream.end();
          }
        });

        this.writableStream = newStream; // Assign to class property after setup

        // Write the first chunk
        this.writableStream.write(chunk, (writeError) => {
          if (writeError) {
            console.error(
              `AudioCapture: Error writing initial audio chunk to ${recordingPathForThisStream}:`,
              writeError
            );
            this.emit('recording-error', writeError);
            // If this write fails, the stream is likely compromised. Clean up.
            if (this.writableStream === newStream) {
              // Check if it's still our current stream
              this.writableStream = null;
            }
            if (this.currentRecordingPath === recordingPathForThisStream) {
              // Check if it's still our current path
              this.currentRecordingPath = null;
            }
            if (!newStream.destroyed) {
              newStream.end(); // Attempt to close the problematic stream
            }
            return; // Don't proceed to final chunk logic if initial write fails
          }

          // Emit chunk-ready event for immediate transcription
          this.chunkCounter++;
          console.log(`AudioCapture: Emitting chunk-ready for chunk ${this.chunkCounter}`);
          this.emit('chunk-ready', {
            sessionId: this.sessionId,
            chunkId: this.chunkCounter,
            audioData: chunk,
            isFinalChunk: isFinalChunk,
          });

          // If this very first chunk is also the final chunk
          if (isFinalChunk) {
            console.log(
              'AudioCapture: First chunk is also the final chunk. Finalizing immediately.'
            );
            this.finalizeRecording();
          }
        });
      } else {
        // Empty chunk and no stream
        if (isFinalChunk) {
          console.log(
            'AudioCapture: Received an empty final chunk, but no recording was active. No action taken.'
          );
        } else {
          console.warn(
            'AudioCapture: Received an empty non-final chunk, but no recording was active. Ignoring.'
          );
        }
      }
    } else {
      // WritableStream exists, so we are actively recording
      const activeStream = this.writableStream; // Capture current stream for this operation scope
      const activePath = this.currentRecordingPath;

      if (chunk.length > 0) {
        // console.log(`AudioCapture: Writing audio chunk of size: ${chunk.length} bytes to ${activePath}. isFinalChunk: ${isFinalChunk}`);
        activeStream.write(chunk, (writeError) => {
          if (writeError) {
            console.error(
              `AudioCapture: Error writing subsequent audio chunk to ${activePath}:`,
              writeError
            );
            this.emit('recording-error', writeError);
            // The stream's main 'error' handler should manage cleanup if the stream itself errors.
            // If only this write fails, but stream doesn't emit 'error', we might need to intervene.
            // However, a write error often leads to a stream error.
            // For safety, if this write fails, we consider the stream potentially compromised for further writes.
            // The 'error' handler on `activeStream` should ideally handle this.
            // If `isFinalChunk` was true, `finalizeRecording` won't be called due to return/error.
            // Consider calling finalizeRecording or a similar cleanup if write error on final chunk.
            // For now, relying on the stream's 'error' event for full cleanup.
          } else {
            // Emit chunk-ready event for immediate transcription
            this.chunkCounter++;
            console.log(`AudioCapture: Emitting chunk-ready for chunk ${this.chunkCounter}`);
            this.emit('chunk-ready', {
              sessionId: this.sessionId,
              chunkId: this.chunkCounter,
              audioData: chunk,
              isFinalChunk: isFinalChunk,
            });

            if (isFinalChunk) {
              console.log('AudioCapture: Final chunk written successfully. Finalizing recording.');
              this.finalizeRecording();
            }
          }
        });
      } else {
        // Empty chunk during active recording
        console.warn(
          `AudioCapture: Received empty audio chunk while recording to ${activePath}. Not writing to file.`
        );
        if (isFinalChunk) {
          console.log(
            'AudioCapture: Empty final chunk received during active recording. Finalizing recording.'
          );
          // Still emit the final chunk event even if empty
          this.emit('chunk-ready', {
            sessionId: this.sessionId,
            chunkId: this.chunkCounter, // Don't increment for empty chunks
            audioData: chunk,
            isFinalChunk: true,
          });
          this.finalizeRecording();
        }
      }
    }
  }
}
