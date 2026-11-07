import { SyncKeySchema } from "@amical/api-contracts/apps/v1";
import { z } from "zod";

export {
  SyncKeySchema as cloudSyncKeySchema,
  SyncOptionalTextSchema as cloudSyncOptionalTextSchema,
  SyncRequiredTextSchema as cloudSyncRequiredTextSchema,
} from "@amical/api-contracts/apps/v1";

export const trimmedSyncKeySchema = z.string().trim().pipe(SyncKeySchema);
