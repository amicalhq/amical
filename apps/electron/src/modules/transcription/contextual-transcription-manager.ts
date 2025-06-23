import { ContextualTranscriptionClient } from './transcription-session';
import { ContextualLocalWhisperClient } from './contextual-local-whisper-client';
import { ModelManagerService } from '../models/model-manager';
import { createScopedLogger } from '../../main/logger';

export class ContextualTranscriptionManager {
  private logger = createScopedLogger('contextual-transcription-manager');
  private defaultClient: ContextualLocalWhisperClient | null = null;

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
    if (!this.defaultClient) {
      this.defaultClient = this.createTranscriptionClient('local') as ContextualLocalWhisperClient;
    }
    return this.defaultClient;
  }

  // Preload the model for faster transcription
  async preloadModel(): Promise<void> {
    const client = this.createDefaultClient() as ContextualLocalWhisperClient;
    await client.loadModel();
    this.logger.info('Model preloaded for contextual transcription');
  }

  // Free the model to save memory
  async freeModel(): Promise<void> {
    if (this.defaultClient) {
      await this.defaultClient.freeModel();
      this.logger.info('Model freed for contextual transcription');
    }
  }

  // Check if model is loaded
  isModelLoaded(): boolean {
    return this.defaultClient ? this.defaultClient.isModelLoaded() : false;
  }

  // Cleanup resources
  async dispose(): Promise<void> {
    if (this.defaultClient) {
      await this.defaultClient.dispose();
      this.defaultClient = null;
    }
  }
}