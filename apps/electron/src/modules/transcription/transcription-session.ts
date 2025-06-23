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
}

export interface ContextualTranscriptionClient {
  transcribeWithContext(audioData: Buffer, previousContext: string): Promise<string>;
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

  constructor(sessionId: string, transcriptionClient: ContextualTranscriptionClient) {
    super();
    this.sessionId = sessionId;
    this.transcriptionClient = transcriptionClient;
    this.logger.info('TranscriptionSession created', { sessionId });
  }

  public addChunk(chunkData: ChunkData): void {
    if (chunkData.sessionId !== this.sessionId) {
      this.logger.warn('Received chunk for different session', {
        expected: this.sessionId,
        received: chunkData.sessionId
      });
      return;
    }

    if (this.isComplete) {
      this.logger.warn('Session already complete, ignoring chunk', {
        sessionId: this.sessionId,
        chunkId: chunkData.chunkId
      });
      return;
    }

    this.logger.info('Adding chunk to queue', {
      sessionId: this.sessionId,
      chunkId: chunkData.chunkId,
      isFinalChunk: chunkData.isFinalChunk,
      audioDataSize: chunkData.audioData.length
    });

    this.chunkQueue.push(chunkData);
    this.processNextChunk();
  }

  private async processNextChunk(): Promise<void> {
    if (this.isProcessing || this.chunkQueue.length === 0) {
      return;
    }

    // Find the next expected chunk in sequence
    const nextChunkIndex = this.chunkQueue.findIndex(chunk => chunk.chunkId === this.expectedChunkId);
    
    if (nextChunkIndex === -1) {
      this.logger.debug('Next expected chunk not yet available', {
        expectedChunkId: this.expectedChunkId,
        availableChunks: this.chunkQueue.map(c => c.chunkId)
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
        error: error instanceof Error ? error.message : String(error)
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

    this.logger.info('Starting transcription for chunk', {
      sessionId: this.sessionId,
      chunkId: chunk.chunkId,
      audioDataSize: chunk.audioData.length,
      contextLength: this.accumulatedText.length
    });

    // Skip transcription for empty chunks (but still process them for completion)
    if (chunk.audioData.length === 0) {
      this.logger.info('Skipping transcription for empty chunk', {
        sessionId: this.sessionId,
        chunkId: chunk.chunkId
      });
      
      const result: ChunkResult = {
        chunkId: chunk.chunkId,
        text: '',
        processingTimeMs: Date.now() - startTime
      };
      
      this.results.push(result);
      this.emit('chunk-completed', result);
      return;
    }

    const transcriptionText = await this.transcriptionClient.transcribeWithContext(
      chunk.audioData,
      this.accumulatedText
    );

    const processingTimeMs = Date.now() - startTime;

    const result: ChunkResult = {
      chunkId: chunk.chunkId,
      text: transcriptionText,
      processingTimeMs
    };

    // Accumulate the transcription text for context
    this.accumulatedText += (this.accumulatedText ? ' ' : '') + transcriptionText;

    this.results.push(result);

    this.logger.info('Chunk transcription completed', {
      sessionId: this.sessionId,
      chunkId: chunk.chunkId,
      textLength: transcriptionText.length,
      processingTimeMs,
      accumulatedTextLength: this.accumulatedText.length
    });

    this.emit('chunk-completed', result);
  }

  private completeSession(): void {
    this.isComplete = true;
    
    const totalProcessingTime = this.results.reduce((sum, result) => sum + result.processingTimeMs, 0);
    
    this.logger.info('Transcription session completed', {
      sessionId: this.sessionId,
      totalChunks: this.results.length,
      finalTextLength: this.accumulatedText.length,
      totalProcessingTimeMs: totalProcessingTime
    });

    this.emit('session-completed', {
      sessionId: this.sessionId,
      finalText: this.accumulatedText,
      chunkResults: this.results,
      totalProcessingTimeMs: totalProcessingTime
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