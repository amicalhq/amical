import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const desktopRoot = resolve(__dirname, "..");
const workspaceRoot = resolve(desktopRoot, "../..");

export function stageBetterSqlite3ForElectron(): void {
  const source = join(workspaceRoot, "node_modules", "better-sqlite3");
  const target = join(desktopRoot, "node_modules", "better-sqlite3");

  if (!existsSync(join(source, "package.json"))) {
    throw new Error(
      `Cannot stage better-sqlite3: package not found at ${source}`,
    );
  }

  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, {
    recursive: true,
    dereference: true,
    force: true,
  });

  console.log(`Staged better-sqlite3 for Electron at ${target}`);
}

if (require.main === module) {
  stageBetterSqlite3ForElectron();
}
