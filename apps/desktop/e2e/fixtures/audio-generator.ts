/**
 * Generate mock audio data for testing
 */

export interface AudioChunk {
  channelData: number[];
  sampleRate: number;
  timestamp: number;
}

/**
 * Generate a sine wave audio chunk
 */
export function generateSineWave(
  frequency: number = 440,
  duration: number = 0.032, // 32ms chunks (512 samples at 16kHz)
  sampleRate: number = 16000,
  amplitude: number = 0.5
): Float32Array {
  const samples = Math.floor(sampleRate * duration);
  const data = new Float32Array(samples);
  
  for (let i = 0; i < samples; i++) {
    data[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate);
  }
  
  return data;
}

/**
 * Generate speech-like audio pattern
 * Simulates formants and harmonics typical in speech
 */
export function generateSpeechLikeAudio(
  duration: number = 0.032,
  sampleRate: number = 16000
): Float32Array {
  const samples = Math.floor(sampleRate * duration);
  const data = new Float32Array(samples);
  
  // Fundamental frequency (100-200 Hz for speech)
  const f0 = 120 + Math.random() * 80;
  
  // Formants (typical vowel formants)
  const formants = [
    { freq: 700, amp: 0.3 },   // F1
    { freq: 1220, amp: 0.2 },  // F2
    { freq: 2600, amp: 0.1 },  // F3
  ];
  
  for (let i = 0; i < samples; i++) {
    let sample = 0;
    
    // Add fundamental
    sample += 0.3 * Math.sin(2 * Math.PI * f0 * i / sampleRate);
    
    // Add harmonics
    for (let h = 2; h <= 5; h++) {
      sample += (0.2 / h) * Math.sin(2 * Math.PI * f0 * h * i / sampleRate);
    }
    
    // Add formants
    for (const formant of formants) {
      sample += formant.amp * Math.sin(2 * Math.PI * formant.freq * i / sampleRate);
    }
    
    // Add slight noise
    sample += (Math.random() - 0.5) * 0.02;
    
    // Normalize
    data[i] = Math.max(-1, Math.min(1, sample));
  }
  
  return data;
}

/**
 * Generate silence (noise floor)
 */
export function generateSilence(
  duration: number = 0.032,
  sampleRate: number = 16000,
  noiseLevel: number = 0.001
): Float32Array {
  const samples = Math.floor(sampleRate * duration);
  const data = new Float32Array(samples);
  
  for (let i = 0; i < samples; i++) {
    data[i] = (Math.random() - 0.5) * noiseLevel;
  }
  
  return data;
}

/**
 * Generate a sequence of audio chunks simulating speech with pauses
 */
export function generateSpeechSequence(
  speechDuration: number = 2, // seconds
  pauseDuration: number = 0.5, // seconds
  sampleRate: number = 16000
): AudioChunk[] {
  const chunks: AudioChunk[] = [];
  const chunkDuration = 0.032; // 32ms per chunk
  let timestamp = Date.now();
  
  // Speech period
  const speechChunks = Math.floor(speechDuration / chunkDuration);
  for (let i = 0; i < speechChunks; i++) {
    chunks.push({
      channelData: Array.from(generateSpeechLikeAudio(chunkDuration, sampleRate)),
      sampleRate,
      timestamp: timestamp + i * chunkDuration * 1000,
    });
  }
  
  // Pause period
  const pauseChunks = Math.floor(pauseDuration / chunkDuration);
  const pauseStart = timestamp + speechDuration * 1000;
  for (let i = 0; i < pauseChunks; i++) {
    chunks.push({
      channelData: Array.from(generateSilence(chunkDuration, sampleRate)),
      sampleRate,
      timestamp: pauseStart + i * chunkDuration * 1000,
    });
  }
  
  return chunks;
}

/**
 * Generate audio that should trigger VAD (Voice Activity Detection)
 */
export function generateVADTriggerAudio(): AudioChunk[] {
  const chunks: AudioChunk[] = [];
  const timestamp = Date.now();
  
  // Pre-speech silence (100ms)
  for (let i = 0; i < 3; i++) {
    chunks.push({
      channelData: Array.from(generateSilence()),
      sampleRate: 16000,
      timestamp: timestamp + i * 32,
    });
  }
  
  // Speech (500ms) - should trigger VAD
  for (let i = 0; i < 15; i++) {
    chunks.push({
      channelData: Array.from(generateSpeechLikeAudio()),
      sampleRate: 16000,
      timestamp: timestamp + 100 + i * 32,
    });
  }
  
  // Post-speech silence (1000ms) - should trigger flush
  for (let i = 0; i < 31; i++) {
    chunks.push({
      channelData: Array.from(generateSilence()),
      sampleRate: 16000,
      timestamp: timestamp + 600 + i * 32,
    });
  }
  
  return chunks;
}