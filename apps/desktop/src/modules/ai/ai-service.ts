import { TranscriptionClient } from './transcription-client';
import { FormatterService } from '../formatter';

export class AiService {
  private transcriptionClient: TranscriptionClient;
  private formatterService: FormatterService;

  constructor(transcriptionClient: TranscriptionClient) {
    this.transcriptionClient = transcriptionClient;
    this.formatterService = new FormatterService();
  }

  async transcribeAudio(audioData: Buffer): Promise<string> {
    if (!this.transcriptionClient) {
      throw new Error('Transcription client is not initialized.');
    }

    // Step 1: Transcribe audio
    const transcribedText = await this.transcriptionClient.transcribe(audioData);

    // Step 2: Format the transcribed text if formatter is enabled
    const formattedText = await this.formatterService.formatText(transcribedText);

    return formattedText;
  }

  /**
   * Set formatter configuration
   */
  configureFormatter(config: any): void {
    this.formatterService.configure(config);
  }

  /**
   * Get formatter service instance
   */
  getFormatterService(): FormatterService {
    return this.formatterService;
  }

  // Future methods for other AI functionalities can be added here
  // e.g., text summarization, sentiment analysis, etc.
}
