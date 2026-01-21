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
- ☘️ [Next.js](https://nextjs.org/)
- 🎨 [TailwindCSS](https://tailwindcss.com/)
- 🧑🏼‍🎨 [Shadcn](https://ui.shadcn.com/)
- 🔒 [Better-Auth](https://better-auth.com/)
- 🧘‍♂️ [Zod](https://zod.dev/)
- 🐞 [Jest](https://jestjs.io/)
- 📚 [Fumadocs](https://github.com/fuma-nama/fumadocs)
- 🌀 [Turborepo](https://turbo.build/)

## 🤗 Contributing

Contributions are welcome! Please read the [Contributing Guide][contributing] to get started.

- **💡 [Contributing Guide][contributing]**: Learn about our contribution process and coding standards.
- **🐛 [Report an Issue][issues]**: Found a bug? Let us know!
- **💬 [Start a Discussion][discussions]**: Have ideas or suggestions? We'd love to hear from you.

## 🎗 License

Released under [MIT][license].

<!-- REFERENCE LINKS -->

[contributing]: https://github.com/amicalhq/amical/blob/main/CONTRIBUTING.md
[license]: https://github.com/amicalhq/amical/blob/main/LICENSE
[discussions]: https://discuss.amical.ai
[issues]: https://github.com/amicalhq/amical/issues
[pulls]: https://github.com/amicalhq/amical/pulls "submit a pull request"
