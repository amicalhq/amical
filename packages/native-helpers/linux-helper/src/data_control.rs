//! The clipboard through the ext-data-control-v1 Wayland protocol (G2 §6,
//! wl-data-control column). KDE Plasma 6.4 and later give it to
//! unsandboxed clients, without focus and without consent.
//!
//! A thread dispatches the Wayland events: it keeps the current selection
//! offer and its MIME types, counts selection changes, and serves the
//! helper's own clipboard. Transactions read and set the clipboard from
//! their own thread; every read has a deadline.
//!
//! Clipboard bytes are never logged; only counts and sizes.

use std::collections::HashMap;
use std::io::{Read as _, Write as _};
use std::os::fd::{AsFd as _, OwnedFd};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use rustix::event::{poll, PollFd, PollFlags, Timespec};
use tokio::sync::Notify;
use wayland_client::backend::ObjectId;
use wayland_client::globals::{registry_queue_init, GlobalListContents};
use wayland_client::protocol::wl_registry::WlRegistry;
use wayland_client::protocol::wl_seat::WlSeat;
use wayland_client::{event_created_child, Connection, Dispatch, Proxy as _, QueueHandle};
use wayland_protocols::ext::data_control::v1::client::ext_data_control_device_v1::{
    self, ExtDataControlDeviceV1,
};
use wayland_protocols::ext::data_control::v1::client::ext_data_control_manager_v1::ExtDataControlManagerV1;
use wayland_protocols::ext::data_control::v1::client::ext_data_control_offer_v1::{
    self, ExtDataControlOfferV1,
};
use wayland_protocols::ext::data_control::v1::client::ext_data_control_source_v1::{
    self, ExtDataControlSourceV1,
};

use crate::log::log;
use crate::x11::Selection;

/// Largest value read for one MIME type of a snapshot or a copy.
const ITEM_CAP: usize = 8 * 1024 * 1024;
/// Largest snapshot in total.
const SNAPSHOT_CAP: usize = 32 * 1024 * 1024;
/// How long a set waits for the compositor to announce our selection.
const SETTLE_MAX: Duration = Duration::from_millis(100);
/// How long serving one read may take before the reader counts as stalled.
const SERVE_LIMIT: Duration = Duration::from_secs(5);
/// The MIME types of a text, the preferred one first.
const TEXT_TYPES: [&str; 5] = [
    "text/plain;charset=utf-8",
    "UTF8_STRING",
    "text/plain",
    "TEXT",
    "STRING",
];

pub type Error = Box<dyn std::error::Error + Send + Sync>;

/// One MIME type of a selection, with its bytes.
pub type Item = (String, Vec<u8>);

/// The clipboard before a paste or a copy.
pub enum Snapshot {
    /// No selection: restoring clears the clipboard.
    Empty,
    Items(Arc<Vec<Item>>),
    /// The source did not answer. There is nothing to restore.
    Unreadable,
}

#[derive(Default)]
struct Shared {
    /// MIME types of offers that are not the selection yet.
    pending: HashMap<ObjectId, Vec<String>>,
    current: Option<(ExtDataControlOfferV1, Vec<String>)>,
    changes: u64,
    /// The source that holds this helper's clipboard, and what it serves.
    serving: Option<(ExtDataControlSourceV1, Arc<Vec<Item>>)>,
}

#[derive(Default)]
struct Inner {
    shared: Mutex<Shared>,
    changed: Condvar,
}

