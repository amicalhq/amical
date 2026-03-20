import { promises as fs } from "node:fs";

const SAMPLE_RATE = 16000;
const N_FFT = 512;
const WIN_LENGTH = 400;
const HOP_LENGTH = 160;
const PREEMPHASIS = 0.97;
const LOG_ZERO_GUARD = Math.pow(2, -24);
const DEFAULT_N_MELS = 80;
const F_MIN = 0;
const F_MAX = SAMPLE_RATE / 2;
const DECODE_SPACE_PATTERN = /^\s|\s\B|(\s)\b/g;

export interface ParakeetFeatures {
  inputFeatures: Float32Array;
  inputShape: [number, number, number];
  featuresLength: number;
}

export interface ParakeetVocabulary {
  tokens: string[];
  blankTokenId: number;
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

function buildCenteredHannWindow(): Float32Array {
  const window = new Float32Array(N_FFT);
  const pad = (N_FFT - WIN_LENGTH) / 2;
  for (let i = 0; i < WIN_LENGTH; i++) {
    window[pad + i] =
      0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN_LENGTH - 1));
  }
  return window;
}

function buildMelFilterBank(numMels: number): Float32Array[] {
  const numBins = Math.floor(N_FFT / 2) + 1;
  const fbanks: Float32Array[] = Array.from(
    { length: numMels },
    () => new Float32Array(numBins),
  );

  const minMel = hzToMel(F_MIN);
  const maxMel = hzToMel(F_MAX);
  const melPoints = new Float64Array(numMels + 2);
  for (let i = 0; i < melPoints.length; i++) {
    melPoints[i] = minMel + ((maxMel - minMel) * i) / (numMels + 1);
  }

  const bins = new Int32Array(numMels + 2);
  for (let i = 0; i < bins.length; i++) {
    const hz = melToHz(melPoints[i]);
    bins[i] = Math.floor(((N_FFT + 1) * hz) / SAMPLE_RATE);
  }

  for (let m = 1; m <= numMels; m++) {
    const left = bins[m - 1];
    const center = bins[m];
    const right = bins[m + 1];

    if (center > left) {
      for (let k = left; k < center && k < numBins; k++) {
        fbanks[m - 1][k] = (k - left) / (center - left);
      }
    }

    if (right > center) {
      for (let k = center; k < right && k < numBins; k++) {
        fbanks[m - 1][k] = (right - k) / (right - center);
      }
    }
  }

  return fbanks;
}

function createBitReverseTable(size: number): Uint16Array {
  const bits = Math.log2(size);
  const table = new Uint16Array(size);

  for (let i = 0; i < size; i++) {
    let value = i;
    let reversed = 0;
    for (let b = 0; b < bits; b++) {
      reversed = (reversed << 1) | (value & 1);
      value >>= 1;
    }
    table[i] = reversed;
  }

  return table;
}

function createTwiddleTables(size: number): {
  cos: Float32Array;
  sin: Float32Array;
} {
  const half = size / 2;
  const cos = new Float32Array(half);
  const sin = new Float32Array(half);

  for (let i = 0; i < half; i++) {
    const angle = (2 * Math.PI * i) / size;
    cos[i] = Math.cos(angle);
    sin[i] = Math.sin(angle);
  }

  return { cos, sin };
}

