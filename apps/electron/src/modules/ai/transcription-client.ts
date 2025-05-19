export interface TranscriptionClient {
  transcribe(audioData: Buffer): Promise<string>;
}
