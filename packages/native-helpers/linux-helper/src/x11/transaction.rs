//! pasteText and getSelectedTextViaCopy (G2 §5.1, §5.4; contract §2.5,
//! §2.6): the clipboard dance around one chord. The clipboard is a
//! [`Selection`] (X selections, or Wayland data-control); the chord goes out
//! through XTest or a [`ChordSender`]. One transaction runs at a time (the
//! caller holds the selection lock).
//!
//! Neither the transcript nor clipboard text is logged; only lengths.

use std::sync::Arc;
use std::thread::sleep;
use std::time::{Duration, Instant};

use x11rb::errors::ReplyError;
use x11rb::protocol::xproto::{
    AtomEnum, ConnectionExt as _, InputFocus, Window, KEY_PRESS_EVENT, KEY_RELEASE_EVENT,
};
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::rust_connection::RustConnection;
use x11rb::{CURRENT_TIME, NONE};

use super::clipboard::{text_items, Owner, Reader, Snapshot};
use super::keymap::Keymap;
use super::keymap::{XK_CONTROL_L, XK_INSERT, XK_LOWER_C, XK_LOWER_V, XK_SHIFT_L};
use super::keys::{is_down, KeyInput};
use super::{active_window, Atoms};
use crate::log::{log, Redacted};
use crate::models::{GetSelectedTextViaCopyResult, PasteTextResult};

/// How long a paste waits for the user to release modifiers and consumed
/// keys, so that they do not combine with the injected chord.
const PASTE_IDLE_WAIT: Duration = Duration::from_secs(2);
/// The copy capture must answer within the desktop's 2 s, so it waits less.
const COPY_IDLE_WAIT: Duration = Duration::from_millis(500);
const IDLE_POLL: Duration = Duration::from_millis(20);
const PASTE_SNAPSHOT_BUDGET: Duration = Duration::from_millis(500);
const COPY_SNAPSHOT_BUDGET: Duration = Duration::from_millis(400);
/// Settle: the first selection request after the set (a clipboard manager
/// or the compositor bridge asking for TARGETS) plus a margin, at most
/// SETTLE_MAX.
const SETTLE_MAX: Duration = Duration::from_millis(150);
const SETTLE_MARGIN: Duration = Duration::from_millis(10);
/// Gap between the key events of a chord.
const KEY_GAP: Duration = Duration::from_millis(5);
/// The app reads the clipboard within this time after the chord; then the
/// old clipboard comes back. Same as macOS and Windows.
const RESTORE_DELAY: Duration = Duration::from_millis(700);
const COPY_POLL: Duration = Duration::from_millis(25);
const COPY_WAIT: Duration = Duration::from_millis(300);
const COPY_READ_BUDGET: Duration = Duration::from_millis(300);

/// What the focused window does with the paste and copy chords.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    App,
    /// Pastes with Ctrl+Shift+V and copies with Ctrl+Shift+C; Ctrl+V and
    /// Ctrl+C mean something else to the program in the terminal.
    Terminal,
    /// A terminal with no default key for the CLIPBOARD selection. Every
    /// chord reaches the program in it (Ctrl+Shift+C as an interrupt), so
    /// the helper sends none.
    NoClipboardKeys,
}

/// WM_CLASS names (instance or class, lower case) of terminals that paste
/// with Ctrl+Shift+V and copy with Ctrl+Shift+C.
const TERMINALS: &[&str] = &[
    "alacritty",
    "blackbox",
    "com.gexperts.tilix",
    "com.mitchellh.ghostty",
    "com.raggesilver.blackbox",
    "cool-retro-term",
    "deepin-terminal",
    "foot",
    "footclient",
    "ghostty",
    "gnome-terminal",
    "gnome-terminal-server",
    "guake",
    "io.elementary.terminal",
    "kgx",
    "kitty",
    "konsole",
    "lxterminal",
    "mate-terminal",
    "org.gnome.console",
    "org.gnome.ptyxis",
    "org.gnome.terminal",
    "org.kde.konsole",
    "org.wezfurlong.wezterm",
    "ptyxis",
    "qterminal",
    "sakura",
    "st",
    "st-256color",
    "terminator",
    "terminology",
    "tilda",
    "tilix",
    "wezterm",
    "xfce4-terminal",
    "yakuake",
];

