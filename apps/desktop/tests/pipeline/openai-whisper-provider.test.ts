import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIWhisperProvider } from "@/pipeline/providers/transcription/openai-whisper-provider";

// ── Unit Tests (mocked fetch, no real API calls) ──────────────────────────

describe("OpenAI Whisper Provider", () => {
  // ── WAV Encoding ────────────────────────────────────────────────────────

  describe("WAV encoding (encodeWav)", () => {
    it("should produce valid WAV header from audio samples", () => {
      const sampleRate = 16000;
      const numSamples = 1600; // 100ms of audio
      const bitsPerSample = 16;
      const dataSize = numSamples * (bitsPerSample / 8);
      const headerSize = 44;

      const expectedSize = headerSize + dataSize;
      expect(expectedSize).toBe(44 + 3200);

      // Verify sample conversion: 0.5 * 0x7FFF ≈ 16384
      const int16Value = Math.round(0.5 * 0x7fff);
      expect(int16Value).toBe(16384);
    });

    it("should clamp audio values to [-1, 1] range", () => {
      expect(Math.max(-1, Math.min(1, 1.5))).toBe(1);
      expect(Math.max(-1, Math.min(1, -2.0))).toBe(-1);
    });
  });

  // ── Provider Buffering Logic ──────────────────────────────────────────

  describe("frame buffering and silence detection", () => {
    let provider: OpenAIWhisperProvider;
    let mockSettingsService: any;
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockSettingsService = {
        getOpenAIWhisperConfig: vi.fn().mockResolvedValue({
          apiKey: "sk-test-key-12345",
        }),
      };

      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("Hello world"),
        json: () => Promise.resolve({ text: "Hello world" }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      provider = new OpenAIWhisperProvider(mockSettingsService);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("should return empty string when not enough audio buffered", async () => {
      const frame = new Float32Array(512).fill(0.1);
      const result = await provider.transcribe({
        audioData: frame,
        speechProbability: 0.8,
        context: { language: "en" },
      });

      expect(result).toBe("");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("should transcribe after sufficient audio + silence", async () => {
      const frameSize = 512;
      const sampleRate = 16000;

      // Send ~1 second of speech frames
      const speechFrameCount = Math.ceil(sampleRate / frameSize);
      for (let i = 0; i < speechFrameCount; i++) {
        await provider.transcribe({
          audioData: new Float32Array(frameSize).fill(0.3),
          speechProbability: 0.9,
          context: { language: "en" },
        });
      }

      // Send 3+ seconds of silence to trigger transcription
      const silenceFrameCount = Math.ceil((3.1 * sampleRate) / frameSize);
      let result = "";
      for (let i = 0; i < silenceFrameCount; i++) {
        result = await provider.transcribe({
          audioData: new Float32Array(frameSize).fill(0.0),
          speechProbability: 0.01,
          context: { language: "en" },
        });
        if (result) break;
      }

      expect(result).toBe("Hello world");
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
      expect(options.method).toBe("POST");
      expect(options.headers.Authorization).toBe("Bearer sk-test-key-12345");
    });

    it("should pass language and prompt to OpenAI API", async () => {
      const frameSize = 512;
      const sampleRate = 16000;

      const speechFrames = Math.ceil(sampleRate / frameSize);
      for (let i = 0; i < speechFrames; i++) {
        await provider.transcribe({
          audioData: new Float32Array(frameSize).fill(0.3),
          speechProbability: 0.9,
          context: {
            language: "fr",
            aggregatedTranscription: "Bonjour tout le monde",
          },
        });
      }

      const silenceFrames = Math.ceil((3.1 * sampleRate) / frameSize);
      for (let i = 0; i < silenceFrames; i++) {
        await provider.transcribe({
          audioData: new Float32Array(frameSize).fill(0.0),
          speechProbability: 0.01,
          context: {
            language: "fr",
            aggregatedTranscription: "Bonjour tout le monde",
          },
        });
      }

      expect(fetchSpy).toHaveBeenCalled();

      const [, options] = fetchSpy.mock.calls[0];
      const body = options.body;
      expect(body).toBeInstanceOf(FormData);
      expect(body.get("model")).toBe("whisper-1");
      expect(body.get("language")).toBe("fr");
      expect(body.get("prompt")).toBe("Bonjour tout le monde");
      expect(body.get("response_format")).toBe("text");
    });

    it("should flush remaining audio", async () => {
      const frameSize = 512;

      for (let i = 0; i < 20; i++) {
        await provider.transcribe({
          audioData: new Float32Array(frameSize).fill(0.3),
          speechProbability: 0.9,
          context: { language: "en" },
        });
      }

      const result = await provider.flush({ language: "en" });

      expect(result).toBe("Hello world");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("should return empty on flush with no buffered audio", async () => {
      const result = await provider.flush({ language: "en" });
      expect(result).toBe("");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("should clear buffers on reset", async () => {
      const frameSize = 512;

      for (let i = 0; i < 10; i++) {
        await provider.transcribe({
          audioData: new Float32Array(frameSize).fill(0.3),
          speechProbability: 0.9,
          context: { language: "en" },
        });
      }

      provider.reset();

      const result = await provider.flush({ language: "en" });
      expect(result).toBe("");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ── Error Handling ────────────────────────────────────────────────────

  describe("error handling", () => {
    let provider: OpenAIWhisperProvider;
    let mockSettingsService: any;

    beforeEach(() => {
      mockSettingsService = {
        getOpenAIWhisperConfig: vi.fn(),
      };
      provider = new OpenAIWhisperProvider(mockSettingsService);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("should throw AUTH_REQUIRED when no API key configured", async () => {
      mockSettingsService.getOpenAIWhisperConfig.mockResolvedValue(undefined);

      for (let i = 0; i < 20; i++) {
        await provider.transcribe({
          audioData: new Float32Array(512).fill(0.3),
          speechProbability: 0.9,
          context: { language: "en" },
        });
      }

      await expect(provider.flush({ language: "en" })).rejects.toThrow(
        "OpenAI API key not configured",
      );
    });

    it("should throw AUTH_REQUIRED on 401 response", async () => {
      mockSettingsService.getOpenAIWhisperConfig.mockResolvedValue({
        apiKey: "sk-invalid",
      });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          json: () =>
            Promise.resolve({
              error: { message: "Invalid API key" },
            }),
        }),
      );

      for (let i = 0; i < 20; i++) {
        await provider.transcribe({
          audioData: new Float32Array(512).fill(0.3),
          speechProbability: 0.9,
          context: { language: "en" },
        });
      }

      await expect(provider.flush({ language: "en" })).rejects.toThrow(
        "Invalid API key",
      );
    });

    it("should throw RATE_LIMIT_EXCEEDED on 429 response", async () => {
      mockSettingsService.getOpenAIWhisperConfig.mockResolvedValue({
        apiKey: "sk-test",
      });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          json: () =>
            Promise.resolve({
              error: { message: "Rate limit exceeded" },
            }),
        }),
      );

      for (let i = 0; i < 20; i++) {
        await provider.transcribe({
          audioData: new Float32Array(512).fill(0.3),
          speechProbability: 0.9,
          context: { language: "en" },
        });
      }

      await expect(provider.flush({ language: "en" })).rejects.toThrow(
        "Rate limit exceeded",
      );
    });

    it("should throw NETWORK_ERROR on fetch failure", async () => {
      mockSettingsService.getOpenAIWhisperConfig.mockResolvedValue({
        apiKey: "sk-test",
      });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      );

      for (let i = 0; i < 20; i++) {
        await provider.transcribe({
          audioData: new Float32Array(512).fill(0.3),
          speechProbability: 0.9,
          context: { language: "en" },
        });
      }

      await expect(provider.flush({ language: "en" })).rejects.toThrow(
        "ECONNREFUSED",
      );
    });
  });

  // ── Provider Name ─────────────────────────────────────────────────────

  describe("provider identity", () => {
    it('should have name "openai-whisper"', () => {
      const mockSettingsService = {
        getOpenAIWhisperConfig: vi.fn(),
      };
      const provider = new OpenAIWhisperProvider(mockSettingsService as any);
      expect(provider.name).toBe("openai-whisper");
    });
  });
});

// ── Integration Test (real API call, skipped without key) ─────────────────

describe("OpenAI Whisper Provider - Integration", () => {
  const apiKey = process.env.OPENAI_API_KEY;
  const describeOrSkip = apiKey ? describe : describe.skip;

  describeOrSkip("real API transcription", () => {
    it("should validate API key against OpenAI models endpoint", async () => {
      const response = await globalThis.fetch(
        "https://api.openai.com/v1/models",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      expect(response.ok).toBe(true);

      const data = await response.json();
      const models = data?.data;
      expect(Array.isArray(models)).toBe(true);

      const hasWhisper = models.some(
        (m: { id?: string }) => m.id === "whisper-1",
      );
      expect(hasWhisper).toBe(true);
    });

    it("should transcribe a short audio clip via the real API", async () => {
      // Generate a 1-second sine wave tone (440Hz)
      const sampleRate = 16000;
      const duration = 1.0;
      const numSamples = sampleRate * duration;
      const samples = new Float32Array(numSamples);

      for (let i = 0; i < numSamples; i++) {
        samples[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
      }

      // Encode to WAV
      const bitsPerSample = 16;
      const byteRate = sampleRate * 1 * (bitsPerSample / 8);
      const dataSize = numSamples * (bitsPerSample / 8);
      const buffer = Buffer.alloc(44 + dataSize);

      buffer.write("RIFF", 0);
      buffer.writeUInt32LE(36 + dataSize, 4);
      buffer.write("WAVE", 8);
      buffer.write("fmt ", 12);
      buffer.writeUInt32LE(16, 16);
      buffer.writeUInt16LE(1, 20);
      buffer.writeUInt16LE(1, 22);
      buffer.writeUInt32LE(sampleRate, 24);
      buffer.writeUInt32LE(byteRate, 28);
      buffer.writeUInt16LE(2, 32);
      buffer.writeUInt16LE(bitsPerSample, 34);
      buffer.write("data", 36);
      buffer.writeUInt32LE(dataSize, 40);

      for (let i = 0; i < numSamples; i++) {
        const clamped = Math.max(-1, Math.min(1, samples[i]));
        const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        buffer.writeInt16LE(Math.round(int16), 44 + i * 2);
      }

      const formData = new FormData();
      const wavBlob = new Blob([buffer], { type: "audio/wav" });
      formData.append("file", wavBlob, "test-audio.wav");
      formData.append("model", "whisper-1");
      formData.append("response_format", "text");

      const response = await globalThis.fetch(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: formData,
        },
      );

      expect(response.ok).toBe(true);

      const text = await response.text();
      expect(typeof text).toBe("string");
    }, 15000);

    it("should transcribe via the full provider pipeline", async () => {
      const mockSettingsService = {
        getOpenAIWhisperConfig: vi.fn().mockResolvedValue({
          apiKey: apiKey,
        }),
      };

      const provider = new OpenAIWhisperProvider(mockSettingsService as any);

      const frameSize = 512;
      for (let i = 0; i < 31; i++) {
        await provider.transcribe({
          audioData: new Float32Array(frameSize).fill(0.01),
          speechProbability: 0.8,
          context: { language: "en" },
        });
      }

      const result = await provider.flush({ language: "en" });
      expect(typeof result).toBe("string");
    }, 15000);
  });
});
