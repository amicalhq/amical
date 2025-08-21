import { defineConfig } from "tsup";
import { readFileSync, writeFileSync } from "node:fs";

export default defineConfig({
	entry: ["src/index.ts", "src/build.ts"],
	outDir: "dist",
	dts: true,
	async onSuccess() {
		// replace `#include "ggml-common.h" in whisper.cpp/ggml/src/ggml-metal.metal with full content
		const metal = readFileSync("whisper.cpp/ggml/src/ggml-metal.metal", "utf-8");
		const common = readFileSync("whisper.cpp/ggml/src/ggml-common.h", "utf-8");
		const replaced = metal.replace(/#include "ggml-common.h"/, common);
		writeFileSync("whisper.cpp/ggml/src/ggml-metal.metal", replaced);
	},
});
