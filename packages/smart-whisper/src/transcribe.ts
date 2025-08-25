import EventEmitter from "node:events";
import type { WhisperModel } from "./model";
import { TranscribeFormat, TranscribeParams, TranscribeResult } from "./types";
import { binding } from "./binding";

export class TranscribeTask<
	Format extends TranscribeFormat,
	TokenTimestamp extends boolean,
> extends EventEmitter {
	private _model: WhisperModel;
	private _result: Promise<TranscribeResult<Format, TokenTimestamp>[]> | null = null;

	/**
	 * You should not construct this class directly, use {@link TranscribeTask.run} instead.
	 */
	constructor(model: WhisperModel) {
		super();
		this._model = model;
	}

	get model(): WhisperModel {
		return this._model;
	}

	/**
	 * A promise that resolves to the result of the transcription task.
	 */
	get result(): Promise<TranscribeResult<Format, TokenTimestamp>[]> {
		if (this._result === null) {
			throw new Error("Task has not been started");
		}
		return this._result;
	}

	private async _run(
		pcm: Float32Array,
		params: Partial<TranscribeParams<Format, TokenTimestamp>>,
	): Promise<TranscribeResult<Format, TokenTimestamp>[]> {
		return new Promise((resolve) => {
			const handle = this.model.handle;
			if (!handle) {
				throw new Error("Model has been freed");
			}

			binding.transcribe(
				handle,
				pcm,
				params,
				(results) => {
					this.emit("finish");
					resolve(results);
				},
				(result) => {
					this.emit("transcribed", result);
				},
			);
		});
	}

	static async run<Format extends TranscribeFormat, TokenTimestamp extends boolean>(
		model: WhisperModel,
		pcm: Float32Array,
		params: Partial<TranscribeParams<Format, TokenTimestamp>>,
	): Promise<TranscribeTask<Format, TokenTimestamp>> {
		if (model.freed) {
			throw new Error("Model has been freed");
		}

		const task = new TranscribeTask(model);
		task._result = task._run(pcm, params);

		return task;
	}

	on(
		event: "finish",
		listener: (results: TranscribeResult<Format, TokenTimestamp>[]) => void,
	): this;
	on(
		event: "transcribed",
		listener: (result: TranscribeResult<Format, TokenTimestamp>) => void,
	): this;
	on(event: string, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	once(
		event: "finish",
		listener: (results: TranscribeResult<Format, TokenTimestamp>[]) => void,
	): this;
	once(
		event: "transcribed",
		listener: (result: TranscribeResult<Format, TokenTimestamp>) => void,
	): this;
	once(event: string, listener: (...args: any[]) => void): this {
		return super.once(event, listener);
	}

	off(
		event: "finish",
		listener: (results: TranscribeResult<Format, TokenTimestamp>[]) => void,
	): this;
	off(
		event: "transcribed",
		listener: (result: TranscribeResult<Format, TokenTimestamp>) => void,
	): this;
	off(event: string, listener: (...args: any[]) => void): this {
		return super.off(event, listener);
	}
}
