# E2E smoke tests

Playwright drives the real Electron app (main process + renderer) via its
Electron support. Unit tests live in `tests/`; these specs boot the actual app.

## Targets

- `packaged` (default) — launches `out/Amical-<platform>-<arch>`. Truest to
  what ships; catches packaged-only startup regressions. Requires a package
  built with `AMICAL_E2E_PACKAGE=1` (flips the `EnableNodeCliInspectArguments`
  fuse so Playwright can attach — release builds keep it off).
- `bundle` — launches the local `electron` binary against the production
  bundles in `.vite/`. Fast iteration loop; runs the same code paths as
  `pnpm start` (`app.isPackaged` is false). Note `forge start` overwrites
  `.vite/` with dev bundles — re-package to restore production bundles (the
  harness detects this and tells you).

## Running

```bash
pnpm test:e2e:fresh    # package (with e2e fuse) + run against it — slow, complete
pnpm test:e2e          # run against the existing out/ package
pnpm test:e2e:bundle   # run against .vite/ bundles via the electron binary
```

Each launch gets a throwaway userData dir (`AMICAL_E2E_USER_DATA_DIR`), so
tests always see a fresh profile (onboarding) and never collide with a real
running Amical. `AMICAL_E2E=1` skips the auto-updater; telemetry is disabled
via `TELEMETRY_ENABLED=false`.

## Squirrel specs (`squirrel.spec.ts`)

Windows + `packaged` target only (skipped elsewhere). Guard the update-hook
regression: probes spawn the packaged exe with `--squirrel-*` args against the
running instance's profile — the way `Update.exe` does during a background
update — and assert the app is undisturbed (no `second-instance` event for
hook args, no window changes, no "Second instance attempted" log line for a
lock-contending `--squirrel-firstrun` probe). No `Update.exe` exists next to
the `out/` exe, so the hook probe's shortcut spawn fails internally; that's
fine — the subject is the running instance, not shortcut creation. Run on the
win box; note `test:e2e:fresh`'s env-prefix syntax needs a POSIX shell
(git-bash) there.

## OS side effects

The app's startup deliberately runs un-gated in tests (so the real code paths
are exercised): `syncAutoLaunch()` registers the test binary as a login item,
and `setAsDefaultProtocolClient` registers the `amical://` handler. The
Playwright globalSetup/globalTeardown pair (`helpers/os-state.ts`) snapshots
login items before the suite and best-effort removes entries the run added —
failures warn but never fail the suite.

- The `amical://` handler is not restored: the real installed Amical
  re-registers itself on its next launch (macOS self-heals; harmless locally).
- Windows is not implemented yet. The equivalent pollution lives in HKCU
  (`Software\Microsoft\Windows\CurrentVersion\Run` for auto-launch,
  `Software\Classes\amical` for the protocol); the same snapshot/diff pattern
  applies via `reg query`/`reg delete`. Verify on the real box (`ssh win`)
  when porting.
