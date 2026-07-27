import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

const PE_MACHINE = {
  x64: 0x8664,
  arm64: 0xaa64,
} as const;

const arch = process.argv[2];
if (arch !== "x64" && arch !== "arm64") {
  throw new Error("Usage: pnpm verify:windows-package <x64|arm64>");
}

const packageRoot = resolve(__dirname, "..", "out", `Amical-win32-${arch}`);
// VC runtime DLLs copied from System32 can be ARM64X binaries with an x64
// machine header, so forge.config.ts enforces their presence instead.
const requiredNames = new Set([
  "amical.exe",
  "node.exe",
  "windowshelper.exe",
  "better_sqlite3.node",
  "whisper.node",
  "onnxruntime_binding.node",
  "directml.dll",
  "dxcompiler.dll",
  "dxil.dll",
  "onnxruntime.dll",
]);

const files: string[] = [];

function collectFiles(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectFiles(entryPath);
    } else if (entry.isFile() && requiredNames.has(entry.name.toLowerCase())) {
      files.push(entryPath);
    }
  }
}

function readPeMachine(filePath: string): number {
  const file = openSync(filePath, "r");
  try {
    const dosHeader = Buffer.alloc(64);
    if (
      readSync(file, dosHeader, 0, dosHeader.length, 0) !== dosHeader.length
    ) {
      throw new Error("file is too small to contain a DOS header");
    }
    if (dosHeader.toString("ascii", 0, 2) !== "MZ") {
      throw new Error("missing MZ header");
    }

    const peOffset = dosHeader.readUInt32LE(0x3c);
    const peHeader = Buffer.alloc(6);
    if (
      readSync(file, peHeader, 0, peHeader.length, peOffset) !== peHeader.length
    ) {
      throw new Error("file is too small to contain a PE header");
    }
    if (peHeader.toString("ascii", 0, 4) !== "PE\u0000\u0000") {
      throw new Error("missing PE header");
    }

    return peHeader.readUInt16LE(4);
  } finally {
    closeSync(file);
  }
}

if (!existsSync(packageRoot) || !statSync(packageRoot).isDirectory()) {
  throw new Error(`Windows package not found: ${packageRoot}`);
}

collectFiles(packageRoot);

const filesByName = new Map<string, string[]>();
for (const file of files) {
  const name = basename(file).toLowerCase();
  filesByName.set(name, [...(filesByName.get(name) ?? []), file]);
}

const failures: string[] = [];
for (const requiredName of requiredNames) {
  const matches = filesByName.get(requiredName) ?? [];
  if (matches.length === 0) {
    failures.push(`missing ${requiredName}`);
    continue;
  }

  for (const file of matches) {
    try {
      const actualMachine = readPeMachine(file);
      if (actualMachine !== PE_MACHINE[arch]) {
        failures.push(
          `${file}: expected ${arch} (0x${PE_MACHINE[arch].toString(16)}), ` +
            `found PE machine 0x${actualMachine.toString(16)}`,
        );
      }
    } catch (error) {
      failures.push(`${file}: ${(error as Error).message}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(
    `Windows ${arch} package architecture verification failed:\n${failures
      .map((failure) => `- ${failure}`)
      .join("\n")}`,
  );
}

console.log(
  `Verified ${files.length} packaged Windows binaries as ${arch}: ${packageRoot}`,
);
