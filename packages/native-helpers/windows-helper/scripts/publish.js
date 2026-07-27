const { execFileSync } = require("node:child_process");

const arch = process.arch;
if (arch !== "x64" && arch !== "arm64") {
  throw new Error(`Unsupported Windows helper architecture: ${arch}`);
}

execFileSync(
  "dotnet",
  [
    "publish",
    "-c",
    "Release",
    "-r",
    `win-${arch}`,
    "--self-contained",
    "true",
    "-p:PublishSingleFile=true",
    "-o",
    "bin",
  ],
  { stdio: "inherit" },
);