impl Inner {
    fn lock(&self) -> MutexGuard<'_, Shared> {
        self.shared
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

struct State {
    inner: Arc<Inner>,
}

pub struct DataControl {
    conn: Connection,
    qh: QueueHandle<State>,
    manager: ExtDataControlManagerV1,
    device: ExtDataControlDeviceV1,
    inner: Arc<Inner>,
}

impl DataControl {
    /// Connects to the compositor (WAYLAND_DISPLAY), binds data-control on
    /// the first seat, reads the current selection, and starts the event
    /// thread. `lost` is notified when the connection closes.
    pub fn connect(lost: Arc<Notify>) -> Result<Self, Error> {
        let conn = Connection::connect_to_env()?;
        let (globals, mut queue) = registry_queue_init::<State>(&conn)?;
        let qh = queue.handle();
        let manager: ExtDataControlManagerV1 = globals
            .bind(&qh, 1..=1, ())
            .map_err(|error| format!("no ext-data-control: {error}"))?;
        let seat: WlSeat = globals.bind(&qh, 1..=1, ())?;
        let device = manager.get_data_device(&seat, &qh, ());
        let inner = Arc::new(Inner::default());
        let mut state = State {
            inner: inner.clone(),
        };
        queue.roundtrip(&mut state)?;
        std::thread::Builder::new()
            .name("wl-clipboard".to_owned())
            .spawn(move || loop {
                if let Err(error) = queue.blocking_dispatch(&mut state) {
                    log!("Clipboard", "Wayland connection closed: {error}");
                    lost.notify_one();
                    return;
                }
            })?;
        log!("Clipboard", "connected to data-control");
        Ok(Self {
            conn,
            qh,
            manager,
            device,
            inner,
        })
    }

    /// Takes the selection with `items`, and waits until the compositor
    /// announces it.
    fn set_items(&mut self, items: Arc<Vec<Item>>) -> Result<(), String> {
        let source = self.manager.create_data_source(&self.qh, ());
        for (mime, _) in items.iter() {
            source.offer(mime.clone());
        }
        let before = {
            let mut shared = self.inner.lock();
            shared.serving = Some((source.clone(), items));
            shared.changes
        };
        self.device.set_selection(Some(&source));
        self.conn.flush().map_err(|error| error.to_string())?;
        let shared = self.inner.lock();
        let _ = self
            .inner
            .changed
            .wait_timeout_while(shared, SETTLE_MAX, |shared| shared.changes == before);
        Ok(())
    }

    /// Reads `mime` of `offer` through a pipe, at most `cap` bytes, before
    /// `deadline`. Ok(None) when the value is larger than `cap`.
    fn receive(
        &self,
        offer: &ExtDataControlOfferV1,
        mime: &str,
        deadline: Instant,
        cap: usize,
    ) -> Result<Option<Vec<u8>>, String> {
        let (mut reader, writer) = std::io::pipe().map_err(|error| error.to_string())?;
        offer.receive(mime.to_owned(), writer.as_fd());
        self.conn.flush().map_err(|error| error.to_string())?;
        drop(writer);
        let mut data = Vec::new();
        let mut chunk = [0u8; 64 * 1024];
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err("timed out".to_owned());
            }
            let timeout = Timespec {
                tv_sec: left.as_secs() as _,
                tv_nsec: left.subsec_nanos().into(),
            };
            let mut fds = [PollFd::new(&reader, PollFlags::IN)];
            match poll(&mut fds, Some(&timeout)) {
                Ok(0) => return Err("timed out".to_owned()),
                Ok(_) => {}
                Err(rustix::io::Errno::INTR) => continue,
                Err(error) => return Err(error.to_string()),
            }
            // poll said readable: this read does not block.
            let read = reader.read(&mut chunk).map_err(|error| error.to_string())?;
            if read == 0 {
                return Ok(Some(data));
            }
            if data.len() + read > cap {
                return Ok(None);
            }
            data.extend_from_slice(&chunk[..read]);
        }
    }

    fn current(&self) -> Option<(ExtDataControlOfferV1, Vec<String>)> {
        self.inner.lock().current.clone()
    }
}

/// The text item set of `text`: UTF-8 under every text MIME type, Latin-1
/// (with '?' outside it) for STRING.
fn text_items(text: &str) -> Arc<Vec<Item>> {
    let latin1: Vec<u8> = text
        .chars()
        .map(|c| u8::try_from(u32::from(c)).unwrap_or(b'?'))
        .collect();
    Arc::new(
        TEXT_TYPES
            .iter()
            .map(|&mime| {
                let data = if mime == "STRING" {
                    latin1.clone()
                } else {
                    text.as_bytes().to_vec()
                };
                (mime.to_owned(), data)
            })
            .collect(),
    )
}