function fftInPlace(
  real: Float32Array,
  imag: Float32Array,
  bitReverse: Uint16Array,
  cos: Float32Array,
  sin: Float32Array,
): void {
  const n = real.length;

  for (let i = 0; i < n; i++) {
    const j = bitReverse[i];
    if (j > i) {
      const tmpR = real[i];
      real[i] = real[j];
      real[j] = tmpR;

      const tmpI = imag[i];
      imag[i] = imag[j];
      imag[j] = tmpI;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;

    for (let start = 0; start < n; start += size) {
      for (let offset = 0; offset < half; offset++) {
        const even = start + offset;
        const odd = even + half;
        const tw = offset * step;

        const wr = cos[tw];
        const wi = sin[tw];

        const oddR = real[odd];
        const oddI = imag[odd];

        const tR = oddR * wr + oddI * wi;
        const tI = oddI * wr - oddR * wi;

        real[odd] = real[even] - tR;
        imag[odd] = imag[even] - tI;
        real[even] += tR;
        imag[even] += tI;
      }
    }
  }
}

export class ParakeetFeatureExtractor {
  private readonly nMels: number;
  private readonly window = buildCenteredHannWindow();
  private readonly melBanks: Float32Array[];
  private readonly bitReverse = createBitReverseTable(N_FFT);
  private readonly twiddle = createTwiddleTables(N_FFT);

  constructor(nMels = DEFAULT_N_MELS) {
    this.nMels = nMels;
    this.melBanks = buildMelFilterBank(nMels);
  }

  extract(audioData: Float32Array): ParakeetFeatures {
    const preemphasized = new Float32Array(audioData.length);
    if (audioData.length > 0) {
      preemphasized[0] = audioData[0];
      for (let i = 1; i < audioData.length; i++) {
        preemphasized[i] = audioData[i] - PREEMPHASIS * audioData[i - 1];
      }
    }

    const padded = new Float32Array(preemphasized.length + N_FFT);
    padded.set(preemphasized, N_FFT / 2);

    const frameCount = Math.max(
      1,
      Math.floor((padded.length - N_FFT) / HOP_LENGTH) + 1,
    );
    const featuresLength = Math.max(
      1,
      Math.floor(audioData.length / HOP_LENGTH),
    );

    const logMel = new Float32Array(frameCount * this.nMels);
    const real = new Float32Array(N_FFT);
    const imag = new Float32Array(N_FFT);

    for (let frame = 0; frame < frameCount; frame++) {
      const start = frame * HOP_LENGTH;
      real.fill(0);
      imag.fill(0);

      for (let i = 0; i < N_FFT; i++) {
        real[i] = padded[start + i] * this.window[i];
      }

      fftInPlace(
        real,
        imag,
        this.bitReverse,
        this.twiddle.cos,
        this.twiddle.sin,
      );

      for (let m = 0; m < this.nMels; m++) {
        const bank = this.melBanks[m];
        let energy = 0;
        for (let k = 0; k < bank.length; k++) {
          const power = real[k] * real[k] + imag[k] * imag[k];
          energy += power * bank[k];
        }
        logMel[frame * this.nMels + m] = Math.log(energy + LOG_ZERO_GUARD);
      }
    }

    const validFrames = Math.min(featuresLength, frameCount);
    const normalized = new Float32Array(this.nMels * frameCount);

    for (let m = 0; m < this.nMels; m++) {
      let mean = 0;
      for (let f = 0; f < validFrames; f++) {
        mean += logMel[f * this.nMels + m];
      }
      mean /= validFrames;

      let variance = 0;
      for (let f = 0; f < validFrames; f++) {
        const delta = logMel[f * this.nMels + m] - mean;
        variance += delta * delta;
      }
      const denom = Math.max(validFrames - 1, 1);
      variance /= denom;

      const invStd = 1 / (Math.sqrt(variance) + 1e-5);
      for (let f = 0; f < frameCount; f++) {
        normalized[m * frameCount + f] =
          f < validFrames ? (logMel[f * this.nMels + m] - mean) * invStd : 0;
      }
    }

    return {
      inputFeatures: normalized,
      inputShape: [1, this.nMels, frameCount],
      featuresLength: validFrames,
    };
  }
}

export function decodeParakeetTokens(
  tokenIds: number[],
  vocab: string[],
): string {
  const text = tokenIds
    .map((id) => vocab[id] ?? "")
    .filter((token) => token && !token.startsWith("<|") && token !== "<unk>")
    .join("");
  return text.replace(DECODE_SPACE_PATTERN, (_match, capturedSpace) => {
    return capturedSpace ? " " : "";
  });
}

export async function loadParakeetVocabulary(
  vocabPath: string,
): Promise<ParakeetVocabulary> {
  const content = await fs.readFile(vocabPath, "utf8");
  const tokensById = new Map<number, string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const lastSpace = line.lastIndexOf(" ");
    if (lastSpace <= 0) continue;

    const token = line.slice(0, lastSpace).replace(/\u2581/g, " ");
    const id = Number.parseInt(line.slice(lastSpace + 1), 10);
    if (Number.isNaN(id)) continue;

    tokensById.set(id, token);
  }

  const maxId = Math.max(...tokensById.keys());
  const tokens: string[] = Array.from({ length: maxId + 1 }, () => "");
  for (const [id, token] of tokensById.entries()) {
    tokens[id] = token;
  }

  const blankTokenId = tokens.findIndex((token) => token === "<blk>");

  return {
    tokens,
    blankTokenId: blankTokenId >= 0 ? blankTokenId : tokens.length - 1,
  };
}