/// Terminals with no default CLIPBOARD key: they paste the PRIMARY
/// selection with Shift+Insert.
const NO_CLIPBOARD_KEY_TERMINALS: &[&str] = &["rxvt", "rxvt-unicode", "urxvt", "uxterm", "xterm"];

/// The target that a WM_CLASS value (instance and class, NUL-separated)
/// names.
pub fn target_of(wm_class: &[u8]) -> Target {
    let names: Vec<String> = wm_class
        .split(|&byte| byte == 0)
        .filter(|name| !name.is_empty())
        .map(|name| String::from_utf8_lossy(name).to_lowercase())
        .collect();
    let any_in = |list: &[&str]| names.iter().any(|name| list.contains(&name.as_str()));
    if any_in(NO_CLIPBOARD_KEY_TERMINALS) {
        Target::NoClipboardKeys
    } else if any_in(TERMINALS) {
        Target::Terminal
    } else {
        Target::App
    }
}

/// The clipboard side of a transaction.
pub trait Selection {
    type Snapshot;
    /// Every format of the clipboard now, read within `budget`.
    fn snapshot(&mut self, budget: Duration) -> Self::Snapshot;
    /// False when the clipboard could not be read: there is nothing to put
    /// back.
    fn is_readable(snapshot: &Self::Snapshot) -> bool;
    /// Puts `text` on the clipboard and waits until the compositor (or a
    /// bridge) has taken it.
    fn set_text(&mut self, text: &str) -> Result<(), String>;
    /// True while the clipboard still holds what this helper put there.
    fn owns(&self) -> bool;
    /// Clipboard changes by any client, counted since the start.
    fn changes(&self) -> u64;
    fn read_text(&mut self, deadline: Instant) -> Option<String>;
    fn restore(&mut self, snapshot: Self::Snapshot) -> Result<(), String>;
}

/// The CLIPBOARD selection of an X server: [`Owner`] serves it, [`Reader`]
/// reads it.
pub struct XSelection {
    pub owner: Arc<Owner>,
    pub reader: Reader,
}

impl Selection for XSelection {
    type Snapshot = Snapshot;

    fn snapshot(&mut self, budget: Duration) -> Snapshot {
        self.reader.snapshot(&self.owner, budget)
    }

    fn is_readable(snapshot: &Snapshot) -> bool {
        !matches!(snapshot, Snapshot::Unreadable)
    }

    /// Settles on the first selection request after the set (a clipboard
    /// manager or the compositor bridge asking for TARGETS), at most
    /// SETTLE_MAX.
    fn set_text(&mut self, text: &str) -> Result<(), String> {
        let requests = self.owner.requests();
        self.owner
            .set(text_items(text, &self.reader.atoms))
            .map_err(|error| error.to_string())?;
        if self.owner.wait_for_request(requests, SETTLE_MAX) {
            sleep(SETTLE_MARGIN);
        }
        Ok(())
    }

    fn owns(&self) -> bool {
        self.owner.owns()
    }

    fn changes(&self) -> u64 {
        self.owner.changes()
    }

    fn read_text(&mut self, deadline: Instant) -> Option<String> {
        self.reader.read_text(deadline)
    }

    fn restore(&mut self, snapshot: Snapshot) -> Result<(), String> {
        self.owner
            .restore(snapshot)
            .map_err(|error| error.to_string())
    }
}

