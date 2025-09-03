import { eq, and } from "drizzle-orm";
import { db } from ".";
import {
  providerModels,
  type ProviderModelDB,
  type NewProviderModelDB,
} from "./schema";
import type {
  OllamaModel,
  OpenRouterModel,
  ProviderModel,
} from "../types/providers";

/**
 * Database operations for provider models
 */

// Convert ProviderModel to database format
function toDBModel(model: ProviderModel): NewProviderModelDB {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    size: model.size || null,
    context: model.context,
    description: model.description || null,
    originalModel: model.originalModel
      ? JSON.stringify(model.originalModel)
      : null,
  };
}

// Convert database model to ProviderModel format
function fromDBModel(dbModel: ProviderModelDB): ProviderModel {
  return {
    id: dbModel.id,
    name: dbModel.name,
    provider: dbModel.provider,
    size: dbModel.size || undefined,
    context: dbModel.context,
    description: dbModel.description || undefined,
    originalModel: dbModel.originalModel as
      | OpenRouterModel
      | OllamaModel
      | undefined,
  };
}

/**
 * Get all synced provider models
 */
export async function getAllProviderModels(): Promise<ProviderModel[]> {
  const models = await db.select().from(providerModels);
  return models.map(fromDBModel);
}

/**
 * Get provider models by provider
 */
export async function getProviderModelsByProvider(
  provider: string
): Promise<ProviderModel[]> {
  const models = await db
    .select()
    .from(providerModels)
    .where(eq(providerModels.provider, provider));
  return models.map(fromDBModel);
}

/**
 * Get a specific provider model by provider and ID
 */
export async function getProviderModelById(
  provider: string,
  id: string
): Promise<ProviderModel | null> {
  const result = await db
    .select()
    .from(providerModels)
    .where(
      and(eq(providerModels.provider, provider), eq(providerModels.id, id))
    );

  return result.length > 0 ? fromDBModel(result[0]) : null;
}

/**
 * Sync provider models (replace all models for a provider)
 */
export async function syncProviderModels(
  provider: string,
  models: ProviderModel[]
): Promise<void> {
  await db.transaction(async (tx) => {
    // Delete existing models for this provider
    await tx
      .delete(providerModels)
      .where(eq(providerModels.provider, provider));

    // Insert new models
    if (models.length > 0) {
      const dbModels = models.map(toDBModel);
      await tx.insert(providerModels).values(dbModels);
    }
  });
}

/**
 * Add or update a single provider model
 */
export async function upsertProviderModel(model: ProviderModel): Promise<void> {
  const dbModel = toDBModel(model);

  // Check if model exists
  const existing = await getProviderModelById(model.provider, model.id);

  if (existing) {
    // Update existing model
    await db
      .update(providerModels)
      .set({
        ...dbModel,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(providerModels.provider, model.provider),
          eq(providerModels.id, model.id)
        )
      );
  } else {
    // Insert new model
    await db.insert(providerModels).values(dbModel);
  }
}

/**
 * Remove a provider model
 */
export async function removeProviderModel(
  provider: string,
  id: string
): Promise<void> {
  await db
    .delete(providerModels)
    .where(
      and(eq(providerModels.provider, provider), eq(providerModels.id, id))
    );
}

/**
 * Remove all models for a provider
 */
export async function removeProviderModels(provider: string): Promise<void> {
  await db.delete(providerModels).where(eq(providerModels.provider, provider));
}

/**
 * Check if a model exists
 */
export async function modelExists(
  provider: string,
  id: string
): Promise<boolean> {
  const result = await db
    .select({ id: providerModels.id })
    .from(providerModels)
    .where(
      and(eq(providerModels.provider, provider), eq(providerModels.id, id))
    );

  return result.length > 0;
}
