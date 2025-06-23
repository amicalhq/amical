import { ContextualTranscriptionClient } from './transcription-session';
import * as fs from 'fs';
import { logger } from '../../main/logger';
import { ModelManagerService } from '../models/model-manager';
import { Whisper } from 'smart-whisper';

export class ContextualLocalWhisperClient implements ContextualTranscriptionClient {
  private modelManager: ModelManagerService;
  private selectedModelId: string | null = null;
  private whisperInstance: any = null; // Will be imported from smart-whisper

  constructor(modelManager: ModelManagerService, selectedModelId?: string) {
    this.modelManager = modelManager;
    this.selectedModelId = selectedModelId || null;
  }

  private async initializeWhisper(): Promise<void> {
    if (this.whisperInstance) {
      return; // Already initialized
    }

    const modelPath = await this.getBestAvailableModel();
    if (!modelPath) {
      throw new Error('No Whisper models available. Please download a model first.');
    }

    try {
      this.whisperInstance = new Whisper(modelPath);
      logger.ai.info('Smart-whisper initialized for contextual transcription', { modelPath });
    } catch (error) {
      logger.ai.error('Failed to initialize smart-whisper for contextual transcription', { 
        error: error instanceof Error ? error.message : String(error),
        modelPath 
      });
      throw new Error(`Failed to initialize smart-whisper: ${error}`);
    }
  }

  async transcribeWithContext(audioData: Buffer, previousContext: string): Promise<string> {
    try {
      await this.initializeWhisper();

      // Convert audio buffer to the format expected by smart-whisper
      const audioFloat32Array = await this.convertAudioBuffer(audioData);

      // Prepare initial prompt with context for better continuity
      let prompt = '';
      if (previousContext && previousContext.trim().length > 0) {
        // Use last ~50 words as context/prompt
        const contextWords = previousContext.trim().split(/\\s+/);
        const maxWords = 50;
        prompt = contextWords.length > maxWords 
          ? contextWords.slice(-maxWords).join(' ')
          : previousContext.trim();
      }

      logger.ai.info('Starting smart-whisper contextual transcription', { 
        audioDataSize: audioData.length,
        convertedSize: audioFloat32Array.length,
        hasContext: prompt.length > 0,
        contextLength: prompt.length
      });

      // Transcribe using smart-whisper with initial prompt for context
      const transcriptionOptions: any = { 
        language: 'auto'
      };
      
      // Add initial prompt if we have context
      if (prompt) {
        transcriptionOptions.initial_prompt = prompt;
      }

      const { result } = await this.whisperInstance.transcribe(audioFloat32Array, transcriptionOptions);
      const transcription = await result;
      
      logger.ai.info('Smart-whisper contextual transcription completed', { 
        resultLength: transcription.length,
        hadContext: prompt.length > 0
      });

      return transcription;
    } catch (error) {
      logger.ai.error('Smart-whisper contextual transcription failed', { 
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(`Contextual transcription failed: ${error}`);
    }
  }

  private async convertAudioBuffer(audioData: Buffer): Promise<Float32Array> {
    // Smart-whisper expects Float32Array with 16kHz mono audio
    // This is a simplified conversion - you may need more sophisticated audio processing
    try {
      // For now, assume the audio data is already in the correct format
      // In a real implementation, you'd use an audio processing library like node-wav
      // to properly decode and resample the audio
      
      // Convert buffer to Float32Array (simplified)
      const float32Array = new Float32Array(audioData.length / 4);
      for (let i = 0; i < float32Array.length; i++) {
        // Read 32-bit float from buffer (little-endian)
        float32Array[i] = audioData.readFloatLE(i * 4);
      }
      
      return float32Array;
    } catch (error) {
      logger.ai.warn('Audio conversion failed, trying alternative method', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      // Fallback: convert as if it's PCM data
      const samples = new Float32Array(audioData.length / 2);
      for (let i = 0; i < samples.length; i++) {
        // Convert 16-bit signed PCM to float (-1 to 1)
        const sample = audioData.readInt16LE(i * 2);
        samples[i] = sample / 32768.0;
      }
      
      return samples;
    }
  }

  private async getBestAvailableModel(): Promise<string | null> {
    const downloadedModels = this.modelManager.getDownloadedModels();
    
    // If a specific model is selected and available, use it
    if (this.selectedModelId && downloadedModels[this.selectedModelId]) {
      const model = downloadedModels[this.selectedModelId];
      if (fs.existsSync(model.localPath)) {
        return model.localPath;
      }
    }

    // Otherwise, find the best available model (prioritize by quality)
    const preferredOrder = ['whisper-large-v1', 'whisper-medium', 'whisper-small', 'whisper-base', 'whisper-tiny'];
    
    for (const modelId of preferredOrder) {
      const model = downloadedModels[modelId];
      if (model && fs.existsSync(model.localPath)) {
        return model.localPath;
      }
    }

    return null;
  }

  // Set the model to use for transcription
  setSelectedModel(modelId: string): void {
    const downloadedModels = this.modelManager.getDownloadedModels();
    if (!downloadedModels[modelId]) {
      throw new Error(`Model not downloaded: ${modelId}`);
    }
    
    // If we're changing models, free the current instance
    if (this.selectedModelId !== modelId && this.whisperInstance) {
      this.freeWhisperInstance();
    }
    
    this.selectedModelId = modelId;
    logger.ai.info('Selected model for contextual transcription', { modelId });
  }

  // Get the currently selected model
  getSelectedModel(): string | null {
    return this.selectedModelId;
  }

  // Check if whisper is available
  isAvailable(): boolean {
    const downloadedModels = this.modelManager.getDownloadedModels();
    return Object.keys(downloadedModels).some(modelId => 
      fs.existsSync(downloadedModels[modelId].localPath)
    );
  }

  // Get available models
  getAvailableModels(): string[] {
    const downloadedModels = this.modelManager.getDownloadedModels();
    return Object.keys(downloadedModels).filter(modelId => 
      fs.existsSync(downloadedModels[modelId].localPath)
    );
  }

  // Free resources
  async dispose(): Promise<void> {
    await this.freeWhisperInstance();
  }

  private async freeWhisperInstance(): Promise<void> {
    if (this.whisperInstance) {
      try {
        await this.whisperInstance.free();
        logger.ai.info('Smart-whisper contextual instance freed');
      } catch (error) {
        logger.ai.warn('Error freeing smart-whisper contextual instance', { 
          error: error instanceof Error ? error.message : String(error) 
        });
      } finally {
        this.whisperInstance = null;
      }
    }
  }
}
