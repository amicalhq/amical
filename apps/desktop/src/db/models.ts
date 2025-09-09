import { eq, and, or } from "drizzle-orm";
import { db } from ".";
import { models, type Model, type NewModel } from "./schema";

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
export async function getModelsByProvider(provider: string): Promise<Model[]> {
  return await db.select().from(models).where(eq(models.provider, provider));
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
  provider: string,
  type: string,
): Promise<Model[]> {
  return await db
    .select()
    .from(models)
    .where(and(eq(models.provider, provider), eq(models.type, type)));
}

/**
 * Get a specific model by provider and ID
 */
export async function getModelById(
  provider: string,
  id: string,
): Promise<Model | null> {
  const result = await db
    .select()
    .from(models)
    .where(and(eq(models.provider, provider), eq(models.id, id)));

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
      and(eq(models.provider, "local-whisper"), eq(models.type, "speech")),
    );
}

/**
 * Create or update a model
 */
export async function upsertModel(model: NewModel): Promise<void> {
  // Check if model exists
  const existing = await getModelById(model.provider, model.id);

  if (existing) {
    // Update existing model
    await db
      .update(models)
      .set({
        ...model,
        updatedAt: new Date(),
      })
      .where(and(eq(models.provider, model.provider), eq(models.id, model.id)));
  } else {
    // Insert new model
    await db.insert(models).values(model);
  }
}

/**
 * Sync models for a provider (replace all models)
 */
export async function syncModelsForProvider(
  provider: string,
  newModels: NewModel[],
): Promise<void> {
  await db.transaction(async (tx) => {
    // Delete existing models for this provider
    await tx.delete(models).where(eq(models.provider, provider));

    // Insert new models
    if (newModels.length > 0) {
      await tx.insert(models).values(newModels);
    }
  });
}

/**
 * Remove a model
 */
export async function removeModel(provider: string, id: string): Promise<void> {
  await db
    .delete(models)
    .where(and(eq(models.provider, provider), eq(models.id, id)));
}

/**
 * Remove all models for a provider
 */
export async function removeModelsForProvider(provider: string): Promise<void> {
  await db.delete(models).where(eq(models.provider, provider));
}

/**
 * Check if a model exists
 */
export async function modelExists(
  provider: string,
  id: string,
): Promise<boolean> {
  const result = await db
    .select({ id: models.id })
    .from(models)
    .where(and(eq(models.provider, provider), eq(models.id, id)));

  return result.length > 0;
}

/**
 * Get models by IDs (for batch operations)
 */
export async function getModelsByIds(
  modelIds: Array<{ provider: string; id: string }>,
): Promise<Model[]> {
  if (modelIds.length === 0) return [];

  // Build OR conditions for each provider-id pair
  const conditions = modelIds.map(({ provider, id }) =>
    and(eq(models.provider, provider), eq(models.id, id)),
  );

  return await db
    .select()
    .from(models)
    .where(or(...conditions));
}

/**
 * Sync Local Whisper models with filesystem
 * Scans the models directory and syncs database records with actual files
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

  // Scan the models directory for .bin files
  const modelFiles = new Set<string>();
  if (fs.existsSync(modelsDirectory)) {
    const files = fs.readdirSync(modelsDirectory);
    for (const file of files) {
      if (file.endsWith(".bin")) {
        modelFiles.add(file);
      }
    }
  }

  // Map available models by ID for easy lookup
  // (we already have them indexed by ID, so we don't need this map)

  // Process each available model
  for (const model of availableModels) {
    const filePath = path.join(modelsDirectory, model.filename);
    const fileExists = modelFiles.has(model.filename);
    const existingRecord = existingModelMap.get(model.id);

    if (fileExists) {
      // File exists on disk
      const stats = fs.statSync(filePath);

      if (existingRecord) {
        // Update existing record if needed
        if (
          existingRecord.localPath !== filePath ||
          existingRecord.sizeBytes !== stats.size
        ) {
          await upsertModel({
            ...existingRecord,
            localPath: filePath,
            sizeBytes: stats.size,
            downloadedAt: existingRecord.downloadedAt || new Date(),
          });
          updated++;
        }
      } else {
        // Add new record for found file
        await upsertModel({
          id: model.id,
          provider: "local-whisper",
          name: model.name,
          type: "speech",
          size: model.size,
          description: model.description,
          checksum: model.checksum,
          speed: model.speed,
          accuracy: model.accuracy,
          localPath: filePath,
          sizeBytes: stats.size,
          downloadedAt: new Date(),
          context: null,
          originalModel: null,
        });
        added++;
      }

      // Mark as processed
      existingModelMap.delete(model.id);
    } else if (existingRecord && existingRecord.localPath) {
      // File doesn't exist but we have a record with download info - remove it
      await removeModel(existingRecord.provider, existingRecord.id);
      removed++;

      // Mark as processed
      existingModelMap.delete(model.id);
    }
  }

  // Remove any remaining records that don't have corresponding available models
  // (these would be orphaned records)
  for (const [, model] of existingModelMap) {
    await removeModel(model.provider, model.id);
    removed++;
  }

  return { added, updated, removed };
}

// Re-export types for use in other modules
export { Model, NewModel } from "./schema";
