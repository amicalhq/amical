/* eslint-disable @typescript-eslint/no-var-requires */
import {
  loadBinding,
  getLoadedBindingInfo,
  type LoadBindingOptions,
  type WhisperBackend,
} from "./loader";

export { loadBinding, resolveBinding, getLoadedBindingInfo } from "./loader";
export type { LoadBindingOptions, WhisperBackend } from "./loader";

export interface WhisperOptions {
  gpu?: boolean;
  gpuDevice?: number;
  flashAttn?: boolean;
  threads?: number;
  /** Force a specific native backend instead of the auto-detected best one. */
  preferredBackend?: WhisperBackend;
}

export interface WhisperSegment {
  text: string;
  lang?: string;
}

export class Whisper {
  private ctx: any;

  private defaultThreads?: number;

  constructor(
    private modelPath: string,
    opts?: WhisperOptions,
  ) {
    const loadOpts: LoadBindingOptions | undefined = opts?.preferredBackend
      ? { preferredBackend: opts.preferredBackend }
      : undefined;
    const binding = loadBinding(loadOpts);
    const initOpts: Record<string, unknown> = { model: modelPath };
    if (opts?.gpu !== undefined) initOpts.gpu = opts.gpu;
    if (opts?.gpuDevice !== undefined) initOpts.gpu_device = opts.gpuDevice;
    if (opts?.flashAttn !== undefined) initOpts.flash_attn = opts.flashAttn;
    this.defaultThreads = opts?.threads;
    this.ctx = binding.init(initOpts);
  }

  async load(): Promise<void> {
    return;
  }

  async transcribe(
    audio: Float32Array | null,
    options: Record<string, unknown>,
  ): Promise<{ result: Promise<WhisperSegment[]> }> {
    const binding = loadBinding();
    const merged: Record<string, unknown> = { ...options };
    if (this.defaultThreads !== undefined && merged.n_threads === undefined) {
      merged.n_threads = this.defaultThreads;
    }
    const payload =
      audio instanceof Float32Array ? { audio, ...merged } : merged;
    const segments = binding.full(this.ctx, payload);
    return { result: Promise.resolve(segments) };
  }

  async free(): Promise<void> {
    const binding = loadBinding();
    binding.free(this.ctx);
  }

  static getBindingInfo(): { path: string; type: string } | null {
    return getLoadedBindingInfo();
  }
}
