import type { Config } from "drizzle-kit";
import { app } from "electron";
import * as path from "path";

const dbPath = app.isPackaged
  ? path.join(app.getPath("userData"), "amical.db")
  : path.join(process.cwd(), "amical.db");

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: `file:${dbPath}`,
  },
} satisfies Config;
