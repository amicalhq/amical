<!-- Markdown with HTML -->
<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://amical.ai/github-readme-header-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://amical.ai/github-readme-header-light.png">
  <img alt="Amical" src="https://amical.ai/github-readme-header-light.png">
</picture>
</div>

<p align="center">
  <a href='http://makeapullrequest.com'>
    <img alt='PRs Welcome' src='https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=shields'/>
  </a>
  <a href="https://opensource.org/license/MIT/">
    <img src="https://img.shields.io/github/license/amicalhq/amical?logo=opensourceinitiative&logoColor=white&label=License&color=8A2BE2" alt="license">
  </a>
  <br>
  <a href="https://amical.ai/community">
    <img src="https://img.shields.io/badge/discord-7289da.svg?style=flat-square&logo=discord" alt="discord" style="height: 20px;">
  </a>
</p>

<p align="center">
  <a href="https://amical.ai">Website</a> - <a href="https://amical.ai/docs">Docs</a> - <a href="https://amical.ai/community">Community</a> - <a href="https://github.com/amicalhq/amical/issues/new?assignees=&labels=bug&template=bug_report.md">Bug reports</a>
</p>

## Table of Contents

- [⬇️ Download](#️-download)
- [🔮 Overview](#-overview)
- [✨ Features](#-features)
- [🔰 Tech Stack](#-tech-stack)
- [Local Development](#local-development)
- [🤗 Contributing](#-contributing)
- [🎗 License](#-license)

## ⬇️ Download

<p>
  <a href="https://github.com/amicalhq/amical/releases/latest">
    <img src="https://amical.ai/download_button_macos.png" alt="Download for macOS" height="60">
  </a>
  <a href="https://github.com/amicalhq/amical/releases/latest">
    <img src="https://amical.ai/download_button_windows.png" alt="Download for Windows" height="60">
  </a>
  <a href="https://amical.ai/android">
    <img src="https://amical.ai/Store=Google%20Play,%20Type=Dark,%20Language=English.svg" alt="Get it on Google Play" height="60">
  </a>
  <a href="https://amical.ai/beta">
    <img src="https://amical.ai/ios_beta_button.svg" alt="Apply for iOS Beta" height="60">
  </a>
</p>

### Homebrew (macOS)

```bash
brew install --cask amical
```

## 🔮 Overview

Local-first AI Dictation app.

Amical is an open source AI-powered dictation and note-taking app that runs entirely on your machine.
Powered by [Whisper](https://github.com/openai/whisper) for speech-to-text and open source LLMs for intelligent processing, Amical gives you the power of AI dictation with complete privacy.

Context-aware dictation that adapts to what you're doing: drafting an email, chatting on Discord, writing prompts in your IDE, or messaging friends. Amical detects the active app and formats your speech accordingly.

<p align="center">
  <img src="https://amical.ai/demo/dictation-demo-component.gif" alt="Amical dictation demo" width="600">
</p>

## ✨ Features

> ✔︎ - Done, ◑ - In Progress, ◯ - Planned

🚀 Super-fast dictation with AI-enhanced accuracy ✔︎

🧠 Context-aware speech-to-text based on the active app ✔︎

📒 Smart voice notes → summaries, tasks, structured notes ◑

🔌 MCP integration → voice commands that control your apps ◯

🎙️ Real-time meeting transcription (mic + system audio) ◯

🔧 Extensible via hotkeys, voice macros, custom workflows ✔︎

🔐 Privacy-first: works offline, one click setup of local models in-app ✔︎

🪟 Floating widget for frictionless start/stop with custom hotkeys ✔︎

## 🔰 Tech Stack

- 🎤 [Whisper](https://github.com/openai/whisper)
- 🦙 [Ollama](https://ollama.ai)
- 🧑‍💻 [Typescript](https://www.typescriptlang.org/)
- 🖥️ [Electron](https://electronjs.org/)
- 🎨 [TailwindCSS](https://tailwindcss.com/)
- 🧑🏼‍🎨 [Shadcn](https://ui.shadcn.com/)
- 🔒 [Better-Auth](https://better-auth.com/)
- 🧘‍♂️ [Zod](https://zod.dev/)
- 🐞 [Vitest](https://vitest.dev/)
- 🌀 [Turborepo](https://turbo.build/)

## Local Development

These steps run the desktop app, which currently supports macOS and Windows.
Linux is not supported because the app does not yet have a Linux native helper.

### Prerequisites

- [Node.js](https://nodejs.org/) 24.x
- pnpm 10.15.0 (the version pinned in `package.json`)
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

Before opening a pull request, run:

```bash
pnpm type:check
pnpm test
```

## 🤗 Contributing

Contributions are welcome! Reach out to the team in our [Discord server](https://amical.ai/community) to learn more.

- **🐛 [Report an Issue][issues]**: Found a bug? Let us know!
- **💬 [Start a Discussion][discussions]**: Have ideas or suggestions? We'd love to hear from you.

## 🎗 License

Released under [MIT][license].

<!-- REFERENCE LINKS -->

[license]: https://github.com/amicalhq/amical/blob/main/LICENSE
[discussions]: https://amical.ai/community
[issues]: https://github.com/amicalhq/amical/issues
[pulls]: https://github.com/amicalhq/amical/pulls "submit a pull request"
