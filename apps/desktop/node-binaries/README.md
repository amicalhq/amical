# Node.js Binaries

This directory contains platform-specific Node.js binaries for running the Whisper worker process.

## Structure

```
node-binaries/
├── darwin-arm64/
│   └── node
├── darwin-x64/
│   └── node
├── win32-x64/
│   └── node.exe
└── linux-x64/
    └── node
```

## Download

Run the download script to populate this directory:

```bash
# Download for current platform only (recommended for development)
pnpm download-node

# Download for all platforms (for CI/CD or cross-platform builds)
pnpm download-node:all
```

## Purpose

These binaries are used to spawn a separate Node.js process for Whisper transcription, providing:

- Avoidance of Electron's V8 memory cage limitations (4GB max heap)
- Proper GPU/Metal framework initialization
- Ability to load large Whisper models (3GB+) without OOM errors
- Clean process isolation from Electron's runtime

## Version

Currently using Node.js v22.17.0 LTS binaries.
