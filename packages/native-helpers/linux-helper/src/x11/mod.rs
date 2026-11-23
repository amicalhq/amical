//! The X11 backend for X11 sessions (G2 §4a, §5, §6): key input from
//! XInput 2 raw events, shortcut consumption with passive key grabs, XTest
//! injection and the CLIPBOARD selection. Pure Rust (x11rb's
//! RustConnection): no Xlib or libxcb at run time.
//!
//! It uses three X connections, so that no thread waits on another:
//! - keys: the key thread reads raw key events, grab activations, keymap
//!   changes and _NET_ACTIVE_WINDOW changes; RPC handlers change grabs and
//!   read the key state on the same connection.
//! - clipboard owner: owns CLIPBOARD and serves it from its own thread, and
//!   counts owner changes.
//! - transaction: reads selections and sends XTest keys for pasteText and
//!   getSelectedTextViaCopy, one transaction at a time.
//!
//! All methods block on X round trips; call them from a blocking task.

mod clipboard;
mod gate;
mod keymap;
mod keys;
mod transaction;

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex, MutexGuard};

use tokio::sync::Notify;
use x11rb::connection::{Connection, RequestConnection};
use x11rb::errors::ReplyError;
use x11rb::protocol::xproto::{Atom, AtomEnum, ConnectionExt as _, Window};
use x11rb::protocol::{xfixes, xinput, xtest};
use x11rb::rust_connection::RustConnection;
use x11rb::NONE;

use crate::log::log;
use crate::models::{GetSelectedTextViaCopyResult, PasteTextResult};
use crate::writer::WeakOut;
use clipboard::{Owner, Reader};
use keys::KeyInput;
pub use transaction::{ChordSender, Selection};
use transaction::{Keys, Transaction, XSelection};

pub type Error = Box<dyn std::error::Error + Send + Sync>;

x11rb::atom_manager! {
    pub Atoms: AtomsCookie {
        CLIPBOARD,
        TARGETS,
        TIMESTAMP,
        MULTIPLE,
        INCR,
        UTF8_STRING,
        TEXT,
        TEXT_PLAIN_UTF8: b"text/plain;charset=utf-8",
        TEXT_PLAIN: b"text/plain",
        TEXT_HTML: b"text/html",
        TEXT_URI_LIST: b"text/uri-list",
        IMAGE_PNG: b"image/png",
        DELETE,
        INSERT_SELECTION,
        INSERT_PROPERTY,
        SAVE_TARGETS,
        LENGTH,
        _NET_ACTIVE_WINDOW,
        _AMICAL_SELECTION,
    }
}

impl Atoms {
    /// The targets of a snapshot, in the order to read them: text first,
    /// then the rest as the owner listed them. Targets that are requests
    /// with side effects (DELETE), meta targets and server resource ids
    /// (pixmaps, windows) are left out.
    fn snapshot_order(&self, targets: Vec<Atom>) -> Vec<Atom> {
        let skip: [Atom; 13] = [
            self.TARGETS,
            self.TIMESTAMP,
            self.MULTIPLE,
            self.DELETE,
            self.INSERT_SELECTION,
            self.INSERT_PROPERTY,
            self.SAVE_TARGETS,
            self.LENGTH,
            AtomEnum::PIXMAP.into(),
            AtomEnum::BITMAP.into(),
            AtomEnum::DRAWABLE.into(),
            AtomEnum::COLORMAP.into(),
            AtomEnum::WINDOW.into(),
        ];
        let first: [Atom; 8] = [
            self.UTF8_STRING,
            self.TEXT_PLAIN_UTF8,
            AtomEnum::STRING.into(),
            self.TEXT,
            self.TEXT_PLAIN,
            self.TEXT_HTML,
            self.TEXT_URI_LIST,
            self.IMAGE_PNG,
        ];
        let mut ordered: Vec<Atom> = first
            .iter()
            .copied()
            .filter(|atom| targets.contains(atom))
            .collect();
        for target in targets {
            if target != x11rb::NONE && !skip.contains(&target) && !ordered.contains(&target) {
                ordered.push(target);
            }
        }
        ordered
    }

    #[cfg(test)]
    fn for_tests() -> Self {
        // Distinct values above the predefined atoms.
        Self {
            CLIPBOARD: 101,
            TARGETS: 102,
            TIMESTAMP: 103,
            MULTIPLE: 104,
            INCR: 105,
            UTF8_STRING: 106,
            TEXT: 107,
            TEXT_PLAIN_UTF8: 108,
            TEXT_PLAIN: 109,
            TEXT_HTML: 110,
            TEXT_URI_LIST: 111,
            IMAGE_PNG: 112,
            DELETE: 113,
            INSERT_SELECTION: 114,
            INSERT_PROPERTY: 115,
            SAVE_TARGETS: 116,
            LENGTH: 117,
            _NET_ACTIVE_WINDOW: 118,
            _AMICAL_SELECTION: 119,
        }
    }
}

