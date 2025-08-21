import type { TranscribeFormat, TranscribeParams, TranscribeResult } from "./types";
import { WhisperModel } from "./model";
import { TranscribeTask } from "./transcribe";

export interface WhisperConfig {
	/**
	 * Time in seconds to wait before offloading the model if it's not being used.
	 */
	offload: number;

	/**
	 * Whether to use the GPU or not.
	 */
	gpu: boolean;
}

/**
 * The Whisper class is responsible for managing the lifecycle and operations of whisper model.
 * It handles the loading and offloading of the model, managing transcription tasks, and configuring model parameters.
 */
export class Whisper {
	private _file: string;
	private _available: WhisperModel | null = null;
	private _loading: Promise<WhisperModel> | null = null;
	private _tasks: Promise<TranscribeResult[]>[] = [];
	private _config: WhisperConfig;
	private _offload_timer: NodeJS.Timeout | null = null;

	/**
	 * Constructs a new Whisper instance with a specified model file and configuration.
	 * @param file - The path to the Whisper model file.
	 * @param config - Optional configuration for the Whisper instance.
	 */
	constructor(file: string, config: Partial<WhisperConfig> = {}) {
		this._file = file;
		this._config = {
			offload: 300,
			gpu: true,
			...config,
		};
	}

	get file(): string {
		return this._file;
	}

	set file(file: string) {
		this._file = file;
	}

	get config(): WhisperConfig {
		return this._config;
	}

	get tasks(): Promise<TranscribeResult[]>[] {
		return this._tasks;
	}

	reset_offload_timer(): void {
		this.clear_offload_timer();
		this._offload_timer = setTimeout(() => {
			this.free();
		}, this.config.offload * 1000);
	}

	private clear_offload_timer(): void {
		if (this._offload_timer !== null) {
			clearTimeout(this._offload_timer);
			this._offload_timer = null;
		}
	}

	async model(): Promise<WhisperModel> {
		if (this._available === null) {
			return this.load();
		}
		this.reset_offload_timer();
		return Promise.resolve(this._available);
	}

	/**
	 * Loads the whisper model asynchronously.
	 * If the model is already being loaded, returns the existing one.
	 *
	 * You don't need to call this method directly, it's called automatically if necessary when you call {@link Whisper.transcribe}.
	 *
	 * @returns A Promise that resolves to the loaded model.
	 */
	async load(): Promise<WhisperModel> {
		if (this._loading !== null) {
			return this._loading;
		}

		const model = WhisperModel.load(this.file, this.config.gpu);
		this._loading = model;
		this._available = await model;
		this._loading = null;
		this.reset_offload_timer();
		return this._available;
	}

	/**
	 * Transcribes the given PCM audio data using the Whisper model.
	 * @param pcm - The mono 16k PCM audio data to transcribe.
	 * @param params - Optional parameters for transcription.
	 * @returns A promise that resolves to the result of the transcription task.
	 */
	async transcribe<Format extends TranscribeFormat, TokenTimestamp extends boolean>(
		pcm: Float32Array,
		params: Partial<TranscribeParams<Format, TokenTimestamp>> = {},
	): Promise<TranscribeTask<Format, TokenTimestamp>> {
		const model = await this.model();
		const task = await TranscribeTask.run<Format, TokenTimestamp>(model, pcm, params);
		this._tasks.push(task.result);
		return task;
	}

	async free(): Promise<void> {
		if (this._available === null) {
			return;
		}
		const model = this._available;
		this._available = null;
		this.clear_offload_timer();
		await Promise.all(this.tasks);
		await model.free();
	}
}

/**
 * Here's a life cycle diagram of a model:
 * | Method     | (0) Not Available | (1) Loading | (2) Available | (3) Freeing | (0) Not Available |
 * |------------|-------------------|-------------|---------------|-------------|-------------------|
 * | load       | V                 | -           | -             | -           | V                 |
 * | free       | -                 | -           | wait tasks, V | -           | -                 |
 * | transcribe | load              | load        | V             | load        | load              |
 */
