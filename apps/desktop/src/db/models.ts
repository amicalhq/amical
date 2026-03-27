import { eq, and, or } from "drizzle-orm";
import { db } from ".";
import { models, type Model, type NewModel } from "./schema";
import type { ModelSelectionType } from "../utils/model-selection";

/**
 * Database operations for unified models table
 */

/**
 * Get all models
 */
export async function getAllModels(): Promise<Model[]> {
  return await db.select().from(models);
}

/**
 * Get models by provider
 */
export async function getModelsByProvider(
  providerType: string,
): Promise<Model[]> {
  return await db
    .select()
    .from(models)
    .where(eq(models.providerType, providerType));
}

/**
 * Get models by provider instance
 */
export async function getModelsByProviderInstance(
  providerInstanceId: string,
): Promise<Model[]> {
  return await db
    .select()
    .from(models)
    .where(eq(models.providerInstanceId, providerInstanceId));
}

/**
 * Get models by type
 */
export async function getModelsByType(type: string): Promise<Model[]> {
  return await db.select().from(models).where(eq(models.type, type));
}

/**
 * Get models by provider and type
 */
export async function getModelsByProviderAndType(
  providerType: string,
  type: string,
): Promise<Model[]> {
  return await db
    .select()
    .from(models)
    .where(and(eq(models.providerType, providerType), eq(models.type, type)));
}

/**
 * Get a specific model by provider instance, type, and ID
 */
export async function getModelById(
  providerInstanceId: string,
  type: ModelSelectionType,
  id: string,
): Promise<Model | null> {
  const result = await db
    .select()
    .from(models)
    .where(
      and(
        eq(models.providerInstanceId, providerInstanceId),
        eq(models.type, type),
        eq(models.id, id),
      ),
    );

  return result.length > 0 ? result[0] : null;
}

/**
 * Get downloaded Whisper models (where localPath is not null)
 */
export async function getDownloadedWhisperModels(): Promise<Model[]> {
  return await db
    .select()
    .from(models)
    .where(
      and(eq(models.providerType, "local-whisper"), eq(models.type, "speech")),
    );
}

/**
 * Create or update a model
 */
export async function upsertModel(model: NewModel): Promise<void> {
  // Check if model exists
  const existing = await getModelById(
    model.providerInstanceId,
    model.type as ModelSelectionType,
    model.id,
  );

  if (existing) {
    // Update existing model
    await db
      .update(models)
      .set({
        ...model,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(models.providerInstanceId, model.providerInstanceId),
          eq(models.type, model.type),
          eq(models.id, model.id),
        ),
      );
  } else {
    // Insert new model
    await db.insert(models).values(model);
  }
}

/**
 * Sync models for a provider instance (replace all models)
 */
export async function syncModelsForProviderInstance(
  providerInstanceId: string,
  newModels: NewModel[],
): Promise<void> {
  await db.transaction(async (tx) => {
    // Delete existing models for this provider instance
    await tx
      .delete(models)
      .where(eq(models.providerInstanceId, providerInstanceId));

    // Insert new models
    if (newModels.length > 0) {
      await tx.insert(models).values(newModels);
    }
  });
}

/**
 * Remove a model
 */
export async function removeModel(
  providerInstanceId: string,
  type: ModelSelectionType,
  id: string,
): Promise<void> {
  await db
    .delete(models)
    .where(
      and(
        eq(models.providerInstanceId, providerInstanceId),
        eq(models.type, type),
        eq(models.id, id),
      ),
    );
}

/**
 * Remove all models for a provider instance
 */
export async function removeModelsForProviderInstance(
  providerInstanceId: string,
): Promise<void> {
  await db
    .delete(models)
    .where(eq(models.providerInstanceId, providerInstanceId));
}

/**
 * Check if a model exists
 */
export async function modelExists(
  providerInstanceId: string,
  type: ModelSelectionType,
  id: string,
): Promise<boolean> {
  const result = await db
    .select({ id: models.id })
    .from(models)
    .where(
      and(
        eq(models.providerInstanceId, providerInstanceId),
        eq(models.type, type),
        eq(models.id, id),
      ),
    );

  return result.length > 0;
}

/**
 * Get models by IDs (for batch operations)
 */
export async function getModelsByIds(
  modelIds: Array<{
    providerInstanceId: string;
    type: ModelSelectionType;
    id: string;
  }>,
): Promise<Model[]> {
  if (modelIds.length === 0) return [];

  // Build OR conditions for each provider instance / type / id tuple
  const conditions = modelIds.map(({ providerInstanceId, type, id }) =>
    and(
      eq(models.providerInstanceId, providerInstanceId),
      eq(models.type, type),
      eq(models.id, id),
    ),
  );

  return await db
    .select()
    .from(models)
    .where(or(...conditions));
}