/// Logs the loss of an X connection and tells main, which shuts the helper
/// down. The calling thread then ends.
fn connection_lost(thread: &str, error: &dyn std::fmt::Display, lost: &Notify) {
    log!(
        "X11",
        "the {thread} connection to the X server closed: {error}"
    );
    lost.notify_one();
}

/// A lock that a panic on another thread does not poison for good.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The window manager's active window (_NET_ACTIVE_WINDOW), or NONE.
fn active_window(conn: &RustConnection, root: Window, atoms: &Atoms) -> Result<Window, ReplyError> {
    Ok(conn
        .get_property(
            false,
            root,
            atoms._NET_ACTIVE_WINDOW,
            AtomEnum::WINDOW,
            0,
            1,
        )?
        .reply()?
        .value32()
        .and_then(|mut values| values.next())
        .unwrap_or(NONE))
}

/// What the X server lets the backend do beyond key input, which it always
/// has (the backend needs XInput 2.1).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Features {
    /// XTEST: the paste and copy chords.
    pub injection: bool,
    /// XFIXES selection events: the clipboard owner and change counter.
    pub clipboard: bool,
}

pub struct X11Backend {
    features: Features,
    keys: Arc<KeyInput>,
    transaction: Transaction,
    /// None without XFIXES. Its lock serializes the transactions.
    selection: Option<Mutex<XSelection>>,
}

fn has_extension(conn: &RustConnection, name: &'static str) -> bool {
    matches!(conn.extension_information(name), Ok(Some(_)))
}

impl X11Backend {
    /// Connects to the X server and starts the key and clipboard threads.
    /// Fails without XInput 2.1; a missing XTEST or XFIXES turns off only
    /// the feature that needs it.
    /// `lost` is notified when a connection closes.
    pub fn connect(
        display: Option<&str>,
        events: WeakOut,
        lost: Arc<Notify>,
    ) -> Result<Self, Error> {
        let (keys_conn, screen) = RustConnection::connect(display)?;
        let root = keys_conn.setup().roots[screen].root;
        let atoms = Atoms::new(&keys_conn)?.reply()?;
        if !has_extension(&keys_conn, xinput::X11_EXTENSION_NAME) {
            return Err("the X server has no XInputExtension".into());
        }
        let keys = KeyInput::start(keys_conn, root, atoms, events, lost.clone())?;

        let (owner_conn, _) = RustConnection::connect(display)?;
        let owner = if has_extension(&owner_conn, xfixes::X11_EXTENSION_NAME) {
            match Owner::start(owner_conn, root, atoms, lost) {
                Ok(owner) => Some(owner),
                Err(error) => {
                    log!("X11", "no clipboard: {error}");
                    None
                }
            }
        } else {
            log!("X11", "no clipboard: the X server has no XFIXES");
            None
        };

        let (reader_conn, _) = RustConnection::connect(display)?;
        let reader_conn = Arc::new(reader_conn);
        let xtest = has_extension(&reader_conn, xtest::X11_EXTENSION_NAME);
        if !xtest {
            log!("X11", "no injection: the X server has no XTEST");
        }
        let selection = match owner {
            Some(owner) => Some(Mutex::new(XSelection {
                owner,
                reader: Reader::new(reader_conn.clone(), root, atoms)?,
            })),
            None => None,
        };

        let features = Features {
            injection: xtest,
            clipboard: selection.is_some(),
        };
        log!(
            "X11",
            "connected: injection {}, clipboard {}",
            features.injection,
            features.clipboard
        );
        Ok(Self {
            features,
            keys,
            transaction: Transaction {
                conn: reader_conn,
                root,
                atoms,
                xtest,
            },
            selection,
        })
    }

    pub fn features(&self) -> Features {
        self.features
    }

    /// Replaces the consumed chords. Codes that are not valid evdev codes
    /// stay in the chord, so that it can never be exactly held.
    pub fn set_shortcuts(&self, chords: Vec<Vec<i64>>, ids: Vec<String>) {
        let chords = chords
            .into_iter()
            .map(|chord| {
                chord
                    .into_iter()
                    .map(|code| u16::try_from(code).unwrap_or(u16::MAX))
                    .collect::<BTreeSet<u16>>()
            })
            .collect();
        self.keys.set_shortcuts(chords, ids);
    }

    pub fn set_draft_enter_capture(&self, enabled: bool) {
        self.keys.set_draft_enter_capture(enabled);
    }

    pub fn set_allow_injected_keys(&self, enabled: bool) {
        self.keys.set_allow_injected_keys(enabled);
    }

