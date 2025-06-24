import { ContextualTranscriptionClient } from './transcription-session';
import * as fs from 'fs';
import { logger } from '../../main/logger';
import { ModelManagerService } from '../models/model-manager';
import { TranscribeFormat, TranscribeParams, Whisper } from 'smart-whisper';

export class ContextualLocalWhisperClient implements ContextualTranscriptionClient {
  private modelManager: ModelManagerService;
  private selectedModelId: string | null = null;
  private whisperInstance : Whisper | null = null; // Will be imported from smart-whisper
  private lastUsedTimestamp: number = 0;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly MODEL_CLEANUP_DELAY_MS = 30000; // 30 seconds after last use (configurable)

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
      //! esure gpu is used if available
      this.whisperInstance = new Whisper(modelPath, { gpu: true });
      logger.ai.info('Smart-whisper instance created for contextual transcription', { modelPath });
      // Actually load the model into memory
      await this.whisperInstance.load();
      logger.ai.info('Smart-whisper model loaded into memory for contextual transcription', { modelPath });
    } catch (error) {
      logger.ai.error('Failed to initialize and load smart-whisper for contextual transcription', { 
        error: error instanceof Error ? error.message : String(error),
        modelPath 
      });
      throw new Error(`Failed to initialize and load smart-whisper: ${error}`);
    }
  }

  async transcribeWithContext(audioData: Buffer, previousContext: string): Promise<string> {
    try {
      await this.initializeWhisper();
      this.updateLastUsedTimestamp(); // Update timestamp when model is used

      // Convert audio buffer to the format expected by smart-whisper
      const audioFloat32Array = await this.convertAudioBuffer(audioData);

      // Prepare initial prompt with context for better continuity
      let prompt = '';
      if (previousContext && previousContext.trim().length > 0) {
        // Use last ~50 words as context/prompt
        const contextWords = previousContext.trim().split(/\s+/);
        const maxWords = 50;
        prompt = contextWords.length > maxWords 
          ? contextWords.slice(-maxWords).join(' ')
          : previousContext.trim();
      }

      const modelInfo = await this.getCurrentModelInfo();
      logger.ai.info('Starting smart-whisper contextual transcription', { 
        audioDataSize: audioData.length,
        convertedSize: audioFloat32Array.length,
        hasContext: prompt.length > 0,
        contextLength: prompt.length,
        modelId: modelInfo.modelId,
        modelPath: modelInfo.modelPath
      });

      // Transcribe using smart-whisper with initial prompt for context
      const transcriptionOptions: Partial<TranscribeParams<TranscribeFormat>> = { 
        language: 'auto'
      };
      
      // Add initial prompt if we have context
      if (prompt) {
        transcriptionOptions.initial_prompt = prompt;
      }

      const { result } = await this.whisperInstance!.transcribe(audioFloat32Array, transcriptionOptions);
      const transcription = await result;
      
      // Extract text from the result object
      const transcriptionText = transcription.reduce((acc, curr) => acc + curr.text, '');
      
      logger.ai.info('Smart-whisper contextual transcription completed', { 
        resultLength: transcriptionText.length,
        hadContext: prompt.length > 0,
        resultType: typeof result,
        modelId: modelInfo.modelId,
        modelPath: modelInfo.modelPath
      });

      return transcriptionText;
    } catch (error) {
      logger.ai.error('Smart-whisper contextual transcription failed', { 
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(`Contextual transcription failed: ${error}`);
    }
  }

  private async convertAudioBuffer(audioData: Buffer): Promise<Float32Array> {
    // Smart-whisper expects Float32Array with 16kHz mono audio
    // Now we're receiving raw Float32Array data from Web Audio API
    
    logger.ai.info('Converting audio buffer', {
      bufferLength: audioData.length,
      expectedFloat32Length: audioData.length / 4
    });
    
    try {
      // The audioData should now be raw Float32Array from Web Audio API (16kHz, mono)
      // Check if buffer length is divisible by 4 (Float32 = 4 bytes)
      if (audioData.length % 4 !== 0) {
        logger.ai.warn('Audio buffer length not divisible by 4, may not be Float32Array', {
          length: audioData.length,
          remainder: audioData.length % 4
        });
      }
      
      // Convert buffer back to Float32Array
      const float32Array = new Float32Array(
        audioData.buffer, 
        audioData.byteOffset, 
        audioData.length / 4
      );
      
      logger.ai.info('Successfully converted audio buffer', { 
        sampleCount: float32Array.length,
        sampleRate: '16kHz (assumed)',
        format: 'Float32Array'
      });
      
      return float32Array;
      
    } catch (error) {
      logger.ai.error('Audio conversion failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      // Fallback: try to interpret as different formats
      try {
        // Try as 16-bit PCM
        const samples = new Float32Array(audioData.length / 2);
        for (let i = 0; i < samples.length; i++) {
          const sample = audioData.readInt16LE(i * 2);
          samples[i] = sample / 32768.0;
        }
        
        logger.ai.info('Fallback: converted as 16-bit PCM', { sampleCount: samples.length });
        return samples;
        
      } catch (fallbackError) {
        logger.ai.error('All audio conversion methods failed', { 
          originalError: error instanceof Error ? error.message : String(error),
          fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        });
        
        // Return empty array as last resort
        return new Float32Array(0);
      }
    }
  }

  private async getBestAvailableModel(): Promise<string | null> {
    const downloadedModels = await this.modelManager.getDownloadedModels();
    
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
  async setSelectedModel(modelId: string): Promise<void> {
      const downloadedModels = await this.modelManager.getDownloadedModels();
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
  async isAvailable(): Promise<boolean> {
      const downloadedModels = await this.modelManager.getDownloadedModels();
      return Object.keys(downloadedModels).some(modelId => 
        fs.existsSync(downloadedModels[modelId].localPath)
      );
    }


  // Get available models
  async getAvailableModels(): Promise<string[]> {
      const downloadedModels = await this.modelManager.getDownloadedModels();
      return Object.keys(downloadedModels).filter(modelId => 
        fs.existsSync(downloadedModels[modelId].localPath)
      );
    }


  // Get current model information for logging
  async getCurrentModelInfo(): Promise<{ modelId: string | null; modelPath: string | null }> {
      const downloadedModels = await this.modelManager.getDownloadedModels();
      
      // If a specific model is selected and available, use it
      if (this.selectedModelId && downloadedModels[this.selectedModelId]) {
        const model = downloadedModels[this.selectedModelId];
        if (fs.existsSync(model.localPath)) {
          return {
            modelId: this.selectedModelId,
            modelPath: model.localPath
          };
        }
      }
  
      // Otherwise, find the best available model (same logic as getBestAvailableModel)
      const preferredOrder = ['whisper-large-v1', 'whisper-medium', 'whisper-small', 'whisper-base', 'whisper-tiny'];
      
      for (const modelId of preferredOrder) {
        const model = downloadedModels[modelId];
        if (model && fs.existsSync(model.localPath)) {
          return {
            modelId: modelId,
            modelPath: model.localPath
          };
        }
      }
  
      return { modelId: null, modelPath: null };
    }


  // Public method to preload the model
  async loadModel(): Promise<void> {
    await this.initializeWhisper();
    this.updateLastUsedTimestamp();
    logger.ai.info('Model preloaded successfully', {
      modelLoaded: this.isModelLoaded(),
      cleanupDelayMs: this.MODEL_CLEANUP_DELAY_MS
    });
  }

  // Public method to free the model
  async freeModel(): Promise<void> {
    this.clearCleanupTimer();
    await this.freeWhisperInstance();
    logger.ai.info('Model freed manually');
  }

  // Check if model is currently loaded
  isModelLoaded(): boolean {
    return this.whisperInstance !== null;
  }

  // Free resources
  async dispose(): Promise<void> {
    this.clearCleanupTimer();
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

  private updateLastUsedTimestamp(): void {
    this.lastUsedTimestamp = Date.now();
    this.scheduleCleanup();
  }

  private scheduleCleanup(): void {
    this.clearCleanupTimer();
    
    this.cleanupTimer = setTimeout(async () => {
      const timeSinceLastUse = Date.now() - this.lastUsedTimestamp;
      
      if (timeSinceLastUse >= this.MODEL_CLEANUP_DELAY_MS) {
        logger.ai.info('Auto-freeing model after inactivity', {
          inactiveTimeMs: timeSinceLastUse,
          thresholdMs: this.MODEL_CLEANUP_DELAY_MS
        });
        await this.freeWhisperInstance();
      } else {
        // Reschedule if model was used recently
        const remainingTime = this.MODEL_CLEANUP_DELAY_MS - timeSinceLastUse;
        this.cleanupTimer = setTimeout(() => this.scheduleCleanup(), remainingTime);
      }
    }, this.MODEL_CLEANUP_DELAY_MS);
  }

  private clearCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
