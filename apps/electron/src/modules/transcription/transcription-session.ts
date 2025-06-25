import { EventEmitter } from 'node:events';
import { createScopedLogger } from '../../main/logger';

export interface ChunkData {
  sessionId: string;
  chunkId: number;
  audioData: Buffer;
  isFinalChunk: boolean;
}

export interface ChunkResult {
  chunkId: number;
  text: string;
  processingTimeMs: number;
  startTime: number;
  endTime: number;
  modelInfo?: {
    modelId: string | null;
    modelPath: string | null;
  };
}

export interface ContextualTranscriptionClient {
  transcribeWithContext(audioData: Buffer, previousContext: string): Promise<string>;
  getCurrentModelInfo?: () => Promise<{ modelId: string | null; modelPath: string | null }>;
}

export class TranscriptionSession extends EventEmitter {
  private logger = createScopedLogger('transcription-session');
  private sessionId: string;
  private transcriptionClient: ContextualTranscriptionClient;

  private chunkQueue: ChunkData[] = [];
  private results: ChunkResult[] = [];
  private accumulatedText: string = '';
  private isProcessing: boolean = false;
  private expectedChunkId: number = 1;
  private isComplete: boolean = false;
  private sessionStartTime: number;

  constructor(sessionId: string, transcriptionClient: ContextualTranscriptionClient) {
    super();
    this.sessionId = sessionId;
    this.transcriptionClient = transcriptionClient;
    this.sessionStartTime = Date.now();

    this.logger.info('TranscriptionSession created', {
      sessionId,
      sessionStartTime: this.sessionStartTime,
      sessionStartTimeISO: new Date(this.sessionStartTime).toISOString(),
    });
  }

  public addChunk(chunkData: ChunkData): void {
    if (chunkData.sessionId !== this.sessionId) {
      this.logger.warn('Received chunk for different session', {
        expected: this.sessionId,
        received: chunkData.sessionId,
      });
      return;
    }

    if (this.isComplete) {
      this.logger.warn('Session already complete, ignoring chunk', {
        sessionId: this.sessionId,
        chunkId: chunkData.chunkId,
      });
      return;
    }

    this.logger.info('Adding chunk to queue', {
      sessionId: this.sessionId,
      chunkId: chunkData.chunkId,
      isFinalChunk: chunkData.isFinalChunk,
      audioDataSize: chunkData.audioData.length,
    });

    this.chunkQueue.push(chunkData);
    this.processNextChunk();
  }

