import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";

const root = path.join(os.homedir(), ".smart-whisper");
const models = path.join(root, "models");
const ext = ".bin";

fs.mkdirSync(models, { recursive: true });

const BASE_MODELS_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

/**
 * MODELS is an object that contains the URLs of different ggml whisper models.
 * Each model is represented by a key-value pair, where the key is the model name
 * and the value is the URL of the model.
 */
export const MODELS = {
	tiny: `${BASE_MODELS_URL}/ggml-tiny.bin`,
	"tiny.en": `${BASE_MODELS_URL}/ggml-tiny.en.bin`,
	small: `${BASE_MODELS_URL}/ggml-small.bin`,
	"small.en": `${BASE_MODELS_URL}/ggml-small.en.bin`,
	base: `${BASE_MODELS_URL}/ggml-base.bin`,
	"base.en": `${BASE_MODELS_URL}/ggml-base.en.bin`,
	medium: `${BASE_MODELS_URL}/ggml-medium.bin`,
	"medium.en": `${BASE_MODELS_URL}/ggml-medium.en.bin`,
	"large-v1": `${BASE_MODELS_URL}/ggml-large-v1.bin`,
	"large-v2": `${BASE_MODELS_URL}/ggml-large-v2.bin`,
	"large-v3": `${BASE_MODELS_URL}/ggml-large-v3.bin`,
	"large-v3-turbo": `${BASE_MODELS_URL}/ggml-large-v3-turbo.bin`,
} as const;

export type ModelName = keyof typeof MODELS | (string & {});

/**
 * Downloads a ggml whisper model from a specified URL or shorthand.
 *
 * @param model - The model to download, specified either as a key of the {@link MODELS} object or as a URL.
 * @returns A promise that resolves to the name of the downloaded model.
 * @throws An error if the model URL or shorthand is invalid, or if the model fails to download.
 */
export async function download(model: ModelName): Promise<string> {
	let url = "",
		name = "";
	if (model in MODELS) {
		url = MODELS[model as keyof typeof MODELS];
		name = model;
	} else {
		try {
			url = new URL(model).href;
			name = new URL(url).pathname.split("/").pop() ?? "";
		} catch {}
	}

	if (!url) {
		throw new Error(`Invalid model URL or shorthand: ${model}`);
	}

	if (!name) {
		throw new Error(`Failed to parse model name: ${url}`);
	}

	if (check(name)) {
		return name;
	}

	const res = await fetch(url);
	if (!res.ok || !res.body) {
		throw new Error(`Failed to download model: ${res.statusText}`);
	}

	const stream = fs.createWriteStream(path.join(models, name.endsWith(ext) ? name : name + ext));
	Readable.fromWeb(res.body as ReadableStream<Uint8Array>).pipe(stream);

	return new Promise((resolve) => stream.on("finish", () => resolve(name)));
}

/**
 * Removes a locally downloaded model.
 * @param model - The name of the model to remove.
 */
export function remove(model: ModelName): void {
	if (check(model)) {
		fs.unlinkSync(path.join(models, model + ext));
	}
}

/**
 * Retrieves a list of model names that are available locally.
 * @returns An array of model names.
 */
export function list(): ModelName[] {
	const files = fs.readdirSync(models).filter((file) => file.endsWith(ext));
	return files.map((file) => file.slice(0, -ext.length));
}

/**
 * Checks if a model exists.
 * @param model - The name of the model.
 * @returns True if the model exists, false otherwise.
 */
export function check(model: ModelName): boolean {
	return fs.existsSync(path.join(models, model + ext));
}

/**
 * Resolves the absolute path of a model.
 * @param model - The name of the model.
 * @returns The resolved path of the model.
 * @throws Error if the model is not found.
 */
export function resolve(model: ModelName): string {
	if (check(model)) {
		return path.join(models, model + ext);
	} else {
		throw new Error(`Model not found: ${model}`);
	}
}

export const dir = { root, models };
