import { getTableColumns } from "drizzle-orm";
import { vocabulary } from "@/db/schema";

// The vocabulary columns that exist before migration 0018 added `source` and
// `observed_source`. Migration tests that read the table at an older chain
// point select these instead of the whole (current) schema.
const columns = getTableColumns(vocabulary);

export const legacyVocabularyColumns = Object.fromEntries(
  Object.entries(columns).filter(
    ([name]) => name !== "source" && name !== "observedSource",
  ),
) as Omit<typeof columns, "source" | "observedSource">;