/// Text types first, in preference order, then the rest as offered.
fn snapshot_order(mimes: &[String]) -> Vec<String> {
    let mut ordered: Vec<String> = TEXT_TYPES
        .iter()
        .filter(|mime| mimes.iter().any(|offered| offered == *mime))
        .map(|mime| (*mime).to_owned())
        .collect();
    for mime in mimes {
        if !ordered.contains(mime) {
            ordered.push(mime.clone());
        }
    }
    ordered
}

impl Selection for DataControl {
    type Snapshot = Snapshot;

    /// Reads the offered types in order until `budget` runs out; a type
    /// that does not arrive in time ends the snapshot with what it has.
    fn snapshot(&mut self, budget: Duration) -> Snapshot {
        let Some((offer, mimes)) = self.current() else {
            return Snapshot::Empty;
        };
        let deadline = Instant::now() + budget;
        let mut items = Vec::new();
        let mut total = 0;
        for mime in snapshot_order(&mimes) {
            let cap = ITEM_CAP.min(SNAPSHOT_CAP - total);
            match self.receive(&offer, &mime, deadline, cap) {
                Ok(Some(data)) => {
                    total += data.len();
                    items.push((mime, data));
                }
                Ok(None) => log!(
                    "Clipboard",
                    "a snapshot type is over the size cap; left out"
                ),
                Err(error) => {
                    log!("Clipboard", "snapshot stopped: {error}");
                    break;
                }
            }
        }
        if items.is_empty() {
            Snapshot::Unreadable
        } else {
            Snapshot::Items(Arc::new(items))
        }
    }

    fn is_readable(snapshot: &Snapshot) -> bool {
        !matches!(snapshot, Snapshot::Unreadable)
    }

    fn set_text(&mut self, text: &str) -> Result<(), String> {
        self.set_items(text_items(text))
    }

    fn owns(&self) -> bool {
        self.inner.lock().serving.is_some()
    }

    fn changes(&self) -> u64 {
        self.inner.lock().changes
    }

    fn read_text(&mut self, deadline: Instant) -> Option<String> {
        let (offer, mimes) = self.current()?;
        let mime = TEXT_TYPES
            .iter()
            .find(|mime| mimes.iter().any(|offered| offered == *mime))?;
        match self.receive(&offer, mime, deadline, ITEM_CAP) {
            Ok(Some(data)) => Some(String::from_utf8_lossy(&data).into_owned()),
            Ok(None) => None,
            Err(error) => {
                log!("Clipboard", "cannot read the copied text: {error}");
                None
            }
        }
    }

    fn restore(&mut self, snapshot: Snapshot) -> Result<(), String> {
        match snapshot {
            Snapshot::Empty => {
                if let Some((source, _)) = self.inner.lock().serving.take() {
                    source.destroy();
                }
                self.device.set_selection(None);
                self.conn.flush().map_err(|error| error.to_string())
            }
            Snapshot::Items(items) => self.set_items(items),
            Snapshot::Unreadable => Ok(()),
        }
    }
}

/// Writes `data` to a reader's pipe, giving up when the reader stalls.
fn serve(fd: OwnedFd, data: Vec<u8>) {
    if let Err(error) = rustix::fs::fcntl_setfl(&fd, rustix::fs::OFlags::NONBLOCK) {
        log!("Clipboard", "cannot serve a read: {error}");
        return;
    }
    let mut out = std::fs::File::from(fd);
    let deadline = Instant::now() + SERVE_LIMIT;
    let mut written = 0;
    while written < data.len() {
        match out.write(&data[written..]) {
            Ok(count) => written += count,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                let left = deadline.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    log!("Clipboard", "a reader stalled; stopped serving it");
                    return;
                }
                let timeout = Timespec {
                    tv_sec: left.as_secs() as _,
                    tv_nsec: left.subsec_nanos().into(),
                };
                let mut fds = [PollFd::new(&out, PollFlags::OUT)];
                let _ = poll(&mut fds, Some(&timeout));
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            // The reader went away.
            Err(_) => return,
        }
    }
}

