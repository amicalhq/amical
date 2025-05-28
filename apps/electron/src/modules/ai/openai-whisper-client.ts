import { TranscriptionClient } from './transcription-client';
import OpenAI from 'openai';
import { createScopedLogger } from '../../main/logger';

export class OpenAIWhisperClient implements TranscriptionClient {
  private openai: OpenAI;
  private logger = createScopedLogger('openai-client');

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  async transcribe(audioData: Buffer): Promise<string> {
    if (!audioData || audioData.length === 0) {
      this.logger.error('Received empty audio data');
      throw new Error('Cannot transcribe empty audio data.');
    }
    try {
      // Use OpenAI.toFile to correctly prepare the audio data
      const audioFile = await OpenAI.toFile(audioData, 'audio.webm', {
        type: 'audio/webm',
      });

      this.logger.info('Transcribing audio file', {
        sizeBytes: audioData.length,
        sizeKB: Math.round(audioData.length / 1024)
      });
      this.logger.debug('audioFile object created by OpenAI.toFile', { audioFile });

      if (!audioFile) {
        this.logger.error('OpenAI.toFile returned undefined or null');
        throw new Error('Failed to prepare audio file for OpenAI SDK.');
      }

      const response = await this.openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: audioFile,
      });

      return response.text;
    } catch (error) {
      this.logger.error('Error transcribing audio with OpenAI Whisper', { error });
      throw error; // Rethrow or handle as appropriate
    }
  }
}
