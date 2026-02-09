import { describe, it, expect } from "vitest";
import {
  CheckFoundationModelAvailabilityResultSchema,
} from "../src/schemas/methods/check-foundation-model-availability";
import {
  GenerateWithFoundationModelParamsSchema,
  GenerateWithFoundationModelResultSchema,
} from "../src/schemas/methods/generate-with-foundation-model";

describe("Foundation Model Schemas", () => {
  describe("CheckFoundationModelAvailabilityResultSchema", () => {
    it("should accept available result", () => {
      const result = CheckFoundationModelAvailabilityResultSchema.parse({
        available: true,
      });
      expect(result).toEqual({ available: true });
    });

    it("should accept unavailable with reason", () => {
      const result = CheckFoundationModelAvailabilityResultSchema.parse({
        available: false,
        reason: "deviceNotEligible",
      });
      expect(result).toEqual({
        available: false,
        reason: "deviceNotEligible",
      });
    });

    it("should accept unavailable without reason", () => {
      const result = CheckFoundationModelAvailabilityResultSchema.parse({
        available: false,
      });
      expect(result).toEqual({ available: false });
    });

    it("should reject missing available field", () => {
      expect(() =>
        CheckFoundationModelAvailabilityResultSchema.parse({}),
      ).toThrow();
    });

    it("should reject non-boolean available", () => {
      expect(() =>
        CheckFoundationModelAvailabilityResultSchema.parse({
          available: "yes",
        }),
      ).toThrow();
    });
  });

  describe("GenerateWithFoundationModelParamsSchema", () => {
    it("should accept required fields", () => {
      const result = GenerateWithFoundationModelParamsSchema.parse({
        systemPrompt: "sys",
        userPrompt: "user",
      });
      expect(result).toBeDefined();
      expect(result.systemPrompt).toBe("sys");
      expect(result.userPrompt).toBe("user");
    });

    it("should accept optional temperature and maxTokens", () => {
      const result = GenerateWithFoundationModelParamsSchema.parse({
        systemPrompt: "sys",
        userPrompt: "user",
        temperature: 0.5,
        maxTokens: 1000,
      });
      expect(result.temperature).toBe(0.5);
      expect(result.maxTokens).toBe(1000);
    });

    it("should reject missing systemPrompt", () => {
      expect(() =>
        GenerateWithFoundationModelParamsSchema.parse({
          userPrompt: "user",
        }),
      ).toThrow();
    });

    it("should reject missing userPrompt", () => {
      expect(() =>
        GenerateWithFoundationModelParamsSchema.parse({
          systemPrompt: "sys",
        }),
      ).toThrow();
    });

    it("should reject non-string systemPrompt", () => {
      expect(() =>
        GenerateWithFoundationModelParamsSchema.parse({
          systemPrompt: 123,
          userPrompt: "user",
        }),
      ).toThrow();
    });
  });

  describe("GenerateWithFoundationModelResultSchema", () => {
    it("should accept content string", () => {
      const result = GenerateWithFoundationModelResultSchema.parse({
        content: "hello",
      });
      expect(result).toEqual({ content: "hello" });
    });

    it("should accept empty content string", () => {
      const result = GenerateWithFoundationModelResultSchema.parse({
        content: "",
      });
      expect(result).toEqual({ content: "" });
    });

    it("should reject missing content", () => {
      expect(() =>
        GenerateWithFoundationModelResultSchema.parse({}),
      ).toThrow();
    });

    it("should reject non-string content", () => {
      expect(() =>
        GenerateWithFoundationModelResultSchema.parse({ content: 123 }),
      ).toThrow();
    });
  });
});
