import { eq, desc } from 'drizzle-orm';
import * as fs from 'fs';
import { db } from './config';
import { downloadedModels, type DownloadedModel, type NewDownloadedModel } from './schema';

// Create a new downloaded model record
export async function createDownloadedModel(data: Omit<NewDownloadedModel, 'createdAt' | 'updatedAt'>) {
  const now = new Date();
  
  const newModel: NewDownloadedModel = {
    ...data,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.insert(downloadedModels).values(newModel).returning();
  return result[0];
}

// Get all downloaded models
export async function getDownloadedModels() {
  return await db
    .select()
    .from(downloadedModels)
    .orderBy(desc(downloadedModels.downloadedAt));
}

// Get downloaded model by ID
export async function getDownloadedModelById(id: string) {
  const result = await db
    .select()
    .from(downloadedModels)
    .where(eq(downloadedModels.id, id));
  return result[0] || null;
}

// Check if model is downloaded
export async function isModelDownloaded(modelId: string) {
  const model = await getDownloadedModelById(modelId);
  return !!model;
}

// Update downloaded model
export async function updateDownloadedModel(id: string, data: Partial<Omit<DownloadedModel, 'id' | 'createdAt'>>) {
  const updateData = {
    ...data,
    updatedAt: new Date(),
  };

  const result = await db
    .update(downloadedModels)
    .set(updateData)
    .where(eq(downloadedModels.id, id))
    .returning();
  
  return result[0] || null;
}

// Delete downloaded model
export async function deleteDownloadedModel(id: string) {
  const result = await db
    .delete(downloadedModels)
    .where(eq(downloadedModels.id, id))
    .returning();
  
  return result[0] || null;
}

// Get downloaded models as a record (for backward compatibility)
export async function getDownloadedModelsRecord(): Promise<Record<string, DownloadedModel>> {
  const models = await getDownloadedModels();
  const record: Record<string, DownloadedModel> = {};
  
  for (const model of models) {
    record[model.id] = model;
  }
  
  return record;
}

// Validate that all downloaded models still exist on disk
export async function validateDownloadedModels(): Promise<{
  valid: DownloadedModel[];
  missing: DownloadedModel[];
  cleaned: number;
}> {
  const models = await getDownloadedModels();
  const valid: DownloadedModel[] = [];
  const missing: DownloadedModel[] = [];
  
  for (const model of models) {
    if (fs.existsSync(model.localPath)) {
      valid.push(model);
    } else {
      missing.push(model);
    }
  }
  
  // Clean up database records for missing files
  let cleaned = 0;
  for (const missingModel of missing) {
    await deleteDownloadedModel(missingModel.id);
    cleaned++;
  }
  
  return {
    valid,
    missing,
    cleaned
  };
}

// Check if a specific model file exists on disk
export async function validateModelFile(modelId: string): Promise<boolean> {
  const model = await getDownloadedModelById(modelId);
  if (!model) return false;
  
  return fs.existsSync(model.localPath);
}

// Get only models that exist on disk (with real-time validation)
export async function getValidDownloadedModels(): Promise<DownloadedModel[]> {
  const models = await getDownloadedModels();
  const validModels: DownloadedModel[] = [];
  
  for (const model of models) {
    if (fs.existsSync(model.localPath)) {
      validModels.push(model);
    }
  }
  
  return validModels;
}