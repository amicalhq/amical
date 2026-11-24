//! Recording sounds and system-audio mute (contract §2.7, §2.8; G2 §8).
//!
//! startRecording plays rec-start, then mutes; stopRecording restores, then
//! plays rec-stop, as on macOS and Windows. Each call waits for its sound
//! (at most SOUND_LIMIT), so that the app's microphone starts after it.
//! Sounds go through pw-play or paplay, mute through wpctl or pactl:
//! whichever the session has. A sound that does not play is logged and
//! never fails the call.
//!
//! A marker file in the runtime directory records that this helper muted
//! the output, so that a restarted helper still unmutes it.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;
use tokio::sync::Mutex;

use crate::log::log;

/// Longest wait for a sound. The sounds are about 0.1 s.
const SOUND_LIMIT: Duration = Duration::from_secs(1);
/// Longest wait for a mixer command.
const MIXER_LIMIT: Duration = Duration::from_secs(1);

const REC_START: &[u8] = include_bytes!("../sounds/rec-start.wav");
const REC_STOP: &[u8] = include_bytes!("../sounds/rec-stop.wav");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Player {
    PwPlay,
    Paplay,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mixer {
    Wpctl,
    Pactl,
}

impl Mixer {
    fn program(self) -> &'static str {
        match self {
            Self::Wpctl => "wpctl",
            Self::Pactl => "pactl",
        }
    }

    fn query(self) -> &'static [&'static str] {
        match self {
            Self::Wpctl => &["get-volume", "@DEFAULT_AUDIO_SINK@"],
            Self::Pactl => &["get-sink-mute", "@DEFAULT_SINK@"],
        }
    }

    fn set(self, muted: bool) -> Vec<&'static str> {
        let value = if muted { "1" } else { "0" };
        match self {
            Self::Wpctl => vec!["set-mute", "@DEFAULT_AUDIO_SINK@", value],
            Self::Pactl => vec!["set-sink-mute", "@DEFAULT_SINK@", value],
        }
    }

    /// Whether the output is muted, from the query's output:
    /// "Volume: 0.40 [MUTED]" (wpctl) or "Mute: yes" (pactl).
    fn is_muted(self, output: &str) -> bool {
        match self {
            Self::Wpctl => output.contains("[MUTED]"),
            Self::Pactl => output.trim().eq_ignore_ascii_case("mute: yes"),
        }
    }
}

/// The first program of `names` in PATH.
fn find<T: Copy>(path: &str, names: &[(&str, T)]) -> Option<T> {
    names.iter().find_map(|&(name, value)| {
        std::env::split_paths(path)
            .any(|dir| dir.join(name).is_file())
            .then_some(value)
    })
}

pub struct Ambiance {
    player: Option<Player>,
    mixer: Option<Mixer>,
    /// The sound files and the mute marker live here.
    dir: PathBuf,
    /// One start or stop at a time.
    lock: Mutex<()>,
}

