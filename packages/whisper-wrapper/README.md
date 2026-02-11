# @amical/whisper-wrapper

This package wraps the `whisper.cpp` Node addon so the desktop app can call into
Whisper from a forked worker process. The build and runtime layers are tuned for
the desktop pipeline; the notes below capture the important knobs and the
reasoning behind them.

## Build workflow

- `pnpm install` (postinstall) runs `bin/build-addon.js` via CMake.js and drops
  the resulting `whisper.node` into `native/<platform-arch(-tag)>/`.
- `pnpm --filter @amical/whisper-wrapper build:native` rebuilds the default
  variants for this platform (Metal + CPU on macOS, CPU elsewhere).
- `pnpm --filter @amical/whisper-wrapper build:native:cuda` builds an extra
  `win32-x64-cuda` binary alongside the regular `win32-x64` fallback. Install
  the CUDA toolkit (12.x tested) before running it.
- Every macOS build is ad-hoc signed (`codesign -s -`) so Electron/Node can load
  it without crashing.
- Each variant is produced as a _single_ `.node` binary. We force static
  libraries (`GGML_STATIC=ON`, `BUILD_SHARED_LIBS=OFF`) so all ggml/whisper
  code is linked directly into the addon—no sidecar `.dylib/.dll` files ship
  at runtime.
- The full CMake build directory is deleted after each variant so Electron
  Forge/Squirrel never sees the long `CMakeFiles/...` paths that blew past
  Windows’ MAX_PATH limit during packaging.

## GPU/CPU fallback

`resolveBinding()` in `src/loader.ts` no longer throws if the first candidate
fails. `loadBinding()` walks the list:

1. `platform-arch-metal`
2. `platform-arch-openblas`
3. `platform-arch-cuda`
4. `platform-arch`
5. `cpu-fallback`

If `require()` raises `ERR_DLOPEN_FAILED` (missing runtime, wrong driver, etc.)
it logs a warning and tries the next candidate. That lets us ship CUDA/Metal
binaries alongside CPU ones without breaking installs that lack the GPU stack.

## GGML_NATIVE on macOS arm64

GitHub’s hosted macOS runners expose `i8mm` but clang refuses to emit the
`vmmlaq_s32` intrinsic when `-mcpu=native` is passed, so the build dies in
`ggml-cpu/arch/arm/quants.c`. CI therefore exports `GGML_NATIVE=OFF` before
calling the build scripts. Locally you can flip it back on if your toolchain
supports those instructions:

```bash
GGML_NATIVE=ON pnpm --filter @amical/whisper-wrapper build:native
```

Leave it off in CI unless you control the runner.

## Custom targets

`WHISPER_TARGETS` lets you override which variants to build. The value is a
comma-separated list of directory names that should map to `native/<name>`.
Examples:

```bash
WHISPER_TARGETS="linux-x64-gnu" pnpm --filter @amical/whisper-wrapper build:native
WHISPER_TARGETS="win32-x64-cuda,win32-x64" pnpm --filter @amical/whisper-wrapper build:native
```

Absent overrides the script builds the Metal variant (on macOS) followed by the
plain CPU build.

## Runtime API

`src/index.ts` exposes a minimal class that mirrors the desktop worker protocol:

- `new Whisper(modelPath, { gpu?: boolean })`
- `await whisper.load()` (no-op placeholder)
- `await whisper.transcribe(audioOrNull, options)`
- `await whisper.free()`

If you pass `null` (and a `fname_inp` in `options`) the addon reads the audio
file directly, matching the CLI smoke tests.

## Patches

Local patches in `patches/` are applied to the whisper.cpp submodule automatically
during `pnpm install` (via the `preinstall` script). The apply script is idempotent —
already-applied patches are skipped.

### fix-no-speech-prob-sot-position.patch

whisper.cpp (as of v1.8.2 and current master) computes `no_speech_prob` from the
wrong decoder position. It reads logits at the **last prompt token** (e.g.
`<|notimestamps|>`), where the model predicts the first word of text. The original
Python whisper reads from the **SOT position**, where the model decides whether
speech is present at all.

The result: `no_speech_prob` is always near zero regardless of audio content, making
whisper.cpp's built-in no-speech filtering (`no_speech_thold`, default 0.6) dead code.

The patch adds two lines:

1. Mark the SOT position for logit extraction (`batch.logits[sot_index] = 1`)
2. Read `no_speech_prob` from the SOT offset instead of the last position

With the fix, large-v3 (32 decoder layers) returns ~0.7 on silence. Large-v3-turbo
(4 decoder layers) still returns near-zero — this is a model limitation due to its
reduced decoder, not a code bug.

To add a new patch, drop a `.patch` file in `patches/` (they're applied in
alphabetical order). If a whisper.cpp version bump breaks a patch, the build will
fail, prompting you to check whether the fix was merged upstream.

## Local expectations

- `whisper.cpp` is tracked as a submodule under `packages/whisper-wrapper/`.
- `cmake-js` / `node` / `pnpm` must be installed (the workspace root sets the
  required versions).
- The build creates `.cmake-js/` and `.home/` caches inside the package; they’re
  ignored in git.

For any tweaks (new build targets, additional fallbacks, etc.) update this file
so the CI configuration stays discoverable.
