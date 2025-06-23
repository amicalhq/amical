import { ContextualTranscriptionClient } from './transcription-session';
import { ContextualLocalWhisperClient } from './contextual-local-whisper-client';
import { ModelManagerService } from '../models/model-manager';
import { createScopedLogger } from '../../main/logger';

export class ContextualTranscriptionManager {
  private logger = createScopedLogger('contextual-transcription-manager');

  constructor(
    private modelManagerService: ModelManagerService | null = null
  ) {}

  createTranscriptionClient(
    provider: 'local',
    options: { modelId?: string } = {}
  ): ContextualTranscriptionClient {
    
    switch (provider) {
      case 'local':
        if (!this.modelManagerService) {
          throw new Error('ModelManagerService is required for local transcription client');
        }
        this.logger.info('Creating local Whisper contextual transcription client', {
          selectedModelId: options.modelId
        });
        return new ContextualLocalWhisperClient(this.modelManagerService, options.modelId);

      default:
        throw new Error(`Unknown transcription provider: ${provider}`);
    }
  }

  // Get the default provider based on configuration
  getDefaultProvider(): 'local' {
    return 'local';
  }

  // Create default client with current configuration
  createDefaultClient(): ContextualTranscriptionClient {
    return this.createTranscriptionClient('local');
  }
}