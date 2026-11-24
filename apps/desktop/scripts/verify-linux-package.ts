// Checks the deb built by `pnpm make` on Linux. Run on the build machine
// after `pnpm make`; needs dpkg-deb and objdump (binutils).
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LINUX_APP_ID } from "../src/utils/platform";

// Ubuntu 22.04. Every ELF file in the package must run there.
const MAX_GLIBC = [2, 35];
const APP_DIR = `usr/lib/${LINUX_APP_ID}`;

const failures: string[] = [];
const fail = (message: string) => failures.push(message);

function findDeb(): string {
  const dir = resolve(__dirname, "..", "out", "make", "deb", "x64");
  const debs = readdirSync(dir).filter((name) => name.endsWith(".deb"));
  if (debs.length !== 1) {
    throw new Error(`Expected one .deb in ${dir}, found ${debs.length}`);
  }
  return join(dir, debs[0]);
}

function walk(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function isElf(path: string): boolean {
  const header = readFileSync(path).subarray(0, 4);
  return header.toString("latin1") === "\x7fELF";
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

const deb = findDeb();
const root = mkdtempSync(join(tmpdir(), "amical-deb-"));
try {
  execFileSync("dpkg-deb", ["-x", deb, root]);
  const files = walk(root);
  const relative = (path: string) => path.slice(root.length + 1);

  // The bin is the launcher script that adds the X11 flag.
  const bin = join(root, `usr/bin/${LINUX_APP_ID}`);
  const launcher = execFileSync("readlink", ["-f", bin], { encoding: "utf8" })
    .trim()
    .slice(root.length + 1);
  if (launcher !== `${APP_DIR}/resources/amical-launcher`) {
    fail(`/usr/bin/${LINUX_APP_ID} points to ${launcher}, not the launcher`);
  }

  const desktopFile = readFileSync(
    join(root, `usr/share/applications/${LINUX_APP_ID}.desktop`),
    "utf8",
  );
  if (!desktopFile.includes("MimeType=x-scheme-handler/amical;")) {
    fail(`${LINUX_APP_ID}.desktop does not register the amical:// handler`);
  }

  const helper = join(root, APP_DIR, "resources/bin/linux-helper");
  if (!(statSync(helper).mode & 0o111)) fail("linux-helper is not executable");

  for (const path of files) {
    const name = relative(path);
    if (/libonnxruntime_providers_/.test(name)) {
      fail(`CUDA provider library in the package: ${name}`);
    }
    if (/onnxruntime-node\/bin\/napi-v\d+\/(darwin|win32)\//.test(name)) {
      fail(`foreign onnxruntime binary in the package: ${name}`);
    }
    if (!isElf(path)) continue;

    // `objdump -p` lists NEEDED libraries and the symbol versions required
    // from each (GLIBC_x.y). It exits non-zero for some files; the output is
    // still usable.
    const dynamic =
      spawnSync("objdump", ["-p", path], { encoding: "utf8" }).stdout ?? "";
    if (/NEEDED\s+libgomp/.test(dynamic)) fail(`${name} links libgomp`);
    for (const match of dynamic.matchAll(/GLIBC_(\d+(?:\.\d+)+)/g)) {
      const version = match[1].split(".").map(Number);
      if (compareVersions(version, MAX_GLIBC) > 0) {
        fail(`${name} needs GLIBC ${match[1]} (limit ${MAX_GLIBC.join(".")})`);
        break;
      }
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`Linux package check failed (${deb}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Linux package check passed: ${deb}`);