    /// The codes that the server says are up. On an error nothing is stale:
    /// a wrong "stale" would release a key the user holds.
    pub fn stale_keys(&self, codes: &[i64]) -> Vec<i64> {
        self.keys.stale_keys(codes).unwrap_or_else(|error| {
            log!("Keys", "cannot read the key state: {error}");
            Vec::new()
        })
    }

    /// Without injection the transcript stays on the clipboard and the
    /// result says that nothing was pasted.
    pub fn paste(&self, transcript: &str, preserve: bool) -> PasteTextResult {
        let Some(selection) = &self.selection else {
            return PasteTextResult {
                success: false,
                clipboard_set: Some(false),
                message: Some("No clipboard on this X server".to_owned()),
            };
        };
        self.transaction.paste(
            &Keys::XTest(&self.keys),
            &mut *lock(selection),
            transcript,
            preserve,
        )
    }

    pub fn copy_selection(&self) -> GetSelectedTextViaCopyResult {
        let Some(selection) = &self.selection else {
            return GetSelectedTextViaCopyResult {
                selected_text: None,
                clipboard_changed: false,
                message: Some("No clipboard on this X server".to_owned()),
            };
        };
        self.transaction
            .copy_selection(&Keys::XTest(&self.keys), &mut *lock(selection))
    }

    /// Removes the key grabs. The clipboard stays served until the process
    /// exits.
    pub fn shutdown(&self) {
        self.keys.ungrab_all();
    }
}

/// A clipboard with the paste and copy keys, on a Wayland session.
pub trait PasteRoute: Send + Sync {
    fn paste(&self, sender: &dyn ChordSender, transcript: &str, preserve: bool) -> PasteTextResult;
    fn copy_selection(&self, sender: &dyn ChordSender) -> GetSelectedTextViaCopyResult;
}

/// `S` holds the clipboard. An Xwayland connection gives the keymap (it
/// follows the compositor's) and the kind of a focused X window; a
/// [`ChordSender`] sends the keys. No key input and no XTest.
pub struct WaylandClipboard<S> {
    transaction: Transaction,
    /// Its lock serializes the transactions.
    selection: Mutex<S>,
}

impl<S: Selection + Send> PasteRoute for WaylandClipboard<S> {
    fn paste(&self, sender: &dyn ChordSender, transcript: &str, preserve: bool) -> PasteTextResult {
        self.transaction.paste(
            &Keys::Sender(sender),
            &mut *lock(&self.selection),
            transcript,
            preserve,
        )
    }

    fn copy_selection(&self, sender: &dyn ChordSender) -> GetSelectedTextViaCopyResult {
        self.transaction
            .copy_selection(&Keys::Sender(sender), &mut *lock(&self.selection))
    }
}

impl<S> WaylandClipboard<S> {
    /// `selection`, with an Xwayland connection for the keymap and the
    /// focused X window.
    pub fn with_selection(display: Option<&str>, selection: S) -> Result<Self, Error> {
        let (conn, screen) = RustConnection::connect(display)?;
        let root = conn.setup().roots[screen].root;
        let atoms = Atoms::new(&conn)?.reply()?;
        Ok(Self {
            transaction: Transaction {
                conn: Arc::new(conn),
                root,
                atoms,
                xtest: false,
            },
            selection: Mutex::new(selection),
        })
    }
}

impl WaylandClipboard<XSelection> {
    /// Xwayland's CLIPBOARD, on a compositor that bridges X selections both
    /// ways (GNOME). `lost` is notified when a connection closes.
    pub fn xwayland(display: Option<&str>, lost: Arc<Notify>) -> Result<Self, Error> {
        let (owner_conn, screen) = RustConnection::connect(display)?;
        let root = owner_conn.setup().roots[screen].root;
        let atoms = Atoms::new(&owner_conn)?.reply()?;
        if !has_extension(&owner_conn, xfixes::X11_EXTENSION_NAME) {
            return Err("the X server has no XFIXES".into());
        }
        let owner = Owner::start(owner_conn, root, atoms, lost)?;
        let (reader_conn, _) = RustConnection::connect(display)?;
        let conn = Arc::new(reader_conn);
        let reader = Reader::new(conn.clone(), root, atoms)?;
        log!("X11", "connected to Xwayland for the clipboard");
        Ok(Self {
            transaction: Transaction {
                conn,
                root,
                atoms,
                xtest: false,
            },
            selection: Mutex::new(XSelection { owner, reader }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshots_read_text_first_and_skip_side_effect_targets() {
        let atoms = Atoms::for_tests();
        let custom = 500;
        let order = atoms.snapshot_order(vec![
            atoms.TARGETS,
            custom,
            atoms.DELETE,
            atoms.TEXT_HTML,
            AtomEnum::PIXMAP.into(),
            atoms.UTF8_STRING,
            custom,
        ]);
        assert_eq!(order, [atoms.UTF8_STRING, atoms.TEXT_HTML, custom]);
    }
}