impl Ambiance {
    pub fn new() -> Self {
        let path = std::env::var("PATH").unwrap_or_default();
        let player = find(
            &path,
            &[("pw-play", Player::PwPlay), ("paplay", Player::Paplay)],
        );
        let mixer = find(&path, &[("wpctl", Mixer::Wpctl), ("pactl", Mixer::Pactl)]);
        let dir = std::env::var_os("XDG_RUNTIME_DIR")
            .filter(|dir| !dir.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("amical-helper");
        Self {
            player,
            mixer,
            dir,
            lock: Mutex::new(()),
        }
    }

    pub fn available(&self) -> bool {
        self.player.is_some() || self.mixer.is_some()
    }

    fn marker(&self) -> PathBuf {
        self.dir.join("muted-output")
    }

    /// Plays rec-start unless `mute_sounds`, then mutes when asked. Success
    /// is false only when a mute was asked and failed.
    pub async fn start(&self, mute_system_audio: bool, mute_sounds: bool) -> bool {
        let _guard = self.lock.lock().await;
        if !mute_sounds {
            self.play("rec-start.wav", REC_START).await;
        }
        !mute_system_audio || self.mute().await
    }

    /// Restores the output when the app muted it, then plays rec-stop
    /// unless `mute_sounds`.
    pub async fn stop(&self, was_muted: bool, mute_sounds: bool) -> bool {
        let _guard = self.lock.lock().await;
        let restored = !was_muted || self.restore().await;
        if !mute_sounds {
            self.play("rec-stop.wav", REC_STOP).await;
        }
        restored
    }

    /// Helper exit: unmutes an output that this helper muted.
    pub async fn shutdown(&self) {
        let _guard = self.lock.lock().await;
        if self.marker().exists() {
            self.restore().await;
        }
    }

    /// Mutes the default output. An output that is already muted stays as
    /// it is and is not unmuted later.
    async fn mute(&self) -> bool {
        let Some(mixer) = self.mixer else {
            log!("Ambiance", "no wpctl or pactl: cannot mute");
            return false;
        };
        match run(mixer.program(), mixer.query()).await {
            Some(output) if mixer.is_muted(&output) => return true,
            Some(_) => {}
            None => return false,
        }
        if run(mixer.program(), &mixer.set(true)).await.is_none() {
            return false;
        }
        if let Err(error) = write_private(&self.dir, &self.marker(), b"") {
            log!("Ambiance", "cannot write the mute marker: {}", error.kind());
        }
        true
    }

    /// Unmutes the default output if this helper (or an earlier run of it)
    /// muted it.
    async fn restore(&self) -> bool {
        if !self.marker().exists() {
            return true;
        }
        let Some(mixer) = self.mixer else {
            return false;
        };
        let restored = run(mixer.program(), &mixer.set(false)).await.is_some();
        if restored {
            let _ = std::fs::remove_file(self.marker());
        }
        restored
    }

    async fn play(&self, name: &str, bytes: &[u8]) {
        let Some(player) = self.player else { return };
        let file = self.dir.join(name);
        let current = std::fs::metadata(&file).is_ok_and(|meta| meta.len() == bytes.len() as u64);
        if !current {
            if let Err(error) = write_private(&self.dir, &file, bytes) {
                log!("Ambiance", "cannot write {name}: {}", error.kind());
                return;
            }
        }
        let program = match player {
            Player::PwPlay => "pw-play",
            Player::Paplay => "paplay",
        };
        let child = Command::new(program)
            .arg(&file)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn();
        let mut child = match child {
            Ok(child) => child,
            Err(error) => {
                log!("Ambiance", "cannot start {program}: {}", error.kind());
                return;
            }
        };
        match tokio::time::timeout(SOUND_LIMIT, child.wait()).await {
            Ok(Ok(status)) if status.success() => {}
            Ok(Ok(status)) => log!("Ambiance", "{program} ended with {status}"),
            Ok(Err(error)) => log!("Ambiance", "{program} failed: {}", error.kind()),
            Err(_) => log!(
                "Ambiance",
                "{program} took longer than {SOUND_LIMIT:?}; stopped"
            ),
        }
    }
}

/// Runs a mixer command; its stdout, or None when it fails.
async fn run(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(MIXER_LIMIT, output).await {
        Ok(Ok(output)) if output.status.success() => {
            Some(String::from_utf8_lossy(&output.stdout).into_owned())
        }
        Ok(Ok(output)) => {
            log!(
                "Ambiance",
                "{program} {} ended with {}",
                args[0],
                output.status
            );
            None
        }
        Ok(Err(error)) => {
            log!("Ambiance", "cannot run {program}: {}", error.kind());
            None
        }
        Err(_) => {
            log!(
                "Ambiance",
                "{program} {} took longer than {MIXER_LIMIT:?}",
                args[0]
            );
            None
        }
    }
}

/// Writes `bytes` to `file` in `dir`, both readable by the user only.
fn write_private(dir: &Path, file: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write as _;
    use std::os::unix::fs::{DirBuilderExt as _, OpenOptionsExt as _};
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)?;
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(file)?
        .write_all(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mute_state_is_read_from_both_mixers() {
        assert!(Mixer::Wpctl.is_muted("Volume: 0.40 [MUTED]\n"));
        assert!(!Mixer::Wpctl.is_muted("Volume: 0.40\n"));
        assert!(Mixer::Pactl.is_muted("Mute: yes\n"));
        assert!(!Mixer::Pactl.is_muted("Mute: no\n"));
    }
}