  private async processNextChunk(): Promise<void> {
    if (this.isProcessing || this.chunkQueue.length === 0) {
      return;
    }

    // Find the next expected chunk in sequence
    const nextChunkIndex = this.chunkQueue.findIndex(
      (chunk) => chunk.chunkId === this.expectedChunkId
    );

    if (nextChunkIndex === -1) {
      this.logger.debug('Next expected chunk not yet available', {
        expectedChunkId: this.expectedChunkId,
        availableChunks: this.chunkQueue.map((c) => c.chunkId),
      });
      return;
    }

    const chunk = this.chunkQueue.splice(nextChunkIndex, 1)[0];
    this.isProcessing = true;

    try {
      await this.transcribeChunk(chunk);
    } catch (error) {
      this.logger.error('Error processing chunk', {
        sessionId: this.sessionId,
        chunkId: chunk.chunkId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.emit('chunk-error', { chunkId: chunk.chunkId, error });
    } finally {
      this.isProcessing = false;
      this.expectedChunkId++;

      // Check if this was the final chunk
      if (chunk.isFinalChunk) {
        this.completeSession();
      } else {
        // Process next chunk if available
        this.processNextChunk();
      }
    }
  }

  private async transcribeChunk(chunk: ChunkData): Promise<void> {
    const startTime = Date.now();
    const modelInfo = this.transcriptionClient.getCurrentModelInfo
      ? await this.transcriptionClient.getCurrentModelInfo()
      : { modelId: null, modelPath: null };

    this.logger.info('Starting transcription for chunk', {
      sessionId: this.sessionId,
      chunkId: chunk.chunkId,
      audioDataSize: chunk.audioData.length,
      contextLength: this.accumulatedText.length,
      startTime,
      startTimeISO: new Date(startTime).toISOString(),
      modelId: modelInfo.modelId,
      modelPath: modelInfo.modelPath,
    });

    // Skip transcription for empty chunks (but still process them for completion)
    if (chunk.audioData.length === 0) {
      const endTime = Date.now();
      const processingTimeMs = endTime - startTime;

      this.logger.info('Skipping transcription for empty chunk', {
        sessionId: this.sessionId,
        chunkId: chunk.chunkId,
        startTime,
        endTime,
        processingTimeMs,
        startTimeISO: new Date(startTime).toISOString(),
        endTimeISO: new Date(endTime).toISOString(),
        modelId: modelInfo.modelId,
        modelPath: modelInfo.modelPath,
      });

      const result: ChunkResult = {
        chunkId: chunk.chunkId,
        text: '',
        processingTimeMs,
        startTime,
        endTime,
        modelInfo,
      };

      this.results.push(result);
      this.emit('chunk-completed', result);
      return;
    }

    const transcriptionText = await this.transcriptionClient.transcribeWithContext(
      chunk.audioData,
      this.accumulatedText
    );

    console.error('transcriptionText result ', transcriptionText);

    const endTime = Date.now();
    const processingTimeMs = endTime - startTime;

    const result: ChunkResult = {
      chunkId: chunk.chunkId,
      text: transcriptionText,
      processingTimeMs,
      startTime,
      endTime,
      modelInfo,
    };

    // Accumulate the transcription text for context
    this.accumulatedText += (this.accumulatedText ? ' ' : '') + transcriptionText;

    this.results.push(result);

    this.logger.error('Chunk transcription completed', {
      sessionId: this.sessionId,
      chunkId: chunk.chunkId,
      textLength: transcriptionText.length,
      processingTimeMs,
      startTime,
      endTime,
      startTimeISO: new Date(startTime).toISOString(),
      endTimeISO: new Date(endTime).toISOString(),
      accumulatedTextLength: this.accumulatedText.length,
      modelId: modelInfo.modelId,
      modelPath: modelInfo.modelPath,
    });

    this.emit('chunk-completed', result);
  }

  private completeSession(): void {
    this.isComplete = true;

    const sessionEndTime = Date.now();
    const totalSessionTimeMs = sessionEndTime - this.sessionStartTime;
    const totalProcessingTime = this.results.reduce(
      (sum, result) => sum + result.processingTimeMs,
      0
    );

    // Get model info from the last successful chunk result
    const lastChunkWithModel = this.results.find((r) => r.modelInfo);
    const sessionModelInfo = lastChunkWithModel?.modelInfo || { modelId: null, modelPath: null };

    this.logger.error('Transcription session completed', {
      sessionId: this.sessionId,
      totalChunks: this.results.length,
      finalTextLength: this.accumulatedText.length,
      sessionStartTime: this.sessionStartTime,
      sessionEndTime,
      sessionStartTimeISO: new Date(this.sessionStartTime).toISOString(),
      sessionEndTimeISO: new Date(sessionEndTime).toISOString(),
      totalSessionTimeMs,
      totalProcessingTimeMs: totalProcessingTime,
      averageProcessingTimePerChunkMs:
        this.results.length > 0 ? Math.round(totalProcessingTime / this.results.length) : 0,
      processingEfficiency:
        totalSessionTimeMs > 0 ? Math.round((totalProcessingTime / totalSessionTimeMs) * 100) : 0,
      modelId: sessionModelInfo.modelId,
      modelPath: sessionModelInfo.modelPath,
      chunkTimings: this.results.map((r) => ({
        chunkId: r.chunkId,
        processingTimeMs: r.processingTimeMs,
        startTime: r.startTime,
        endTime: r.endTime,
        textLength: r.text.length,
      })),
    });

    this.emit('session-completed', {
      sessionId: this.sessionId,
      finalText: this.accumulatedText,
      chunkResults: this.results,
      totalProcessingTimeMs: totalProcessingTime,
      totalSessionTimeMs,
      sessionStartTime: this.sessionStartTime,
      sessionEndTime,
    });
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public getAccumulatedText(): string {
    return this.accumulatedText;
  }

  public getResults(): ChunkResult[] {
    return [...this.results];
  }

  public isSessionComplete(): boolean {
    return this.isComplete;
  }
}
