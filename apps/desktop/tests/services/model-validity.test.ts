import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  syncLocalWhisperModels,
  getDownloadedWhisperModels,
  upsertModel,
} from "../../src/db/models";
import { ModelService } from "../../src/services/model-service";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { TEST_USER_DATA_PATH } from "../helpers/electron-mocks";
import { setTestDatabase } from "../setup";

const PARAKEET_MODEL = {
  id: "parakeet-tdt-0.6b-v3-int8",
  name: "NVIDIA Parakeet TDT 0.6B v3",
  description: "Test model",
  size: "~640 MB",
  speed: 4.3,
  accuracy: 4.6,
  filename: "encoder-model.int8.onnx",
  artifacts: [
    { filename: "encoder-model.int8.onnx" },
    { filename: "decoder_joint-model.int8.onnx" },
    { filename: "nemo128.onnx" },
    { filename: "vocab.txt" },
    { filename: "config.json" },
  ],
} as const;

describe("Model validity", () => {
  let testDb: TestDatabase;
  let modelsDirectory: string;

  beforeEach(async () => {
    testDb = await createTestDatabase({ name: "model-validity-test" });
    setTestDatabase(testDb.db);
    modelsDirectory = path.join(TEST_USER_DATA_PATH, "models");
    await fs.emptyDir(modelsDirectory);
  });

  afterEach(async () => {
    await fs.emptyDir(modelsDirectory);
    await testDb.close();
  });

  it("does not sync a Parakeet install unless all artifacts are present", async () => {
    const modelDirectory = path.join(modelsDirectory, PARAKEET_MODEL.id);
    await fs.ensureDir(modelDirectory);
    await fs.writeFile(
      path.join(modelDirectory, "encoder-model.int8.onnx"),
      "encoder",
    );
    await fs.writeFile(
      path.join(modelDirectory, "decoder_joint-model.int8.onnx"),
      "decoder",
    );

    const result = await syncLocalWhisperModels(modelsDirectory, [
      PARAKEET_MODEL,
    ]);
    const downloadedModels = await getDownloadedWhisperModels();

    expect(result.added).toBe(0);
    expect(downloadedModels).toHaveLength(0);
  });

  it("syncs a complete Parakeet install with all local files recorded", async () => {
    const modelDirectory = path.join(modelsDirectory, PARAKEET_MODEL.id);
    await fs.ensureDir(modelDirectory);

    for (const artifact of PARAKEET_MODEL.artifacts) {
      await fs.writeFile(
        path.join(modelDirectory, artifact.filename),
        artifact.filename,
      );
    }

    const result = await syncLocalWhisperModels(modelsDirectory, [
      PARAKEET_MODEL,
    ]);
    const downloadedModels = await getDownloadedWhisperModels();

    expect(result.added).toBe(1);
    expect(downloadedModels).toHaveLength(1);
    expect(downloadedModels[0].localPath).toBe(
      path.join(modelDirectory, PARAKEET_MODEL.filename),
    );
    expect(downloadedModels[0].sizeBytes).toBe(
      PARAKEET_MODEL.artifacts.reduce(
        (sum, artifact) => sum + Buffer.byteLength(artifact.filename),
        0,
      ),
    );
    expect(downloadedModels[0].originalModel).toEqual({
      localFiles: PARAKEET_MODEL.artifacts.map((artifact) =>
        path.join(modelDirectory, artifact.filename),
      ),
    });
  });

  it("treats partial Parakeet bundles as not downloaded at runtime", async () => {
    const modelDirectory = path.join(modelsDirectory, PARAKEET_MODEL.id);
    await fs.ensureDir(modelDirectory);
    const localPath = path.join(modelDirectory, PARAKEET_MODEL.filename);
    await fs.writeFile(localPath, "encoder");
    await fs.writeFile(path.join(modelDirectory, "vocab.txt"), "vocab");

    await upsertModel({
      id: PARAKEET_MODEL.id,
      provider: "local-whisper",
      name: PARAKEET_MODEL.name,
      type: "speech",
      size: PARAKEET_MODEL.size,
      description: PARAKEET_MODEL.description,
      localPath,
      sizeBytes: 11,
      checksum: null,
      downloadedAt: new Date(),
      originalModel: {
        localFiles: [localPath, path.join(modelDirectory, "vocab.txt")],
      },
      speed: PARAKEET_MODEL.speed,
      accuracy: PARAKEET_MODEL.accuracy,
      context: null,
    });

    const modelService = new ModelService({} as never);

    expect(await modelService.isModelDownloaded(PARAKEET_MODEL.id)).toBe(false);
    expect(await modelService.getValidDownloadedModels()).toEqual({});
  });
});
