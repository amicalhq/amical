# Building the CUDA whisper binding on Windows

This guide documents the exact sequence that produces a working
`native/win32-x64-cuda/whisper.node` against CUDA 13.x + whisper.cpp as
pinned in this repo. It supersedes the older generic README inside
`packages/whisper-wrapper` whenever you are on Windows with CUDA 13.

## Prerequisites

| Tool | Why |
| --- | --- |
| Node 20+ | Runs the build orchestrator (`bin/build-addon.js`). |
| pnpm (workspace manager) | Installs deps for the monorepo. |
| Git with submodules | `whisper.cpp` is vendored as a submodule. |
| Visual Studio 2022 (Community, Professional, Enterprise, BuildTools **or Preview**) with the *Desktop development with C++* workload | Provides `cl.exe`, `lib.exe` and a bundled CMake. |
| NVIDIA CUDA Toolkit **12.x or 13.x** | `nvcc`, cuBLAS, cuBLASLt. |
| An NVIDIA driver that matches your CUDA major version. | `nvidia-smi` must succeed before you start. |

> **Heads up (VS Preview):** the old `bin/build-addon.js` only probed for
> Enterprise/Community/Professional/BuildTools. This branch adds
> Preview to the search, but if you are running an unusual install you
> should still invoke the build from a *Developer Command Prompt* so that
> `lib.exe` is on the `PATH` via `vcvarsall.bat`.

## Step-by-step

```cmd
:: 1. Open "x64 Native Tools Command Prompt for VS 2022"
::    (or run vcvarsall.bat x64 from cmd; PowerShell will NOT work).

:: 2. Point the environment at your CUDA install.
set "CUDA_PATH=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.2"
set "PATH=%CUDA_PATH%\bin\x64;%CUDA_PATH%\bin;%PATH%"

:: 3. From the repo root.
pnpm install --ignore-scripts
node packages\whisper-wrapper\scripts\apply-patches.js
pnpm --filter @amical/whisper-wrapper build

:: 4. Build the CUDA variant.
pushd packages\whisper-wrapper
pnpm run build:native:cuda
popd
```

If everything went well you end up with:

```text
packages/whisper-wrapper/native/win32-x64-cuda/whisper.node
packages/whisper-wrapper/native/win32-x64/whisper.node         (CPU fallback)
```

## Known gotchas fixed in this branch

### 1. CUDA 13 CCCL requires the conformant MSVC preprocessor

Without `/Zc:preprocessor`, the build dies on `mean.cu` with:

```text
cccl/std/__cccl/preprocessor.h(23): fatal error C1189: #error:
MSVC/cl.exe with traditional preprocessor is used.
```

The fix lives in `packages/whisper-wrapper/addon/CMakeLists.txt`:

```cmake
if (MSVC)
  add_compile_options(
    "$<$<COMPILE_LANGUAGE:C,CXX>:/Zc:preprocessor>"
    "$<$<COMPILE_LANGUAGE:CUDA>:-Xcompiler=/Zc:preprocessor>"
  )
endif()
```

### 2. `CMAKE_JS_INC` paths break on folders with spaces

The previous CMakeLists did
`string(REPLACE ";" " ")` → `separate_arguments` on `CMAKE_JS_INC`, which
shreds paths like `D:\Proyectos Personales\amical\...` at the first space and
leaves `napi.h` unfindable. The wrapper now iterates the semicolon-delimited
CMake list natively (`foreach(INC IN LISTS CMAKE_JS_INC)`).

### 3. CUDA 13 ships runtime DLLs under `bin\x64` (not `bin`)

The NVIDIA installer adds `bin` to your PATH, but the actual redistributable
libraries (`cublas64_13.dll`, `cublasLt64_13.dll`, `cudart64_13.dll`) sit in
`bin\x64`. The helper command prompt in the snippet above covers that by
prepending `bin\x64` to `PATH` before launching the build *and* Amical
itself.

### 4. Redistributing the binary

For a packaged Amical build the CUDA DLLs must be distributed next to
`whisper.node`, because Windows looks in the module's directory first.
Copy them before bundling:

```cmd
copy "%CUDA_PATH%\bin\x64\cublas64_13.dll"   packages\whisper-wrapper\native\win32-x64-cuda\
copy "%CUDA_PATH%\bin\x64\cublasLt64_13.dll" packages\whisper-wrapper\native\win32-x64-cuda\
```

`cudart` is statically linked (`-cudart static` in the nvcc command line) so
it does **not** need to be redistributed.

## Verifying the binding loaded

After launching Amical, grep the dev log at
`%APPDATA%\Amical\logs\amical-dev.log` for the `whisper_native_binding`
field. Valid values: `cuda`, `vulkan`, `metal`, `openblas`, `cpu-fallback`,
`cpu`. If you see `cpu` or `cpu-fallback` when you expected `cuda`, check
the warnings just above for `ERR_DLOPEN_FAILED` — the CUDA binary was
produced but Windows couldn't resolve one of its DLL dependencies.
