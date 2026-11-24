# @amical/linux-helper

The native helper for the Amical desktop app on Linux. The desktop starts
`bin/linux-helper` with no arguments and talks NDJSON over stdin and stdout,
the same protocol as the macOS and Windows helpers. The schemas are in
`packages/types`.

On an X11 session the helper streams keys, consumes shortcut chords, masks
Enter for Draft, answers `recheckPressedKeys`, and pastes and copies through
the X clipboard and XTest (`src/x11`).

On a GNOME or KDE Wayland session it binds the shortcuts through the
GlobalShortcuts portal and reports them by id (chord mode), and pastes with
the RemoteDesktop portal: the clipboard is Xwayland's on GNOME (GNOME bridges
it both ways) and data-control on KDE.

On every session it plays the recording sounds and mutes the output when
asked. It has no accessibility backend yet.

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

`pnpm build:native` fails when the binary is larger than 6 MiB. A binary that
needs a glibc newer than 2.35 fails in CI and gives a warning on a local build.
Build release binaries on Ubuntu 22.04 or in an `ubuntu:22.04` container.

## What the helper touches

- stdin, stdout and stderr.
- The session bus: at the first capability request it registers the
  request's `appId` (if any) with the portal host registry
  (`org.freedesktop.host.portal.Registry`), then reads the `version` property
  of the GlobalShortcuts, RemoteDesktop and Clipboard portal interfaces. On a
  Wayland session it then uses those portals on the same connection.
- On an X11 session, the X server (`DISPLAY`), with three connections:
  - XInput 2 raw key events on the root window, and passive key grabs for the
    configured shortcut keys and, while Draft review is open, for Enter;
  - the CLIPBOARD selection: a snapshot of every target before a paste, the
    transcript while the app pastes, then the snapshot again;
  - XTest key events for the paste and copy chords (Ctrl+V and Ctrl+Insert,
    or Ctrl+Shift+V and Ctrl+Shift+C in a terminal). xterm and urxvt have
    no key for the clipboard, so they get no chord: the paste answers that
    the clipboard is not set, and the desktop puts the text there.
- On a GNOME Wayland session, Xwayland's CLIPBOARD; on a KDE Wayland session,
  the compositor (`WAYLAND_DISPLAY`) for ext-data-control.
- The audio tools in PATH: `pw-play` or `paplay` for the sounds, `wpctl` or
  `pactl` for the output mute.

Files it writes:
- `$XDG_STATE_HOME/amical-desktop/helper/remote-desktop.token`: the portal's
  restore token, so that the paste consent is asked once.
- `$XDG_RUNTIME_DIR/amical-helper/`: the two recording sounds, and a marker
  while the helper has muted the output, so that a restarted helper still
  unmutes it.

If an X or Wayland connection closes, the helper exits with code 3, and the
desktop starts it again.
