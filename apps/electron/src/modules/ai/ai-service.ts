import { TranscriptionClient } from './transcription-client';

export class AiService {
  private transcriptionClient: TranscriptionClient;

  constructor(transcriptionClient: TranscriptionClient) {
    this.transcriptionClient = transcriptionClient;
  }

  async transcribeAudio(audioData: Buffer): Promise<string> {
    if (!this.transcriptionClient) {
      throw new Error('Transcription client is not initialized.');
    }
    return this.transcriptionClient.transcribe(audioData);
  }

  // Future methods for other AI functionalities can be added here
  // e.g., text summarization, sentiment analysis, etc.
}
