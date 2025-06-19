import { TranscriptionClient } from './transcription-client';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../../main/logger';
import { ModelManagerService } from '../models/model-manager';

export class LocalWhisperClient implements TranscriptionClient {
  private modelManager: ModelManagerService;
  private selectedModelId: string | null = null;
  private whisperExecutablePath: string | null = null;

  constructor(modelManager: ModelManagerService, selectedModelId?: string) {
    this.modelManager = modelManager;
    this.selectedModelId = selectedModelId || null;
    this.findWhisperExecutable();
  }

  private findWhisperExecutable(): void {
    // Common paths where whisper.cpp might be installed
    const commonPaths = [
      '/usr/local/bin/whisper',
      '/opt/homebrew/bin/whisper',
      '/usr/bin/whisper',
      path.join(os.homedir(), '.local/bin/whisper'),
      path.join(os.homedir(), 'whisper.cpp/main'),
      // Add more common installation paths
    ];

    for (const execPath of commonPaths) {
      if (fs.existsSync(execPath)) {
        this.whisperExecutablePath = execPath;
        logger.ai.info('Found whisper executable', { path: execPath });
        return;
      }
    }

    logger.ai.warn('Whisper executable not found in common paths');
  }

  async transcribe(audioData: Buffer): Promise<string> {
    if (!this.whisperExecutablePath) {
      throw new Error('Whisper executable not found. Please install whisper.cpp or set the path manually.');
    }

    // Get the best available model
    const modelPath = await this.getBestAvailableModel();
    if (!modelPath) {
      throw new Error('No Whisper models available. Please download a model first.');
    }

    // Create temporary audio file
    const tempDir = os.tmpdir();
    const tempAudioPath = path.join(tempDir, `whisper_${Date.now()}.wav`);
    const tempOutputPath = path.join(tempDir, `whisper_${Date.now()}.txt`);

    try {
      // Write audio data to temporary file
      fs.writeFileSync(tempAudioPath, audioData);

      // Run whisper.cpp
      const result = await this.runWhisperProcess(modelPath, tempAudioPath, tempOutputPath);
      
      logger.ai.info('Local whisper transcription completed', { 
        modelPath,
        resultLength: result.length
      });

      return result;
    } finally {
      // Clean up temporary files
      this.cleanupTempFiles([tempAudioPath, tempOutputPath]);
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

  private async runWhisperProcess(modelPath: string, audioPath: string, outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', modelPath,
        '-f', audioPath,
        '-otxt',
        '-of', outputPath.replace('.txt', ''), // whisper.cpp adds .txt suffix
        '--no-timestamps',
        '--language', 'auto',
        '--threads', '4' // Adjust based on system capabilities
      ];

      logger.ai.debug('Running whisper command', { 
        executable: this.whisperExecutablePath,
        args: args.join(' ')
      });

      const process = spawn(this.whisperExecutablePath!, args);
      
      let stderr = '';
      let stdout = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          try {
            // Read the output file
            const outputFile = outputPath;
            if (fs.existsSync(outputFile)) {
              const transcription = fs.readFileSync(outputFile, 'utf8').trim();
              resolve(transcription);
            } else {
              reject(new Error('Whisper output file not found'));
            }
          } catch (error) {
            reject(new Error(`Failed to read whisper output: ${error}`));
          }
        } else {
          logger.ai.error('Whisper process failed', { 
            code, 
            stderr: stderr.trim(),
            stdout: stdout.trim()
          });
          reject(new Error(`Whisper process failed with code ${code}: ${stderr.trim()}`));
        }
      });

      process.on('error', (error) => {
        logger.ai.error('Failed to spawn whisper process', { error: error.message });
        reject(new Error(`Failed to spawn whisper process: ${error.message}`));
      });
    });
  }

  private cleanupTempFiles(files: string[]): void {
    for (const file of files) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (error) {
        logger.ai.warn('Failed to cleanup temp file', { 
          file, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }
  }

  // Set the model to use for transcription
  setSelectedModel(modelId: string): void {
    const downloadedModels = this.modelManager.getDownloadedModels();
    if (!downloadedModels[modelId]) {
      throw new Error(`Model not downloaded: ${modelId}`);
    }
    this.selectedModelId = modelId;
    logger.ai.info('Selected model for transcription', { modelId });
  }

  // Get the currently selected model
  getSelectedModel(): string | null {
    return this.selectedModelId;
  }

  // Set custom whisper executable path
  setWhisperExecutablePath(path: string): void {
    if (!fs.existsSync(path)) {
      throw new Error(`Whisper executable not found at: ${path}`);
    }
    this.whisperExecutablePath = path;
    logger.ai.info('Set custom whisper executable path', { path });
  }

  // Check if whisper is available
  isAvailable(): boolean {
    return !!this.whisperExecutablePath;
  }

  // Get available models
  getAvailableModels(): string[] {
    const downloadedModels = this.modelManager.getDownloadedModels();
    return Object.keys(downloadedModels).filter(modelId => 
      fs.existsSync(downloadedModels[modelId].localPath)
    );
  }
} 