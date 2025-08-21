export enum WhisperSamplingStrategy {
	WHISPER_SAMPLING_GREEDY,
	WHISPER_SAMPLING_BEAM_SEARCH,
}

export type TranscribeFormat = "simple" | "detail";

/**
 * See {@link https://github.com/ggerganov/whisper.cpp/blob/00b7a4be02ca82d53ac69dd2dd438c16e2af7658/whisper.h#L433C19-L433C19} for details.
 */
export interface TranscribeParams<
	Format extends TranscribeFormat = TranscribeFormat,
	TokenTimestamp extends boolean = false,
> {
	strategy: WhisperSamplingStrategy;
	n_threads: number;
	n_max_text_ctx: number;
	offset_ms: number;
	duration_ms: number;

	translate: boolean;
	no_context: boolean;
	no_timestamps: boolean;
	single_segment: boolean;
	print_special: boolean;
	print_progress: boolean;
	print_realtime: boolean;
	print_timestamps: boolean;

	token_timestamps: TokenTimestamp;
	thold_pt: number;
	thold_ptsum: number;
	max_len: number;
	split_on_word: boolean;
	max_tokens: number;

	speed_up: boolean;
	debug_mode: boolean;
	audio_ctx: number;

	tdrz_enable: boolean;

	initial_prompt: string;

	/**
	 * Language code, e.g. "en", "de", "fr", "es", "it", "nl", "pt", "ru", "tr", "uk", "pl", "sv", "cs", "zh", "ja", "ko"
	 */
	language: string;

	suppress_blank: boolean;
	suppress_non_speech_tokens: boolean;

	temperature: number;
	max_initial_ts: number;
	length_penalty: number;

	temperature_inc: number;
	entropy_thold: number;
	logprob_thold: number;
	no_speech_thold: number;

	best_of: number;

	beam_size: number;

	format: Format;
}

export interface TranscribeSimpleResult {
	from: number;
	to: number;
	text: string;
}

/**
 * Represents a detailed result of transcription.
 */
export interface TranscribeDetailedResult<TokenTimestamp extends boolean>
	extends TranscribeSimpleResult {
	/** The detected spoken language. */
	lang: string;
	/** The confidence level of the transcription, calculated by the average probability of the tokens. */
	confidence: number;
	/** The tokens generated during the transcription process. */
	tokens: {
		/** The text of the token, for CJK languages, due to the BPE encoding, the token text may not be readable. */
		text: string;
		/** The ID of the token. */
		id: number;
		/** The probability of the token. */
		p: number;
		/** The start timestamp of the token, in milliseconds. Only available when `token_timestamps` of {@link TranscribeParams} is `true`. */
		from: TokenTimestamp extends true ? number : undefined;
		/** The end timestamp of the token, in milliseconds. Only available when `token_timestamps` of {@link TranscribeParams} is `true`. */
		to: TokenTimestamp extends true ? number : undefined;
	}[];
}

export type TranscribeResult<
	Format extends TranscribeFormat = TranscribeFormat,
	TokenTimestamp extends boolean = boolean,
> = Format extends "simple" ? TranscribeSimpleResult : TranscribeDetailedResult<TokenTimestamp>;
