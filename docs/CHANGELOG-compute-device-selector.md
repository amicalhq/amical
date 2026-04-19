# Compute device selector — release notes

## Summary

Adds a new Settings → **Hardware** tab that lets users pick which CPU or GPU
runs local Whisper models. Three modes are supported:

- **Auto** — existing behaviour; loader picks the first usable native
  backend (Metal → OpenBLAS → CUDA → Vulkan → platform default → CPU
  fallback).
- **CPU only** — forces the CPU binary regardless of which GPU binaries are
  shipped.
- **A specific GPU** — enumerates GPUs reported by `systeminformation` and
  forwards the chosen index to `whisper_context_params.gpu_device`.

## User-visible changes

- New tRPC endpoints: `settings.getComputeSettings`,
  `settings.setComputeSettings`, `hardware.getSnapshot`.
- New route and sidebar entry `/settings/hardware` with matching `en` and
  `es` translations.
- Tooltips and warning when a user picks a GPU in a build that does not
  ship a GPU-accelerated binary.

## Backend changes

- `@amical/whisper-wrapper`
  - `WhisperOptions` now accepts `gpu`, `gpuDevice`, `flashAttn`, `threads`
    and `preferredBackend`.
  - `loadBinding({ preferredBackend })` caches per backend and honours
    `WHISPER_NATIVE_BACKEND` as an env-var override.
  - `addon.cpp` reads `gpu_device` and propagates it to
    `whisper_context_params.gpu_device`.
- `apps/desktop`
  - `services/hardware-detection-service.ts` enumerates GPUs via
    `systeminformation` with a one-shot cache.
  - `services/settings-service.ts` gains `getComputeSettings` /
    `setComputeSettings` + a `compute-changed` event.
  - `db/schema.ts` adds a `compute` section to `AppSettingsData`.
  - `TranscriptionService` passes `SettingsService` to `WhisperProvider`,
    which now reads compute settings, forwards them to the worker fork on
    every `initializeModel` call, and disposes its worker when settings
    change.

## Build-script fixes (shipped as part of this branch)

These are fixes to the existing build pipeline that would otherwise block
anyone trying to compile the CUDA binary on Windows / CUDA 13:

- `addon/CMakeLists.txt`: pass `/Zc:preprocessor` to both the C++ and CUDA
  compilers (required by CCCL in CUDA 13.x).
- `addon/CMakeLists.txt`: replace the `REPLACE ";" " "` +
  `separate_arguments` dance on `CMAKE_JS_INC` / `CMAKE_JS_LIB` with a
  native `foreach(IN LISTS ...)` so paths containing spaces work.
- `bin/build-addon.js`: detect VS 2022 *Preview* alongside the other
  editions when probing for `lib.exe`.

## Files touched

```
packages/whisper-wrapper/addon/addon.cpp
packages/whisper-wrapper/addon/CMakeLists.txt
packages/whisper-wrapper/bin/build-addon.js
packages/whisper-wrapper/src/index.ts
packages/whisper-wrapper/src/loader.ts

apps/desktop/src/db/schema.ts
apps/desktop/src/services/hardware-detection-service.ts          (new)
apps/desktop/src/services/settings-service.ts
apps/desktop/src/services/transcription-service.ts
apps/desktop/src/pipeline/providers/transcription/whisper-provider.ts
apps/desktop/src/pipeline/providers/transcription/whisper-worker-fork.ts
apps/desktop/src/trpc/router.ts
apps/desktop/src/trpc/routers/hardware.ts                         (new)
apps/desktop/src/trpc/routers/settings.ts
apps/desktop/src/renderer/main/lib/settings-navigation.ts
apps/desktop/src/renderer/main/routes/settings/route.tsx
apps/desktop/src/renderer/main/routes/settings/hardware.tsx       (new)
apps/desktop/src/renderer/main/pages/settings/hardware/index.tsx  (new)
apps/desktop/src/i18n/locales/{en,es}.json
docs/hardware-selection.md                                        (new)
docs/building-whisper-cuda-windows.md                             (new)
```

## Migration / compatibility

- Existing installs come up as `compute.device = "auto"` by default (the
  setting is `?` in the schema and defaulted in `getComputeSettings`),
  preserving today's behaviour.
- Older `whisper.node` binaries on disk silently ignore `gpu_device`, so
  pre-existing installs that haven't rebuilt the native module still load
  fine; they just cannot honour a multi-GPU device pick until the addon is
  recompiled from this branch.

## Testing performed

- `pnpm run type:check` passes in `apps/desktop` after the UI + tRPC
  additions.
- Manual smoke test on Windows 11 with an RTX 4080 Laptop + CUDA 13.2:
  rebuilt `whisper-wrapper` with the CMake fixes, copied the two cuBLAS
  DLLs next to `whisper.node`, set `CUDA_VISIBLE_DEVICES=0`, launched the
  app, dictated a sentence. Log confirmed `whisper_native_binding: cuda`,
  GPU utilisation peaked at 100 % while CPU stayed low, and the
  transcription returned valid text.

## Not yet covered

- `ja` and `zh-TW` translations still need the `settings.hardware.*`
  strings — left to native speakers.
- macOS (Metal) and Linux (Vulkan) paths have not been re-tested on this
  branch since neither machine was available; the code paths are
  structurally identical to Windows/CUDA and rely on the existing
  loader fallback.
