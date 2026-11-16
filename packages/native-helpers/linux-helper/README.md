# @amical/linux-helper

The native helper for the Amical desktop app on Linux. The desktop starts
`bin/linux-helper` with no arguments and talks NDJSON over stdin and stdout,
the same protocol as the macOS and Windows helpers. The schemas are in
`packages/types`.

This build has no key input, paste, clipboard, accessibility or sound backend
yet. It answers every method with a valid "not available" result, and
`getHelperCapabilities` reports that nothing is available.

## Build and test

The protocol models (`src/models/generated.rs`) are generated, so generate
them first:

```sh
pnpm --filter @amical/types generate:all
cargo test
pnpm build:native   # release build, staged at bin/linux-helper
```

The process tests start a private `dbus-daemon` (package `dbus`), and run the
helper with a temporary HOME and XDG directories.

`pnpm build:native` fails when the binary is larger than 6 MiB or needs a
glibc newer than 2.35. Build release binaries on Ubuntu 22.04 or in an
`ubuntu:22.04` container.

## What the helper touches

- stdin, stdout and stderr.
- The session bus, once, at the first capability request: it registers the
  request's `appId` (if any) with the portal host registry
  (`org.freedesktop.host.portal.Registry`), then reads the `version` property
  of the GlobalShortcuts, RemoteDesktop and Clipboard portal interfaces.

It writes no files.
