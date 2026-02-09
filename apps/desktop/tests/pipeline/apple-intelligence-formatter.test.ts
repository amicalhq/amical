import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppleIntelligenceFormatter } from "../../src/pipeline/providers/formatting/apple-intelligence-formatter";

// Mock the logger
vi.mock("../../src/main/logger", () => ({
  logger: {
    pipeline: {
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
  },
}));

describe("AppleIntelligenceFormatter", () => {
  let mockNativeBridge: {
    call: ReturnType<typeof vi.fn>;
    isHelperRunning: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockNativeBridge = {
      call: vi.fn(),
      isHelperRunning: vi.fn(() => true),
    };
  });

  it("should have name 'apple-intelligence'", () => {
    const formatter = new AppleIntelligenceFormatter(
      mockNativeBridge as any,
    );
    expect(formatter.name).toBe("apple-intelligence");
  });

  describe("format", () => {
    it("should call generateWithFoundationModel via NativeBridge", async () => {
      mockNativeBridge.call.mockResolvedValue({
        content: "<formatted_text>Hello world</formatted_text>",
      });

      const formatter = new AppleIntelligenceFormatter(
        mockNativeBridge as any,
      );
      const result = await formatter.format({
        text: "hello world",
        context: {},
      });

      expect(result).toBe("Hello world");
      expect(mockNativeBridge.call).toHaveBeenCalledWith(
        "generateWithFoundationModel",
        expect.objectContaining({
          userPrompt: expect.stringContaining("hello world"),
        }),
        expect.any(Number),
      );
    });

    it("should extract text from <formatted_text> tags", async () => {
      mockNativeBridge.call.mockResolvedValue({
        content:
          "Some preamble <formatted_text>Formatted output</formatted_text> trailing",
      });

      const formatter = new AppleIntelligenceFormatter(
        mockNativeBridge as any,
      );
      const result = await formatter.format({ text: "test", context: {} });
      expect(result).toBe("Formatted output");
    });

    it("should return raw content when no tags present", async () => {
      mockNativeBridge.call.mockResolvedValue({ content: "Raw response" });

      const formatter = new AppleIntelligenceFormatter(
        mockNativeBridge as any,
      );
      const result = await formatter.format({ text: "test", context: {} });
      expect(result).toBe("Raw response");
    });

    it("should return original text on NativeBridge error", async () => {
      mockNativeBridge.call.mockRejectedValue(new Error("Helper crashed"));

      const formatter = new AppleIntelligenceFormatter(
        mockNativeBridge as any,
      );
      const result = await formatter.format({
        text: "original text",
        context: {},
      });
      expect(result).toBe("original text");
    });

    it("should pass system prompt from constructFormatterPrompt", async () => {
      mockNativeBridge.call.mockResolvedValue({ content: "formatted" });

      const formatter = new AppleIntelligenceFormatter(
        mockNativeBridge as any,
      );
      await formatter.format({
        text: "test",
        context: { vocabulary: ["Amical"] },
      });

      expect(mockNativeBridge.call).toHaveBeenCalledWith(
        "generateWithFoundationModel",
        expect.objectContaining({
          systemPrompt: expect.stringContaining("text formatter"),
        }),
        expect.any(Number),
      );
    });

    it("should set temperature to 0.1 for consistent formatting", async () => {
      mockNativeBridge.call.mockResolvedValue({ content: "formatted" });

      const formatter = new AppleIntelligenceFormatter(
        mockNativeBridge as any,
      );
      await formatter.format({ text: "test", context: {} });

      expect(mockNativeBridge.call).toHaveBeenCalledWith(
        "generateWithFoundationModel",
        expect.objectContaining({ temperature: 0.1 }),
        expect.any(Number),
      );
    });

    it("should use 30 second timeout for Foundation Model calls", async () => {
      mockNativeBridge.call.mockResolvedValue({ content: "formatted" });

      const formatter = new AppleIntelligenceFormatter(
        mockNativeBridge as any,
      );
      await formatter.format({ text: "test", context: {} });

      expect(mockNativeBridge.call).toHaveBeenCalledWith(
        "generateWithFoundationModel",
        expect.any(Object),
        30000,
      );
    });

    it("should fall back to original text when formatted_text tags are empty", async () => {
      mockNativeBridge.call.mockResolvedValue({
        content: "<formatted_text></formatted_text>",
      });

      const formatter = new AppleIntelligenceFormatter(
        mockNativeBridge as any,
      );
      const result = await formatter.format({ text: "こんにちは", context: {} });
      expect(result).toBe("こんにちは");
    });

    it("should handle multiline formatted text", async () => {
      mockNativeBridge.call.mockResolvedValue({
        content:
          "<formatted_text>Line 1\nLine 2\nLine 3</formatted_text>",
      });

      const formatter = new AppleIntelligenceFormatter(
        mockNativeBridge as any,
      );
      const result = await formatter.format({ text: "test", context: {} });
      expect(result).toBe("Line 1\nLine 2\nLine 3");
    });
  });
});
