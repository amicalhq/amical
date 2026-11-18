<!-- Markdown with HTML -->
<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://amical.ai/github-readme-header-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://amical.ai/github-readme-header-light.png">
  <img alt="Amical: free, open source voice typing and dictation app for macOS and Windows" src="https://amical.ai/github-readme-header-light.png">
</picture>
</div>

<p align="center">
  <a href="https://github.com/amicalhq/amical/releases/latest">
    <img src="https://img.shields.io/github/v/release/amicalhq/amical?label=Release" alt="latest release">
  </a>
  <a href="https://github.com/amicalhq/amical/releases">
    <img src="https://img.shields.io/github/downloads/amicalhq/amical/total?label=Downloads" alt="downloads">
  </a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey" alt="platform: macOS | Windows">
  <a href="https://opensource.org/license/MIT/">
    <img src="https://img.shields.io/github/license/amicalhq/amical?logo=opensourceinitiative&logoColor=white&label=License&color=8A2BE2" alt="license">
  </a>
  <a href="https://amical.ai/community">
    <img src="https://img.shields.io/badge/discord-7289da.svg?logo=discord&logoColor=white" alt="discord">
  </a>
</p>

<h3 align="center">Talk instead of type.</h3>

<p align="center">
  Free, open source voice typing for macOS and Windows.<br>
  Hold a key, speak, and your words appear at your cursor, in any app.
</p>

<p align="center">
  <b>Runs on your computer</b> · <b>Works offline</b> · <b>No account</b> · <b>Up to 99 languages</b>
</p>

<p align="center">
  <a href="https://amical.ai">Website</a> · <a href="https://amical.ai/docs">Docs</a> · <a href="https://amical.ai/community">Discord</a>
</p>

## ⬇️ Download

<p>
  <a href="https://github.com/amicalhq/amical/releases/latest/download/Amical-macos-arm64.dmg">
    <img src="https://amical.ai/download_button_macos.png" alt="Download Amical for macOS" height="60">
  </a>
  <a href="https://github.com/amicalhq/amical/releases/latest/download/Amical-windows-x64.exe">
    <img src="https://amical.ai/download_button_windows.png" alt="Download Amical for Windows" height="60">
  </a>
</p>

