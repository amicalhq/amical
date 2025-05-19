import { TranscriptionClient } from './transcription-client';
import OpenAI from 'openai';

export class OpenAIWhisperClient implements TranscriptionClient {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  async transcribe(audioData: Buffer): Promise<string> {
    if (!audioData || audioData.length === 0) {
      console.error('OpenAIWhisperClient: Received empty audio data.');
      throw new Error('Cannot transcribe empty audio data.');
    }
    try {
      // Use OpenAI.toFile to correctly prepare the audio data
      const audioFile = await OpenAI.toFile(audioData, 'audio.webm', {
        type: 'audio/webm',
      });

      console.log(
        `OpenAIWhisperClient: Transcribing audio file of size: ${audioData.length} bytes.`
      );
      console.log('OpenAIWhisperClient: audioFile object created by OpenAI.toFile:', audioFile); // Log the object

      if (!audioFile) {
        console.error('OpenAIWhisperClient: OpenAI.toFile returned undefined or null.');
        throw new Error('Failed to prepare audio file for OpenAI SDK.');
      }

      const response = await this.openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: audioFile,
      });

      return response.text;
    } catch (error) {
      console.error('Error transcribing audio with OpenAI Whisper:', error);
      throw error; // Rethrow or handle as appropriate
    }
  }
}
