/* eslint-disable @typescript-eslint/no-var-requires */
import { loadBinding, getLoadedBindingInfo } from "./loader";

const binding = loadBinding();

export interface WhisperOptions {
  gpu?: boolean;
}

export { getLoadedBindingInfo } from "./loader";

export class Whisper {
  private ctx: any;

  constructor(
    private modelPath: string,
    _opts?: WhisperOptions,
  ) {
    this.ctx = binding.init({ model: modelPath });
  }

  async load(): Promise<void> {
    return;
  }

  async transcribe(
    audio: Float32Array | null,
    options: Record<string, unknown>,
  ): Promise<{ result: Promise<Array<{ text: string }>> }> {
    const payload =
      audio instanceof Float32Array ? { audio, ...options } : options;
    const segments = binding.full(this.ctx, payload);
    return { result: Promise.resolve(segments) };
  }

  async free(): Promise<void> {
    binding.free(this.ctx);
  }

  static getBindingInfo(): { path: string; type: string } | null {
    return getLoadedBindingInfo();
  }
}