/// Puts `snapshot` back when `unchanged` says that the clipboard still
/// holds what the transaction put there. Returns the note for the result.
fn restore<S: Selection>(
    selection: &mut S,
    snapshot: S::Snapshot,
    unchanged: bool,
    after: &str,
) -> Option<String> {
    if !S::is_readable(&snapshot) {
        return Some("Clipboard not restored: the previous clipboard could not be read".to_owned());
    }
    if !unchanged {
        return Some(format!(
            "Clipboard not restored: it changed after the {after}"
        ));
    }
    match selection.restore(snapshot) {
        Ok(()) => None,
        Err(error) => {
            log!("Clipboard", "cannot restore the clipboard: {error}");
            Some("Clipboard not restored".to_owned())
        }
    }
}

/// "; <note>" for a log line, or nothing.
fn log_note(note: &Option<String>) -> String {
    note.as_deref()
        .map(|note| format!("; {note}"))
        .unwrap_or_default()
}

/// Sends a chord where XTest cannot reach the focused app: the
/// RemoteDesktop portal on a Wayland session. Takes evdev key codes.
pub trait ChordSender {
    fn send(&self, codes: &[u16]) -> Result<(), String>;
}

/// The keyboard side of a transaction.
pub enum Keys<'a> {
    /// X11 session: the key state and XTest.
    XTest(&'a KeyInput),
    /// Wayland session: the helper cannot see which keys the user holds.
    Sender(&'a dyn ChordSender),
}

/// The keyboard side of a transaction, on an X connection: the focused
/// window's kind, the keymap, and XTest.
pub struct Transaction {
    pub conn: Arc<RustConnection>,
    pub root: Window,
    pub atoms: Atoms,
    pub xtest: bool,
}

impl Transaction {
    /// Waits until no modifier key is held and no consumed key is held, at
    /// most `timeout`. A consuming grab still active then is ended, so that
    /// the chord reaches the app and not this helper.
    fn wait_until_idle(&self, keys: &Keys<'_>, timeout: Duration) {
        let Keys::XTest(keys) = *keys else {
            return;
        };
        let deadline = Instant::now() + timeout;
        let modifiers = keys.keymap().held_modifier_keycodes();
        loop {
            let consumed = keys.consumed_key_held();
            let modifier_held = match keys.key_state() {
                Ok(state) => modifiers.iter().any(|&keycode| is_down(&state, keycode)),
                Err(_) => false,
            };
            if !consumed && !modifier_held {
                return;
            }
            if Instant::now() >= deadline {
                log!(
                    "Inject",
                    "keys still held after {} ms (modifier={modifier_held} consumed={consumed}); going on",
                    timeout.as_millis()
                );
                if consumed {
                    keys.release_keyboard();
                }
                return;
            }
            sleep(IDLE_POLL);
        }
    }

    /// The focused window: _NET_ACTIVE_WINDOW from the window manager, else
    /// the input focus.
    fn focused_window(&self) -> Result<Window, ReplyError> {
        let (conn, root, atoms) = (&*self.conn, self.root, &self.atoms);
        let active = active_window(conn, root, atoms)?;
        if active != NONE {
            return Ok(active);
        }
        let focus = conn.get_input_focus()?.reply()?.focus;
        let pointer_root: Window = InputFocus::POINTER_ROOT.into();
        Ok(if focus == pointer_root { NONE } else { focus })
    }

    /// The target of the focused window, or of its nearest ancestor with a
    /// WM_CLASS.
    fn target(&self) -> Target {
        let conn = &self.conn;
        let lookup = || -> Result<Target, ReplyError> {
            let mut window = self.focused_window()?;
            for _ in 0..8 {
                if window == NONE || window == self.root {
                    break;
                }
                let class = conn
                    .get_property(false, window, AtomEnum::WM_CLASS, AtomEnum::STRING, 0, 256)?
                    .reply()?;
                if !class.value.is_empty() {
                    return Ok(target_of(&class.value));
                }
                window = conn.query_tree(window)?.reply()?.parent;
            }
            Ok(Target::App)
        };
        lookup().unwrap_or(Target::App)
    }

    fn can_inject(&self, keys: &Keys<'_>) -> bool {
        matches!(keys, Keys::Sender(_)) || self.xtest
    }

    /// Sends `keysyms` as one chord: presses in order, releases in reverse.
    fn inject(&self, keys: &Keys<'_>, keysyms: &[u32]) -> Result<(), String> {
        let keys = match *keys {
            Keys::XTest(keys) => keys,
            Keys::Sender(sender) => {
                // Xwayland's keymap follows the compositor's, so it gives
                // the keys of the active layout.
                let keymap = Keymap::fetch(&*self.conn).map_err(|error| error.to_string())?;
                let codes = keysyms
                    .iter()
                    .map(|&keysym| {
                        keymap
                            .resolve(keysym)
                            .and_then(|keycode| keycode.checked_sub(8))
                    })
                    .map(|code| code.map(u16::from))
                    .collect::<Option<Vec<u16>>>()
                    .ok_or("no key for the chord")?;
                return sender.send(&codes);
            }
        };
        if !self.xtest {
            return Err("the X server has no XTEST extension".to_owned());
        }
        let keymap = keys.keymap();
        let keycodes = keysyms
            .iter()
            .map(|&keysym| keymap.resolve(keysym))
            .collect::<Option<Vec<u8>>>()
            .ok_or("no key for the chord")?;
        let events: Vec<(u8, bool)> = keycodes
            .iter()
            .map(|&keycode| (keycode, true))
            .chain(keycodes.iter().rev().map(|&keycode| (keycode, false)))
            .collect();
        keys.expect_echo(&events);
        let conn = &self.conn;
        let mut first_error = None;
        for (index, &(keycode, down)) in events.iter().enumerate() {
            let kind = if down {
                KEY_PRESS_EVENT
            } else {
                KEY_RELEASE_EVENT
            };
            // Every event goes out, so that a failed press still gets its
            // release.
            let result = conn
                .xtest_fake_input(kind, keycode, CURRENT_TIME, NONE, 0, 0, 0)
                .map_err(ReplyError::from)
                .and_then(|cookie| cookie.check());
            if let Err(error) = result {
                first_error.get_or_insert_with(|| error.to_string());
            }
            if index + 1 < events.len() {
                sleep(KEY_GAP);
            }
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    pub fn paste<S: Selection>(
        &self,
        keys: &Keys<'_>,
        selection: &mut S,
        transcript: &str,
        preserve: bool,
    ) -> PasteTextResult {
        let start = Instant::now();
        self.wait_until_idle(keys, PASTE_IDLE_WAIT);
        let target = self.target();
        if target == Target::NoClipboardKeys {
            // clipboardSet false: the desktop puts the transcript on the
            // clipboard itself and tells the user.
            log!(
                "Paste",
                "the focused terminal has no paste key; transcript {}",
                Redacted(transcript)
            );
            return PasteTextResult {
                success: false,
                clipboard_set: Some(false),
                message: Some(
                    "The focused terminal has no key that pastes the clipboard".to_owned(),
                ),
            };
        }
        let snapshot = preserve.then(|| selection.snapshot(PASTE_SNAPSHOT_BUDGET));
        if let Err(error) = selection.set_text(transcript) {
            log!("Paste", "cannot set the clipboard: {error}");
            return PasteTextResult {
                success: false,
                clipboard_set: Some(false),
                message: Some("Could not set the clipboard".to_owned()),
            };
        }

        let terminal = target == Target::Terminal;
        let chord: &[u32] = if terminal {
            &[XK_CONTROL_L, XK_SHIFT_L, XK_LOWER_V]
        } else {
            &[XK_CONTROL_L, XK_LOWER_V]
        };
        if let Err(error) = self.inject(keys, chord) {
            // The transcript stays on the clipboard for a manual paste.
            log!("Paste", "cannot send the paste chord: {error}");
            return PasteTextResult {
                success: false,
                clipboard_set: Some(true),
                message: Some("Could not send the paste keys".to_owned()),
            };
        }

        sleep(RESTORE_DELAY);
        let message = snapshot.and_then(|snapshot| {
            let unchanged = selection.owns();
            restore(selection, snapshot, unchanged, "paste")
        });
        log!(
            "Paste",
            "pasted transcript {} with {} in {} ms{}",
            Redacted(transcript),
            if terminal { "Ctrl+Shift+V" } else { "Ctrl+V" },
            start.elapsed().as_millis(),
            log_note(&message)
        );
        PasteTextResult {
            success: true,
            clipboard_set: Some(true),
            message,
        }
    }

    pub fn copy_selection<S: Selection>(
        &self,
        keys: &Keys<'_>,
        selection: &mut S,
    ) -> GetSelectedTextViaCopyResult {
        let none = |message: &str| GetSelectedTextViaCopyResult {
            selected_text: None,
            clipboard_changed: false,
            message: Some(message.to_owned()),
        };
        if !self.can_inject(keys) {
            return none("Injection is not available");
        }
        let start = Instant::now();
        self.wait_until_idle(keys, COPY_IDLE_WAIT);
        let target = self.target();
        if target == Target::NoClipboardKeys {
            return none("The focused terminal has no key that copies to the clipboard");
        }
        let snapshot = selection.snapshot(COPY_SNAPSHOT_BUDGET);
        let changes = selection.changes();
        let chord: &[u32] = if target == Target::Terminal {
            &[XK_CONTROL_L, XK_SHIFT_L, XK_LOWER_C]
        } else {
            // Ctrl+Insert, not Ctrl+C: Ctrl+C interrupts console programs.
            &[XK_CONTROL_L, XK_INSERT]
        };
        if let Err(error) = self.inject(keys, chord) {
            log!("Copy", "cannot send the copy chord: {error}");
            return none("Could not send the copy keys");
        }
        let poll_deadline = Instant::now() + COPY_WAIT;
        while selection.changes() == changes {
            if Instant::now() >= poll_deadline {
                log!("Copy", "no copy within {} ms", COPY_WAIT.as_millis());
                return none("No copy landed within timeout");
            }
            sleep(COPY_POLL);
        }
        let copied = selection.changes();
        let text = selection.read_text(Instant::now() + COPY_READ_BUDGET);
        let unchanged = selection.changes() == copied;
        let message = restore(selection, snapshot, unchanged, "copy");
        log!(
            "Copy",
            "copied {} in {} ms{}",
            text.as_deref()
                .map(|text| Redacted(text).to_string())
                .unwrap_or_else(|| "no text".to_owned()),
            start.elapsed().as_millis(),
            log_note(&message)
        );
        GetSelectedTextViaCopyResult {
            selected_text: text,
            clipboard_changed: true,
            message,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminals_are_known_by_either_wm_class_name() {
        assert_eq!(
            target_of(b"gnome-terminal-server\0Gnome-terminal\0"),
            Target::Terminal
        );
        assert_eq!(target_of(b"Alacritty\0Alacritty\0"), Target::Terminal);
        assert_eq!(target_of(b"kitty\0kitty\0"), Target::Terminal);
        assert_eq!(target_of(b"xterm\0XTerm\0"), Target::NoClipboardKeys);
        assert_eq!(target_of(b"urxvt\0URxvt\0"), Target::NoClipboardKeys);
        assert_eq!(target_of(b"gedit\0Gedit\0"), Target::App);
        assert_eq!(target_of(b"\0\0"), Target::App);
        // Electron apps that contain "term" in the name are not terminals.
        assert_eq!(target_of(b"code\0Code\0"), Target::App);
    }
}
