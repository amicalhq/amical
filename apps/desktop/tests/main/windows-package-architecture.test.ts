import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createPackage(arch: "x64" | "arm64") {
  const root = mkdtempSync(join(tmpdir(), "amical-windows-package-"));
  temporaryDirectories.push(root);
  const script = join(root, "scripts", "verify.ts");
  const packagePath = join(root, "out", `Amical-win32-${arch}`);
  mkdirSync(join(root, "scripts"));
  mkdirSync(packagePath, { recursive: true });
  copyFileSync(
    resolve(__dirname, "../../scripts/verify-windows-package-architecture.ts"),
    script,
  );

  const pe = Buffer.alloc(70);
  pe.write("MZ");
  pe.writeUInt32LE(64, 0x3c);
  pe.write("PE\u0000\u0000", 64);
  pe.writeUInt16LE(arch === "x64" ? 0x8664 : 0xaa64, 68);
  for (const name of [
    "Amical.exe",
    "node.exe",
    "WindowsHelper.exe",
    "whisper.node",
    "onnxruntime_binding.node",
    "DirectML.dll",
    "dxcompiler.dll",
    "dxil.dll",
    "onnxruntime.dll",
  ]) {
    writeFileSync(join(packagePath, name), pe);
  }
  const sqliteDirectory = join(
    packagePath,
    "resources",
    "app.asar.unpacked",
    "node_modules",
    "better-sqlite3",
    "prebuilds",
  );
  mkdirSync(sqliteDirectory, { recursive: true });
  const sqliteBinary = join(sqliteDirectory, `win32-${arch}.node`);
  writeFileSync(sqliteBinary, pe);
  return {
    sqliteBinary,
    pe,
    verify: () =>
      execFileSync(process.execPath, ["--import", "tsx", script, arch], {
        encoding: "utf8",
        stdio: "pipe",
      }),
  };
}

describe("Windows package architecture verification", () => {
  it.each(["x64", "arm64"] as const)(
    "accepts the SQLite 13 prebuild filename in a %s package",
    (arch) => {
      expect(createPackage(arch).verify()).toContain(`binaries as ${arch}`);
    },
  );

  it("rejects an x64 SQLite binding shipped in an arm64 package", () => {
    const fixture = createPackage("arm64");
    fixture.pe.writeUInt16LE(0x8664, 68);
    writeFileSync(fixture.sqliteBinary, fixture.pe);
    expect(fixture.verify).toThrow(/win32-arm64.node: expected arm64/);
  });
});
