class AudioRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = 512; // 32ms at 16kHz
    this.sampleRate = 16000;
    this.buffer = [];
    this.stereoDownmixEnabled = false;
    this.inputChannelCount = 0;
    this.recording = false;

    // Listen for control messages
    this.port.onmessage = (event) => {
      if (event.data.type === "start") {
        this.buffer = [];
        this.inputChannelCount = 0;
        this.stereoDownmixEnabled = event.data.stereoDownmixEnabled === true;
        this.recording = true;
      } else if (event.data.type === "flush") {
        this.recording = false;
        this.flushBuffer();
      }
    };
  }

  flushBuffer() {
    // Always send a final frame to signal end of recording
    const finalFrame = new Float32Array(this.buffer);
    this.buffer = [];

    this.port.postMessage({
      type: "audioFrame",
      frame: finalFrame,
      isFinal: true,
      inputChannelCount: this.inputChannelCount,
    });
  }

  process(inputs, outputs, parameters) {
    if (!this.recording) return true;
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    this.inputChannelCount = input.length;
    const mixStereo = this.stereoDownmixEnabled && input.length === 2;

    // Add samples to buffer
    for (let i = 0; i < channelData.length; i++) {
      this.buffer.push(
        mixStereo ? (channelData[i] + input[1][i]) / 2 : channelData[i],
      );
    }

    // When we have enough samples, send a frame
    while (this.buffer.length >= this.frameSize) {
      const frame = this.buffer.slice(0, this.frameSize);
      this.buffer = this.buffer.slice(this.frameSize);

      // Send frame to main thread
      this.port.postMessage({
        type: "audioFrame",
        frame: new Float32Array(frame),
        isFinal: false,
        inputChannelCount: this.inputChannelCount,
      });
    }

    return true;
  }
}

registerProcessor("audio-recorder-processor", AudioRecorderProcessor);