Intel Mac: [.dmg](https://github.com/amicalhq/amical/releases/latest/download/Amical-macos-x64.dmg) ·
Windows on ARM: [.exe](https://github.com/amicalhq/amical/releases/latest/download/Amical-windows-arm64.exe) ·
[All releases](https://github.com/amicalhq/amical/releases)

Local speech models need macOS 15 or later.

**Homebrew (macOS):**

```bash
brew install --cask amical
```

📱 Also on [iOS](https://amical.ai/ios) and [Android](https://amical.ai/android).

<p align="center">
  <img src="https://amical.ai/demo/dictation-demo-component.gif" alt="Amical dictation demo" width="600">
</p>

## ✨ Features

🎙️ **Dictate into any app.** Hold a key to talk (push-to-talk), press once for hands-free, or click the floating widget.

🧠 **Fit the app you are in.** Connect your own language model, and Amical formats for the active app: paragraphs and a sign-off in email, short replies in chat, lists in notes.

📖 **Teach it your words.** Add names, terms, and spellings to your vocabulary, and set replacements.

⚡ **Snippets.** Say a short trigger to insert longer text, such as a meeting link or an address.

📒 **Notes.** Dictate into a built-in notes window with Markdown formatting.

🕘 **History.** Replay, copy, or retry any transcription. One shortcut pastes your last transcript.

🎚️ **Microphone priority.** Set the order of microphones that Amical uses.

🌐 **Six interface languages.** English, German, Spanish, Japanese, Korean, and Traditional Chinese.

> ⭐ **Like Amical? [Star the repo](https://github.com/amicalhq/amical).** It helps other people find it.

## 🆓 Local Speech Models: Whisper and Parakeet

Amical downloads a speech model once, then transcribes on your computer, also
when you are offline. Choose a model during setup, and change it at any time in
**Settings → AI Models**.

Not sure which one? Start with **Parakeet v3** for European languages, or
**Whisper Large v3 Turbo** for all other languages.

| Model                  | Best for                                 | Languages                                     | Download |
| ---------------------- | ---------------------------------------- | --------------------------------------------- | -------- |
| Parakeet v3            | Very fast and accurate, with punctuation | 25 European languages, detected automatically | ~640 MB  |
| Whisper Large v3 Turbo | Fast, with high accuracy                 | 99 languages                                  | ~1.5 GB  |
| Whisper Large v3       | Highest accuracy, difficult audio        | 99 languages                                  | ~3.1 GB  |
| Whisper Small          | High accuracy at moderate speed          | 99 languages                                  | ~488 MB  |

<details>
<summary>More Whisper models: Medium, Base, Tiny</summary>

| Model          | Best for                    | Languages    | Download |
| -------------- | --------------------------- | ------------ | -------- |
| Whisper Medium | Very high accuracy          | 99 languages | ~1.5 GB  |
| Whisper Base   | Balanced speed and accuracy | 99 languages | ~148 MB  |
| Whisper Tiny   | Fastest and smallest        | 99 languages | ~78 MB   |

</details>

Amical runs these models with [whisper.cpp](https://github.com/ggml-org/whisper.cpp),
with GPU acceleration through Metal on macOS and Vulkan on Windows. Speed and
accuracy depend on your hardware.

**Add AI formatting with your own model.** Connect [Ollama](https://ollama.com)
or an OpenAI-compatible server, such as [LM Studio](https://lmstudio.ai), in
**Settings → AI Models**. Then turn on formatting in **Settings → Dictation**.
You can also use a hosted provider, such as OpenRouter, with your own API key.

## 🔰 Tech Stack

- 🎤 [whisper.cpp](https://github.com/ggml-org/whisper.cpp): local Whisper and Parakeet inference
- 🖥️ [Electron](https://electronjs.org/) and [TypeScript](https://www.typescriptlang.org/)
- ⚛️ [React](https://react.dev/), [TailwindCSS](https://tailwindcss.com/), and [shadcn/ui](https://ui.shadcn.com/)
- 🧩 [Effect](https://effect.website/), [tRPC](https://trpc.io/), and [Zod](https://zod.dev/)
- 🗄️ [Drizzle ORM](https://orm.drizzle.team/) with SQLite
- 🍎 Swift native helper for macOS, 🪟 C# (.NET) native helper for Windows
- 🐞 [Vitest](https://vitest.dev/) and 🌀 [Turborepo](https://turbo.build/)

## Local Development

These steps run the desktop app, which currently supports macOS and Windows.
Linux is not supported because the app does not yet have a Linux native helper.

### Prerequisites

- [Node.js](https://nodejs.org/) 24.x
- pnpm 11 (the exact version is pinned in `package.json`)
- CMake 3.20 or later
- **macOS:** Xcode or the Xcode Command Line Tools with Swift 5.9 or later
  (`xcode-select --install`). Local Whisper transcription requires macOS 15 or
  later.
- **Windows:** Visual Studio 2022 Build Tools with the **Desktop development with
  C++** workload, plus the .NET 8 SDK. Git Bash is recommended because some
  development scripts use POSIX utilities.

### Set up the repository

Clone with submodules so the Whisper sources are available:

```bash
git clone --recurse-submodules https://github.com/amicalhq/amical.git
cd amical
```

If you already cloned without `--recurse-submodules`, initialize them now:

```bash
git submodule update --init --recursive
```

Enable Corepack so it uses the pinned pnpm version, install dependencies, and
download the Node.js binary used by the local Whisper worker:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @amical/desktop download-node
```

`pnpm install` compiles the native Whisper addon, so it can take a few minutes.
It also applies the repository's patches inside the `whisper.cpp` submodule.
Seeing that submodule marked as modified in `git status` afterward is expected.

### Start the desktop app

Quit any installed copy of Amical first; Electron allows only one Amical
instance at a time. Then run:

```bash
pnpm turbo run dev --filter=@amical/desktop
```

When finished, quit the development app from its tray menu and then press
<kbd>Ctrl</kbd>+<kbd>C</kbd>. Stopping the terminal command alone may leave the
Electron app running.

No `.env` file is required for local transcription. The first-run onboarding
downloads a local model and requests the required microphone and OS
permissions. Only configure `apps/desktop/.env` from
`apps/desktop/.env.example` when working on optional cloud, authentication, or
telemetry integrations, and replace its placeholder values before use.

### Run checks

Workspace builds and typechecks use TypeScript 7.0.2. The `@typescript/native`
dependency is an alias for the native compiler and provides `tsc`. The
`typescript` dependency is an alias for Microsoft's TypeScript 6 compatibility
package, which provides the compiler API used by ESLint and other tools. This
follows [Microsoft's side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0).
Run `pnpm exec tsc --version` to check the build compiler version.

For VS Code, install the recommended [TypeScript 7 extension](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview).
The workspace settings point it at the same native compiler.

Before opening a pull request, run:

```bash
pnpm type:check
pnpm test
```

## 🤗 Contributing

Contributions are welcome! Reach out to the team in our [Discord server](https://amical.ai/community) to learn more.

- **🐛 [Report an Issue][issues]**: Found a bug? Let us know!
- **💬 [Chat on Discord][discussions]**: Have ideas or suggestions? We'd love to hear from you.
- **⭐ [Star Amical on GitHub][repo]**: A star helps other people find Amical.

## 🙏 Acknowledgments

- [OpenAI Whisper](https://github.com/openai/whisper): multilingual speech recognition models
- [NVIDIA Parakeet](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3): fast speech recognition model
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp): local inference for Whisper and Parakeet
- [Silero VAD](https://github.com/snakers4/silero-vad): voice activity detection
- [Ollama](https://ollama.com): local language models for formatting

## 🎗 License

Released under [MIT][license].

<!-- REFERENCE LINKS -->

[repo]: https://github.com/amicalhq/amical
[license]: https://github.com/amicalhq/amical/blob/main/LICENSE
[discussions]: https://amical.ai/community
[issues]: https://github.com/amicalhq/amical/issues
[pulls]: https://github.com/amicalhq/amical/pulls "submit a pull request"