/**
 * Sync local speech models with filesystem
 * Scans expected model paths and syncs database records with actual files
 */
export async function syncLocalWhisperModels(
  modelsDirectory: string,
  availableModels: Array<{
    id: string;
    name: string;
    description: string;
    size: string;
    checksum?: string;
    speed: number;
    accuracy: number;
    filename: string;
    artifacts?: Array<{
      filename: string;
    }>;
  }>,
): Promise<{ added: number; updated: number; removed: number }> {
  const fs = await import("fs");
  const path = await import("path");

  let added = 0;
  let updated = 0;
  let removed = 0;

  // Get all existing whisper models from DB
  const existingModels = await getModelsByProvider("local-whisper");
  const existingModelMap = new Map(existingModels.map((m) => [m.id, m]));

  // Map available models by ID for easy lookup
  // (we already have them indexed by ID, so we don't need this map)

  const resolveRequiredLocalFiles = (
    model: (typeof availableModels)[number],
  ) => {
    const requiredFilenames =
      model.artifacts && model.artifacts.length > 0
        ? model.artifacts.map((artifact) => artifact.filename)
        : [model.filename];

    const resolvedFiles = requiredFilenames
      .map((filename) => {
        const candidatePaths = [
          path.join(modelsDirectory, filename),
          path.join(modelsDirectory, model.id, filename),
        ];

        return candidatePaths.find((candidatePath) =>
          fs.existsSync(candidatePath),
        );
      })
      .filter((filePath): filePath is string => !!filePath);

    return resolvedFiles.length === requiredFilenames.length
      ? resolvedFiles
      : null;
  };

  // Process each available model
  for (const model of availableModels) {
    const resolvedFiles = resolveRequiredLocalFiles(model);
    const filePath =
      resolvedFiles?.find(
        (resolvedFilePath) =>
          path.basename(resolvedFilePath) === model.filename,
      ) || path.join(modelsDirectory, model.id, model.filename);
    const fileExists = !!resolvedFiles;
    const existingRecord = existingModelMap.get(model.id);

    if (fileExists) {
      const sizeBytes = resolvedFiles.reduce(
        (sum, resolvedFilePath) => sum + fs.statSync(resolvedFilePath).size,
        0,
      );
      const existingLocalFiles =
        existingRecord?.originalModel &&
        typeof existingRecord.originalModel === "object" &&
        !Array.isArray(existingRecord.originalModel) &&
        Array.isArray(
          (
            existingRecord.originalModel as {
              localFiles?: unknown;
            }
          ).localFiles,
        )
          ? (
              existingRecord.originalModel as {
                localFiles: unknown[];
              }
            ).localFiles.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
      const localFilesChanged =
        existingLocalFiles.length !== resolvedFiles.length ||
        existingLocalFiles.some(
          (existingLocalFile, index) =>
            existingLocalFile !== resolvedFiles[index],
        );
      const originalModel =
        existingRecord?.originalModel &&
        typeof existingRecord.originalModel === "object" &&
        !Array.isArray(existingRecord.originalModel)
          ? {
              ...existingRecord.originalModel,
              localFiles: resolvedFiles,
            }
          : { localFiles: resolvedFiles };

      if (existingRecord) {
        // Update existing record if needed
        if (
          existingRecord.localPath !== filePath ||
          existingRecord.sizeBytes !== sizeBytes ||
          localFilesChanged
        ) {
          await upsertModel({
            ...existingRecord,
            localPath: filePath,
            sizeBytes,
            downloadedAt: existingRecord.downloadedAt || new Date(),
            originalModel,
          });
          updated++;
        }
      } else {
        // Add new record for found file
        await upsertModel({
          id: model.id,
          providerType: "local-whisper",
          providerInstanceId: "system-local-whisper",
          provider: "local-whisper",
          name: model.name,
          type: "speech",
          size: model.size,
          description: model.description,
          checksum: model.checksum,
          speed: model.speed,
          accuracy: model.accuracy,
          localPath: filePath,
          sizeBytes,
          downloadedAt: new Date(),
          context: null,
          originalModel,
        });
        added++;
      }

      // Mark as processed
      existingModelMap.delete(model.id);
    } else if (existingRecord && existingRecord.localPath) {
      // File doesn't exist but we have a record with download info - remove it
      await removeModel(
        existingRecord.providerInstanceId,
        "speech",
        existingRecord.id,
      );
      removed++;

      // Mark as processed
      existingModelMap.delete(model.id);
    }
  }

  // Remove any remaining records that don't have corresponding available models
  // (these would be orphaned records)
  for (const [, model] of existingModelMap) {
    await removeModel(model.providerInstanceId, "speech", model.id);
    removed++;
  }

  return { added, updated, removed };
}

// Re-export types for use in other modules
export { Model, NewModel } from "./schema";
