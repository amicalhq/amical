process.env.GGML_METAL_PATH_RESOURCES =
	process.env.GGML_METAL_PATH_RESOURCES || path.join(__dirname, "../whisper.cpp/ggml/src");

import path from "node:path";
import { TranscribeFormat, TranscribeParams, TranscribeResult } from "./types";
const module = require(path.join(__dirname, "../build/Release/smart-whisper"));

/**
 * A external handle to a model.
 */
export type Handle = {
	readonly "": unique symbol;
};

export namespace Binding {
	/**
	 * Load a model from a whisper weights file.
	 * @param file The path to the whisper weights file.
	 * @param gpu Whether to use the GPU or not.
	 * @param callback A callback that will be called with the handle to the model.
	 */
	export declare function load(
		file: string,
		gpu: boolean,
		callback: (handle: Handle) => void,
	): void;

	/**
	 * Release the memory of the model, it will be unusable after this.
	 * @param handle The handle to the model.
	 * @param callback A callback that will be called when the model is freed.
	 */
	export declare function free(handle: Handle, callback: () => void): void;

	/**
	 * Transcribe a PCM buffer.
	 * @param handle The handle to the model.
	 * @param pcm The PCM buffer.
	 * @param params The parameters to use for transcription.
	 * @param finish A callback that will be called when the transcription is finished.
	 * @param progress A callback that will be called when a new result is available.
	 */
	export declare function transcribe<
		Format extends TranscribeFormat,
		TokenTimestamp extends boolean,
	>(
		handle: Handle,
		pcm: Float32Array,
		params: Partial<TranscribeParams<Format, TokenTimestamp>>,
		finish: (results: TranscribeResult<Format, TokenTimestamp>[]) => void,
		progress: (result: TranscribeResult<Format, TokenTimestamp>) => void,
	): void;

	export declare class WhisperModel {
		private _ctx;
		constructor(handle: Handle);
		get handle(): Handle | null;
		get freed(): boolean;
		/**
		 * Release the memory of the model, it will be unusable after this.
		 * It's safe to call this multiple times, but it will only free the model once.
		 */
		free(): Promise<void>;
		/**
		 * Load a model from a whisper weights file.
		 * @param file The path to the whisper weights file.
		 * @param gpu Whether to use the GPU or not.
		 * @returns A promise that resolves to a {@link WhisperModel}.
		 */
		static load(file: string, gpu?: boolean): Promise<WhisperModel>;
	}
}

/**
 * The native binding for the underlying C++ addon.
 */
export const binding: typeof Binding = module;
