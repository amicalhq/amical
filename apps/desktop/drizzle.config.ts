import type { Config } from "drizzle-kit";
import * as path from "path";

const dbPath = path.join(process.cwd(), "vox.db");

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: `file:${dbPath}`,
  },
} satisfies Config;
