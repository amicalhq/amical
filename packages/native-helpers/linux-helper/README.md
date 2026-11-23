# @amical/linux-helper

The native helper for the Amical desktop app on Linux. The desktop starts
`bin/linux-helper` with no arguments and talks NDJSON over stdin and stdout,
the same protocol as the macOS and Windows helpers. The schemas are in
`packages/types`.

On an X11 session the helper streams keys, consumes shortcut chords, masks
Enter for Draft, answers `recheckPressedKeys`, and pastes and copies through
the X clipboard and XTest (`src/x11`). It has no accessibility or sound
backend yet. On other sessions it answers every method with a valid "not
available" result, and `getHelperCapabilities` reports that nothing is
available.

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

The X11 tests need an X server with XTEST (packages `xvfb`, `xauth`):

```sh
xvfb-run -a cargo test --features it-x11 --test x11
```

`pnpm build:native` fails when the binary is larger than 6 MiB or needs a
glibc newer than 2.35. Build release binaries on Ubuntu 22.04 or in an
`ubuntu:22.04` container.

## What the helper touches

- stdin, stdout and stderr.
- The session bus, once, at the first capability request: it registers the
  request's `appId` (if any) with the portal host registry
  (`org.freedesktop.host.portal.Registry`), then reads the `version` property
  of the GlobalShortcuts, RemoteDesktop and Clipboard portal interfaces.
- On an X11 session only, the X server (`DISPLAY`), with three connections:
  - XInput 2 raw key events on the root window, and passive key grabs for the
    configured shortcut keys and, while Draft review is open, for Enter;
  - the CLIPBOARD selection: a snapshot of every target before a paste, the
    transcript while the app pastes, then the snapshot again;
  - XTest key events for the paste and copy chords (Ctrl+V and Ctrl+Insert,
    or Ctrl+Shift+V and Ctrl+Shift+C in a terminal). xterm and urxvt have
    no key for the clipboard, so they get no chord: the paste answers that
    the clipboard is not set, and the desktop puts the text there.

It writes no files. If an X connection closes on an X11 session, the helper
exits with code 3, and the desktop starts it again.
