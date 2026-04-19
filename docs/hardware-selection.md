# Hardware selection for local models

Amical can run Whisper locally on your CPU or on a GPU. Settings → **Hardware**
now lets you choose exactly where the model runs.

## Available modes

| Mode | What it does | When to pick it |
| --- | --- | --- |
| **Auto (recommended)** | Amical tries GPU backends first (Metal / CUDA / Vulkan) and falls back to CPU if none load. | Default. Good choice if you have no preference. |
| **CPU only** | Skips every GPU binary and uses the plain CPU build. | Laptops on battery, machines with a weak / buggy GPU driver, or debugging a GPU regression. |
| **A specific GPU** | Forces that GPU as the CUDA / Vulkan / Metal device. | Multi-GPU machines where the default device is not the one you want (e.g. Amical picked the Intel iGPU instead of your dedicated NVIDIA card). |

Changes take effect on the next transcription; no app restart is needed.

## How device selection works under the hood

- The TypeScript wrapper in `@amical/whisper-wrapper` now forwards a
  `gpu_device` parameter to `whisper_context_params` in whisper.cpp
  (`int gpu_device` field — used by the CUDA backend to pick a device index,
  and by Vulkan for adapter selection).
- `WHISPER_NATIVE_BACKEND` (`auto` / `cpu` / `cuda` / `vulkan` / `metal` /
  `openblas`) can override backend picking via environment variable; the UI
  writes the same preference into settings via tRPC.
- The loader caches the chosen binding per backend, so switching from Auto
  to CPU and back does not keep the previous GPU binary loaded.

## Troubleshooting

**I selected a GPU but transcription still seems to hit the CPU.**
Check the startup log entry `whisper_native_binding`. Valid values are
`cuda`, `vulkan`, `metal`, `openblas`, `cpu-fallback` or `cpu`. If you see
`cpu` or `cpu-fallback` it means no GPU binary is shipped for your platform
in this build (see [building-whisper-cuda-windows.md](./building-whisper-cuda-windows.md)
for compiling one yourself).

**I have two NVIDIA cards and picked the second one, but whisper.cpp still
uses the first.**
Make sure you are running a build that includes the `gpu_device`
change — older binaries silently ignore the parameter. Rebuild
`@amical/whisper-wrapper` with this branch and clear `native/` before
restarting Amical.

**My iGPU shows up but my discrete GPU does not.**
`systeminformation` enumerates whatever the OS reports. On Windows laptops
in battery-saver mode some GPUs are temporarily hidden; plug the laptop in
and hit *Refresh*.