impl Dispatch<WlRegistry, GlobalListContents> for State {
    fn event(
        _: &mut Self,
        _: &WlRegistry,
        _: wayland_client::protocol::wl_registry::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<WlSeat, ()> for State {
    fn event(
        _: &mut Self,
        _: &WlSeat,
        _: wayland_client::protocol::wl_seat::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<ExtDataControlManagerV1, ()> for State {
    fn event(
        _: &mut Self,
        _: &ExtDataControlManagerV1,
        _: wayland_protocols::ext::data_control::v1::client::ext_data_control_manager_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<ExtDataControlDeviceV1, ()> for State {
    fn event(
        state: &mut Self,
        _: &ExtDataControlDeviceV1,
        event: ext_data_control_device_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        let mut shared = state.inner.lock();
        match event {
            ext_data_control_device_v1::Event::DataOffer { id } => {
                shared.pending.insert(id.id(), Vec::new());
            }
            ext_data_control_device_v1::Event::Selection { id } => {
                let next = id.map(|offer| {
                    let mimes = shared.pending.remove(&offer.id()).unwrap_or_default();
                    (offer, mimes)
                });
                if let Some((previous, _)) = std::mem::replace(&mut shared.current, next) {
                    previous.destroy();
                }
                shared.changes += 1;
                state.inner.changed.notify_all();
            }
            // The primary selection is not used.
            ext_data_control_device_v1::Event::PrimarySelection { id: Some(offer) } => {
                shared.pending.remove(&offer.id());
                offer.destroy();
            }
            ext_data_control_device_v1::Event::Finished => {
                log!(
                    "Clipboard",
                    "the compositor ended data-control for this seat"
                );
                if let Some((previous, _)) = shared.current.take() {
                    previous.destroy();
                }
            }
            _ => {}
        }
    }

    event_created_child!(State, ExtDataControlDeviceV1, [
        ext_data_control_device_v1::EVT_DATA_OFFER_OPCODE => (ExtDataControlOfferV1, ()),
    ]);
}

impl Dispatch<ExtDataControlOfferV1, ()> for State {
    fn event(
        state: &mut Self,
        offer: &ExtDataControlOfferV1,
        event: ext_data_control_offer_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let ext_data_control_offer_v1::Event::Offer { mime_type } = event {
            let mut shared = state.inner.lock();
            if let Some(mimes) = shared.pending.get_mut(&offer.id()) {
                mimes.push(mime_type);
            } else if let Some((current, mimes)) = &mut shared.current {
                if current.id() == offer.id() {
                    mimes.push(mime_type);
                }
            }
        }
    }
}

impl Dispatch<ExtDataControlSourceV1, ()> for State {
    fn event(
        state: &mut Self,
        source: &ExtDataControlSourceV1,
        event: ext_data_control_source_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            ext_data_control_source_v1::Event::Send { mime_type, fd } => {
                let data = {
                    let shared = state.inner.lock();
                    shared
                        .serving
                        .as_ref()
                        .filter(|(serving, _)| serving.id() == source.id())
                        .and_then(|(_, items)| {
                            items
                                .iter()
                                .find(|(mime, _)| *mime == mime_type)
                                .map(|(_, data)| data.clone())
                        })
                };
                // A slow reader must not hold up the event thread.
                if let Some(data) = data {
                    std::thread::spawn(move || serve(fd, data));
                }
            }
            ext_data_control_source_v1::Event::Cancelled => {
                let mut shared = state.inner.lock();
                if shared
                    .serving
                    .as_ref()
                    .is_some_and(|(serving, _)| serving.id() == source.id())
                {
                    shared.serving = None;
                }
                source.destroy();
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshots_read_text_first_then_the_rest_as_offered() {
        let offered = ["image/png", "text/plain", "text/html", "UTF8_STRING"]
            .map(str::to_owned)
            .to_vec();
        assert_eq!(
            snapshot_order(&offered),
            ["UTF8_STRING", "text/plain", "image/png", "text/html"]
        );
    }

    #[test]
    fn text_is_offered_under_every_text_type() {
        let items = text_items("café ✓");
        let utf8 = "café ✓".as_bytes();
        for (mime, data) in items.iter() {
            let expected: &[u8] = if mime == "STRING" { b"caf\xe9 ?" } else { utf8 };
            assert_eq!(data, expected, "{mime}");
        }
        assert_eq!(items.len(), TEXT_TYPES.len());
    }
}
