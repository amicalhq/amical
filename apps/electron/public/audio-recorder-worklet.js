// AudioWorklet processor for real-time audio capture
// This runs in the audio rendering thread for low-latency processing
/* eslint-env worker */
/* global AudioWorkletProcessor, registerProcessor */

class AudioRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;

    // Listen for messages from main thread
    this.port.onmessage = (event) => {
      if (event.data.command === 'stop') {
        this.sendBufferedAudio(true); // Send final chunk
      }
    };
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0];

    // Check if we have input audio
    if (input && input.length > 0) {
      const inputChannel = input[0]; // Get first (mono) channel

      // Buffer the audio data
      for (let i = 0; i < inputChannel.length; i++) {
        this.buffer[this.bufferIndex] = inputChannel[i];
        this.bufferIndex++;

        // When buffer is full, send it to main thread
        if (this.bufferIndex >= this.bufferSize) {
          this.sendBufferedAudio(false);
          this.bufferIndex = 0; // Reset buffer
        }
      }
    }

    // Keep the processor alive
    return true;
  }

  sendBufferedAudio(isFinal) {
    if (this.bufferIndex > 0 || isFinal) {
      // Create a copy of the current buffer data
      const audioData = new Float32Array(this.bufferIndex);
      audioData.set(this.buffer.subarray(0, this.bufferIndex));

      // Send to main thread
      this.port.postMessage({
        type: 'audioData',
        audioData: audioData,
        isFinal: isFinal,
      });
    }
  }
}

// Register the processor
registerProcessor('audio-recorder-processor', AudioRecorderProcessor);
