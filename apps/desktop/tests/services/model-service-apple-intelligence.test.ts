import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock DB operations before importing ModelService
const mockUpsertModel = vi.fn();
const mockRemoveModel = vi.fn().mockResolvedValue(undefined);
const mockGetModelsByProvider = vi.fn().mockResolvedValue([]);
const mockSyncLocalWhisperModels = vi
  .fn()
  .mockResolvedValue({ added: 0, updated: 0, removed: 0 });
const mockGetDownloadedWhisperModels = vi.fn().mockResolvedValue([]);
const mockGetAllModels = vi.fn().mockResolvedValue([]);
const mockModelExists = vi.fn().mockResolvedValue(false);
const mockSyncModelsForProvider = vi.fn();
const mockRemoveModelsForProvider = vi.fn();
const mockGetModelById = vi.fn();

vi.mock("../../src/db/models", () => ({
  upsertModel: (...args: any[]) => mockUpsertModel(...args),
  removeModel: (...args: any[]) => mockRemoveModel(...args),
  getModelsByProvider: (...args: any[]) => mockGetModelsByProvider(...args),
  syncLocalWhisperModels: (...args: any[]) =>
    mockSyncLocalWhisperModels(...args),
  getDownloadedWhisperModels: () => mockGetDownloadedWhisperModels(),
  getAllModels: () => mockGetAllModels(),
  modelExists: (...args: any[]) => mockModelExists(...args),
  syncModelsForProvider: (...args: any[]) =>
    mockSyncModelsForProvider(...args),
  removeModelsForProvider: (...args: any[]) =>
    mockRemoveModelsForProvider(...args),
  getModelById: (...args: any[]) => mockGetModelById(...args),
}));

import { ModelService } from "../../src/services/model-service";

describe("ModelService - Apple Intelligence", () => {
  let modelService: ModelService;
  let mockNativeBridge: {
    call: ReturnType<typeof vi.fn>;
    isHelperRunning: ReturnType<typeof vi.fn>;
  };
  let mockSettingsService: any;

  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();

    mockNativeBridge = {
      call: vi.fn(),
      isHelperRunning: vi.fn(() => true),
    };

    mockSettingsService = {
      getDefaultSpeechModel: vi.fn().mockResolvedValue(null),
      getDefaultLanguageModel: vi.fn().mockResolvedValue(null),
      getDefaultEmbeddingModel: vi.fn().mockResolvedValue(null),
      setDefaultSpeechModel: vi.fn().mockResolvedValue(undefined),
      setDefaultLanguageModel: vi.fn().mockResolvedValue(undefined),
      setDefaultEmbeddingModel: vi.fn().mockResolvedValue(undefined),
      getModelProvidersConfig: vi.fn().mockResolvedValue({}),
      setModelProvidersConfig: vi.fn().mockResolvedValue(undefined),
      getFormatterConfig: vi.fn().mockResolvedValue({ enabled: false }),
      setFormatterConfig: vi.fn().mockResolvedValue(undefined),
    };

    modelService = new ModelService(mockSettingsService);
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  describe("syncAppleIntelligenceModel", () => {
    it("should register model when Foundation Model is available", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockNativeBridge.call.mockResolvedValue({ available: true });

      const result = await modelService.syncAppleIntelligenceModel(
        mockNativeBridge as any,
      );

      expect(result).toEqual({ available: true, reason: undefined });
      expect(mockUpsertModel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "apple-intelligence",
          provider: "AppleIntelligence",
          name: "Apple Intelligence",
          type: "language",
        }),
      );
    });

    it("should remove model when Foundation Model is not available", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockNativeBridge.call.mockResolvedValue({
        available: false,
        reason: "deviceNotEligible",
      });

      const result = await modelService.syncAppleIntelligenceModel(
        mockNativeBridge as any,
      );

      expect(result).toEqual({
        available: false,
        reason: "deviceNotEligible",
      });
      expect(mockRemoveModel).toHaveBeenCalledWith(
        "AppleIntelligence",
        "apple-intelligence",
      );
      expect(mockUpsertModel).not.toHaveBeenCalled();
    });

    it("should skip on non-macOS platforms", async () => {
      Object.defineProperty(process, "platform", { value: "win32" });

      const result = await modelService.syncAppleIntelligenceModel(
        mockNativeBridge as any,
      );

      expect(result).toEqual({ available: false, reason: "notMacOS" });
      expect(mockNativeBridge.call).not.toHaveBeenCalled();
    });

    it("should not throw on NativeBridge errors", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockNativeBridge.call.mockRejectedValue(new Error("Helper crashed"));

      const result = await modelService.syncAppleIntelligenceModel(
        mockNativeBridge as any,
      );

      expect(result).toEqual({ available: false, reason: "checkFailed" });
    });

    it("should register with correct model metadata", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockNativeBridge.call.mockResolvedValue({ available: true });

      await modelService.syncAppleIntelligenceModel(
        mockNativeBridge as any,
      );

      expect(mockUpsertModel).toHaveBeenCalledWith({
        id: "apple-intelligence",
        provider: "AppleIntelligence",
        name: "Apple Intelligence",
        type: "language",
        description: "On-device Apple Intelligence model",
        size: null,
        context: null,
        checksum: null,
        speed: null,
        accuracy: null,
        localPath: null,
        sizeBytes: null,
        downloadedAt: null,
        originalModel: null,
      });
    });

    it("should call checkFoundationModelAvailability on NativeBridge", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockNativeBridge.call.mockResolvedValue({ available: false });

      await modelService.syncAppleIntelligenceModel(
        mockNativeBridge as any,
      );

      expect(mockNativeBridge.call).toHaveBeenCalledWith(
        "checkFoundationModelAvailability",
        {},
      );
    });

    it("should not throw when removeModel fails (model not previously registered)", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockNativeBridge.call.mockResolvedValue({ available: false });
      mockRemoveModel.mockRejectedValue(new Error("Not found"));

      const result = await modelService.syncAppleIntelligenceModel(
        mockNativeBridge as any,
      );

      // Should succeed without throwing
      expect(result).toEqual({ available: false, reason: undefined });
    });
  });
});
