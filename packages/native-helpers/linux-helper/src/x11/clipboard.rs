//! The CLIPBOARD selection (G2 §6, x11 column).
//!
//! [`Owner`] owns CLIPBOARD on its own connection and serves it from its
//! event thread, so that a slow requestor never blocks a transaction. It
//! also counts owner changes (XFixes), which the copy capture polls.
//!
//! [`Reader`] reads the selection as a requestor on the transaction
//! connection: the snapshot before a paste and the text after a copy. Every
//! wait has a deadline.
//!
//! Clipboard bytes are never logged; only counts and sizes.

use std::os::fd::AsFd;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::Notify;
use x11rb::connection::Connection;
use x11rb::errors::{ConnectionError, ReplyError, ReplyOrIdError};
use x11rb::protocol::xfixes::{ConnectionExt as _, SelectionEventMask};
use x11rb::protocol::xproto::{
    Atom, AtomEnum, ChangeWindowAttributesAux, ConnectionExt as _, CreateWindowAux, EventMask,
    PropMode, Property, SelectionNotifyEvent, SelectionRequestEvent, Timestamp, Window,
    WindowClass, SELECTION_NOTIFY_EVENT,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;
use x11rb::wrapper::ConnectionExt as _;
use x11rb::{COPY_DEPTH_FROM_PARENT, CURRENT_TIME, NONE};

use super::{connection_lost, lock, Atoms, Error};
use crate::log::log;

/// Largest value read for one target of a snapshot or a copy.
const ITEM_CAP: usize = 8 * 1024 * 1024;
/// Largest snapshot in total.
const SNAPSHOT_CAP: usize = 32 * 1024 * 1024;
/// Values larger than this go out with INCR, in chunks of this size.
const INCR_CHUNK: usize = 256 * 1024;
/// An INCR transfer with no progress for this long is dropped.
const INCR_STALL: Duration = Duration::from_secs(5);

/// One target of a selection, with the type and format that its owner gave.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    pub target: Atom,
    pub type_: Atom,
    pub format: u8,
    pub data: Vec<u8>,
}

/// The clipboard before a paste or a copy.
#[derive(Debug)]
pub enum Snapshot {
    /// No owner: restoring clears the clipboard.
    Empty,
    Items(Arc<Vec<Item>>),
    /// The owner did not answer, or gave nothing that could be kept. There
    /// is nothing to restore.
    Unreadable,
}

/// The targets of a text: UTF8_STRING, text/plain;charset=utf-8, TEXT and
/// STRING (Latin-1, with '?' for characters outside it).
pub fn text_items(text: &str, atoms: &Atoms) -> Arc<Vec<Item>> {
    let utf8 = |target| Item {
        target,
        type_: atoms.UTF8_STRING,
        format: 8,
        data: text.as_bytes().to_vec(),
    };
    let latin1 = text
        .chars()
        .map(|c| u8::try_from(u32::from(c)).unwrap_or(b'?'))
        .collect();
    Arc::new(vec![
        utf8(atoms.UTF8_STRING),
        utf8(atoms.TEXT_PLAIN_UTF8),
        utf8(atoms.TEXT),
        Item {
            target: AtomEnum::STRING.into(),
            type_: AtomEnum::STRING.into(),
            format: 8,
            data: latin1,
        },
    ])
}

fn create_window(conn: &RustConnection, root: Window) -> Result<Window, ReplyOrIdError> {
    let window = conn.generate_id()?;
    conn.create_window(
        COPY_DEPTH_FROM_PARENT,
        window,
        root,
        -10,
        -10,
        1,
        1,
        0,
        WindowClass::INPUT_ONLY,
        x11rb::COPY_FROM_PARENT,
        &CreateWindowAux::new().event_mask(EventMask::PROPERTY_CHANGE),
    )?
    .check()?;
    Ok(window)
}

struct OwnerState {
    /// What this helper serves while it owns CLIPBOARD.
    items: Option<Arc<Vec<Item>>>,
    /// Selection requests answered, for the settle wait.
    requests: u64,
    /// The server time of our latest ownership, for the TIMESTAMP target.
    owned_since: Timestamp,
}

pub struct Owner {
    conn: RustConnection,
    pub window: Window,
    atoms: Atoms,
    state: Mutex<OwnerState>,
    request_served: Condvar,
    /// Owner changes of CLIPBOARD (any client) since the start.
    changes: AtomicU64,
    lost: Arc<Notify>,
}

/// An INCR transfer in progress: one item to one requestor property.
struct Transfer {
    requestor: Window,
    property: Atom,
    items: Arc<Vec<Item>>,
    index: usize,
    offset: usize,
    last_progress: Instant,
}

impl Owner {
    pub fn start(
        conn: RustConnection,
        root: Window,
        atoms: Atoms,
        lost: Arc<Notify>,
    ) -> Result<Arc<Self>, Error> {
        conn.xfixes_query_version(5, 0)?.reply()?;
        let window = create_window(&conn, root)?;
        conn.xfixes_select_selection_input(
            window,
            atoms.CLIPBOARD,
            SelectionEventMask::SET_SELECTION_OWNER
                | SelectionEventMask::SELECTION_WINDOW_DESTROY
                | SelectionEventMask::SELECTION_CLIENT_CLOSE,
        )?
        .check()?;
        let owner = Arc::new(Self {
            conn,
            window,
            atoms,
            state: Mutex::new(OwnerState {
                items: None,
                requests: 0,
                owned_since: CURRENT_TIME,
            }),
            request_served: Condvar::new(),
            changes: AtomicU64::new(0),
            lost,
        });
        let thread_owner = owner.clone();
        std::thread::Builder::new()
            .name("x11-clipboard".to_owned())
            .spawn(move || thread_owner.run())?;
        Ok(owner)
    }

    /// Owner changes of CLIPBOARD seen so far.
    pub fn changes(&self) -> u64 {
        self.changes.load(Ordering::SeqCst)
    }

    pub fn requests(&self) -> u64 {
        lock(&self.state).requests
    }

    /// What we serve now, if we own CLIPBOARD.
    pub fn served_items(&self) -> Option<Arc<Vec<Item>>> {
        lock(&self.state).items.clone()
    }

    /// Takes CLIPBOARD with `items`. Fails when the server did not make us
    /// the owner.
    pub fn set(&self, items: Arc<Vec<Item>>) -> Result<(), Error> {
        lock(&self.state).items = Some(items);
        self.conn
            .set_selection_owner(self.window, self.atoms.CLIPBOARD, CURRENT_TIME)?;
        // The reply also means that the server has processed the set.
        if self.owner()? == self.window {
            Ok(())
        } else {
            Err("the server did not make the helper the clipboard owner".into())
        }
    }

    /// True while we own CLIPBOARD. Only the transaction sets it, one at a
    /// time, so what we own is still the content of its latest set.
    pub fn owns(&self) -> bool {
        self.owner().is_ok_and(|owner| owner == self.window)
    }

    fn owner(&self) -> Result<Window, ReplyError> {
        Ok(self
            .conn
            .get_selection_owner(self.atoms.CLIPBOARD)?
            .reply()?
            .owner)
    }

    /// Puts a snapshot back: its items, or no owner for an empty clipboard.
    pub fn restore(&self, snapshot: Snapshot) -> Result<(), Error> {
        match snapshot {
            Snapshot::Items(items) => self.set(items),
            Snapshot::Empty => {
                lock(&self.state).items = None;
                self.conn
                    .set_selection_owner(NONE, self.atoms.CLIPBOARD, CURRENT_TIME)?;
                self.conn.flush()?;
                Ok(())
            }
            Snapshot::Unreadable => Ok(()),
        }
    }

    /// Waits until a selection request after `since` has been answered (the
    /// first requestor after a set is a clipboard manager or the bridge
    /// asking for TARGETS). Returns false at the timeout.
    pub fn wait_for_request(&self, since: u64, timeout: Duration) -> bool {
        let state = lock(&self.state);
        let (state, _) = self
            .request_served
            .wait_timeout_while(state, timeout, |state| state.requests <= since)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.requests > since
    }

    fn run(self: Arc<Self>) {
        let mut transfers: Vec<Transfer> = Vec::new();
        loop {
            let event = match self.conn.wait_for_event() {
                Ok(event) => event,
                Err(error) => return connection_lost("clipboard", &error, &self.lost),
            };
            // Stalled transfers end at the next event; they only hold a
            // reference to content that we keep anyway.
            transfers.retain(|transfer| transfer.last_progress.elapsed() < INCR_STALL);
            match event {
                Event::SelectionRequest(request) => self.serve(&request, &mut transfers),
                Event::PropertyNotify(notify) if notify.state == Property::DELETE => {
                    if let Some(index) = transfers.iter().position(|transfer| {
                        transfer.requestor == notify.window && transfer.property == notify.atom
                    }) {
                        if !self.send_chunk(&mut transfers[index]) {
                            let done = transfers.swap_remove(index);
                            if !transfers.iter().any(|t| t.requestor == done.requestor) {
                                self.watch_requestor(done.requestor, false);
                            }
                        }
                    }
                }
                Event::XfixesSelectionNotify(notify)
                    if notify.selection == self.atoms.CLIPBOARD =>
                {
                    self.changes.fetch_add(1, Ordering::SeqCst);
                    if notify.owner == self.window {
                        lock(&self.state).owned_since = notify.selection_timestamp;
                    }
                }
                Event::Error(error) => {
                    // For example a requestor window that went away.
                    log!("Clipboard", "X error {:?}", error.error_kind);
                }
                _ => {}
            }
            let _ = self.conn.flush();
        }
    }

    fn serve(&self, request: &SelectionRequestEvent, transfers: &mut Vec<Transfer>) {
        let (items, owned_since) = {
            let state = lock(&self.state);
            (state.items.clone(), state.owned_since)
        };
        // Obsolete requestors send no property; ICCCM says use the target.
        let property = if request.property == NONE {
            request.target
        } else {
            request.property
        };
        let items = items
            .filter(|_| request.owner == self.window && request.selection == self.atoms.CLIPBOARD);
        let answered = match items {
            None => false,
            Some(items) => self.answer(request, property, items, owned_since, transfers),
        };
        let notify = SelectionNotifyEvent {
            response_type: SELECTION_NOTIFY_EVENT,
            sequence: 0,
            time: request.time,
            requestor: request.requestor,
            selection: request.selection,
            target: request.target,
            property: if answered { property } else { NONE },
        };
        let _ = self
            .conn
            .send_event(false, request.requestor, EventMask::NO_EVENT, notify);
        let mut state = lock(&self.state);
        state.requests += 1;
        self.request_served.notify_all();
    }

    fn answer(
        &self,
        request: &SelectionRequestEvent,
        property: Atom,
        items: Arc<Vec<Item>>,
        owned_since: Timestamp,
        transfers: &mut Vec<Transfer>,
    ) -> bool {
        let conn = &self.conn;
        let requestor = request.requestor;
        if request.target == self.atoms.TARGETS {
            let mut targets = vec![self.atoms.TARGETS, self.atoms.TIMESTAMP];
            targets.extend(items.iter().map(|item| item.target));
            conn.change_property32(
                PropMode::REPLACE,
                requestor,
                property,
                AtomEnum::ATOM,
                &targets,
            )
            .is_ok()
        } else if request.target == self.atoms.TIMESTAMP {
            conn.change_property32(
                PropMode::REPLACE,
                requestor,
                property,
                AtomEnum::INTEGER,
                &[owned_since],
            )
            .is_ok()
        } else if let Some(index) = items.iter().position(|item| item.target == request.target) {
            let item = &items[index];
            if item.data.len() > INCR_CHUNK {
                self.watch_requestor(requestor, true);
                transfers.push(Transfer {
                    requestor,
                    property,
                    items: items.clone(),
                    index,
                    offset: 0,
                    last_progress: Instant::now(),
                });
                let size = u32::try_from(item.data.len()).unwrap_or(u32::MAX);
                conn.change_property32(
                    PropMode::REPLACE,
                    requestor,
                    property,
                    self.atoms.INCR,
                    &[size],
                )
                .is_ok()
            } else {
                change_property(conn, requestor, property, item, &item.data).is_ok()
            }
        } else {
            false
        }
    }

    /// Sends the next INCR chunk, or the empty chunk that ends the transfer.
    /// Returns false when the transfer is over.
    fn send_chunk(&self, transfer: &mut Transfer) -> bool {
        let item = &transfer.items[transfer.index];
        let unit = usize::from(item.format / 8).max(1);
        let end = (transfer.offset + INCR_CHUNK / unit * unit).min(item.data.len());
        let chunk = &item.data[transfer.offset..end];
        let finished = chunk.is_empty();
        let _ = change_property(
            &self.conn,
            transfer.requestor,
            transfer.property,
            item,
            chunk,
        );
        transfer.offset = end;
        transfer.last_progress = Instant::now();
        !finished
    }

    fn watch_requestor(&self, requestor: Window, watch: bool) {
        let mask = if watch {
            EventMask::PROPERTY_CHANGE
        } else {
            EventMask::NO_EVENT
        };
        let _ = self.conn.change_window_attributes(
            requestor,
            &ChangeWindowAttributesAux::new().event_mask(mask),
        );
    }
}

fn change_property(
    conn: &RustConnection,
    window: Window,
    property: Atom,
    item: &Item,
    data: &[u8],
) -> Result<(), ConnectionError> {
    let unit = usize::from(item.format / 8).max(1);
    let length = u32::try_from(data.len() / unit).unwrap_or(u32::MAX);
    conn.change_property(
        PropMode::REPLACE,
        window,
        property,
        item.type_,
        item.format,
        length,
        data,
    )
    .map(|_| ())
}

#[derive(Debug)]
pub enum ReadError {
    Timeout,
    TooLarge,
    Connection(String),
}

impl From<ConnectionError> for ReadError {
    fn from(error: ConnectionError) -> Self {
        Self::Connection(error.to_string())
    }
}

impl From<ReplyError> for ReadError {
    fn from(error: ReplyError) -> Self {
        Self::Connection(error.to_string())
    }
}

impl From<ReplyOrIdError> for ReadError {
    fn from(error: ReplyOrIdError) -> Self {
        Self::Connection(error.to_string())
    }
}

/// Reads selections as a requestor. Used by one transaction at a time.
pub struct Reader {
    pub conn: Arc<RustConnection>,
    pub root: Window,
    pub atoms: Atoms,
    window: Window,
    /// A transfer was abandoned: an owner may still write into our
    /// property, so the next read uses a new window.
    abandoned: bool,
}

impl Reader {
    pub fn new(
        conn: Arc<RustConnection>,
        root: Window,
        atoms: Atoms,
    ) -> Result<Self, ReplyOrIdError> {
        let window = create_window(&conn, root)?;
        Ok(Self {
            conn,
            root,
            atoms,
            window,
            abandoned: false,
        })
    }

    pub fn owner(&self) -> Result<Window, ReplyError> {
        Ok(self
            .conn
            .get_selection_owner(self.atoms.CLIPBOARD)?
            .reply()?
            .owner)
    }

    /// The next event before `deadline`, or None at the deadline.
    fn next_event(&self, deadline: Instant) -> Result<Option<Event>, ReadError> {
        loop {
            if let Some(event) = self.conn.poll_for_event()? {
                return Ok(Some(event));
            }
            let now = Instant::now();
            if now >= deadline {
                return Ok(None);
            }
            self.conn.flush()?;
            let left = deadline - now;
            let timeout = rustix::event::Timespec {
                tv_sec: left.as_secs() as _,
                tv_nsec: left.subsec_nanos().into(),
            };
            let fd = self.conn.stream().as_fd();
            let mut fds = [rustix::event::PollFd::new(
                &fd,
                rustix::event::PollFlags::IN,
            )];
            match rustix::event::poll(&mut fds, Some(&timeout)) {
                Ok(_) | Err(rustix::io::Errno::INTR) => {}
                Err(error) => return Err(ReadError::Connection(error.to_string())),
            }
        }
    }

    fn renew_window(&mut self) -> Result<(), ReadError> {
        if !self.abandoned {
            return Ok(());
        }
        let _ = self.conn.destroy_window(self.window);
        self.window = create_window(&self.conn, self.root)?;
        self.abandoned = false;
        Ok(())
    }

    /// Converts CLIPBOARD to `target`. Ok(None) when the owner refuses.
    pub fn convert(
        &mut self,
        target: Atom,
        deadline: Instant,
        cap: usize,
    ) -> Result<Option<Item>, ReadError> {
        self.renew_window()?;
        let result = self.convert_on_window(target, deadline, cap);
        if matches!(result, Err(ReadError::Timeout | ReadError::TooLarge)) {
            self.abandoned = true;
        }
        result
    }

    fn convert_on_window(
        &mut self,
        target: Atom,
        deadline: Instant,
        cap: usize,
    ) -> Result<Option<Item>, ReadError> {
        let (conn, window, property) = (&self.conn, self.window, self.atoms._AMICAL_SELECTION);
        while conn.poll_for_event()?.is_some() {}
        conn.delete_property(window, property)?;
        conn.convert_selection(window, self.atoms.CLIPBOARD, target, property, CURRENT_TIME)?;
        let answer = loop {
            match self.next_event(deadline)? {
                None => return Err(ReadError::Timeout),
                Some(Event::SelectionNotify(notify))
                    if notify.requestor == window && notify.target == target =>
                {
                    break notify.property;
                }
                Some(_) => {}
            }
        };
        if answer == NONE {
            return Ok(None);
        }
        let words = u32::try_from(cap / 4 + 1).unwrap_or(u32::MAX);
        let reply = conn
            .get_property(true, window, property, AtomEnum::ANY, 0, words)?
            .reply()?;
        if reply.type_ == self.atoms.INCR {
            // The INCR value is a lower bound of the size.
            let size = reply.value32().and_then(|mut values| values.next());
            let size = size.map_or(0, |size| size as usize);
            if size > cap {
                return Err(ReadError::TooLarge);
            }
            return self.read_incr(target, size, deadline, cap).map(Some);
        }
        if reply.bytes_after > 0 || reply.value.len() > cap {
            conn.delete_property(window, property)?;
            return Err(ReadError::TooLarge);
        }
        if reply.type_ == NONE {
            return Ok(None);
        }
        Ok(Some(Item {
            target,
            type_: reply.type_,
            format: reply.format,
            data: reply.value,
        }))
    }

    /// ICCCM INCR: each deletion of our property asks for the next chunk;
    /// an empty chunk ends the transfer.
    fn read_incr(
        &mut self,
        target: Atom,
        size: usize,
        deadline: Instant,
        cap: usize,
    ) -> Result<Item, ReadError> {
        let (window, property) = (self.window, self.atoms._AMICAL_SELECTION);
        let mut item = Item {
            target,
            type_: NONE,
            format: 8,
            data: Vec::with_capacity(size),
        };
        loop {
            match self.next_event(deadline)? {
                None => return Err(ReadError::Timeout),
                Some(Event::PropertyNotify(notify))
                    if notify.window == window
                        && notify.atom == property
                        && notify.state == Property::NEW_VALUE => {}
                Some(_) => continue,
            }
            let words = u32::try_from((cap - item.data.len()) / 4 + 1).unwrap_or(u32::MAX);
            let chunk = self
                .conn
                .get_property(true, window, property, AtomEnum::ANY, 0, words)?
                .reply()?;
            if chunk.bytes_after > 0 || item.data.len() + chunk.value.len() > cap {
                return Err(ReadError::TooLarge);
            }
            if chunk.value.is_empty() {
                return Ok(item);
            }
            item.type_ = chunk.type_;
            item.format = chunk.format;
            item.data.extend_from_slice(&chunk.value);
        }
    }

    /// Reads every target of the current clipboard, within `budget`. Text
    /// targets come first, so that a slow owner still leaves the text.
    pub fn snapshot(&mut self, own: &Owner, budget: Duration) -> Snapshot {
        let start = Instant::now();
        let deadline = start + budget;
        let owner = match self.owner() {
            Ok(owner) => owner,
            Err(_) => return Snapshot::Unreadable,
        };
        if owner == NONE {
            return Snapshot::Empty;
        }
        if owner == own.window {
            return own
                .served_items()
                .map_or(Snapshot::Unreadable, Snapshot::Items);
        }
        let targets_deadline = deadline.min(Instant::now() + Duration::from_millis(150));
        let targets = match self.convert(self.atoms.TARGETS, targets_deadline, 64 * 1024) {
            Ok(Some(item)) if item.format == 32 => item
                .data
                .as_chunks::<4>()
                .0
                .iter()
                .map(|word| u32::from_ne_bytes(*word))
                .collect::<Vec<Atom>>(),
            Ok(_) => return Snapshot::Unreadable,
            Err(error) => {
                log!("Clipboard", "snapshot: no TARGETS answer ({error:?})");
                return Snapshot::Unreadable;
            }
        };
        let targets = self.atoms.snapshot_order(targets);
        let (offered, mut items, mut total) = (targets.len(), Vec::new(), 0);
        for target in targets {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            let per_target = deadline.min(now + Duration::from_millis(200));
            let cap = ITEM_CAP.min(SNAPSHOT_CAP - total);
            match self.convert(target, per_target, cap) {
                Ok(Some(item)) => {
                    total += item.data.len();
                    items.push(item);
                }
                Ok(None) | Err(ReadError::Timeout | ReadError::TooLarge) => {}
                Err(ReadError::Connection(error)) => {
                    log!("Clipboard", "snapshot stopped: {error}");
                    return Snapshot::Unreadable;
                }
            }
        }
        log!(
            "Clipboard",
            "snapshot: {} of {offered} targets, {total} bytes, {} ms",
            items.len(),
            start.elapsed().as_millis()
        );
        if items.is_empty() {
            Snapshot::Unreadable
        } else {
            Snapshot::Items(Arc::new(items))
        }
    }

    /// The clipboard as text: UTF-8 targets first, then Latin-1 STRING.
    pub fn read_text(&mut self, deadline: Instant) -> Option<String> {
        for target in [self.atoms.UTF8_STRING, self.atoms.TEXT_PLAIN_UTF8] {
            if let Ok(Some(item)) = self.convert(target, deadline, ITEM_CAP) {
                if item.format == 8 && item.type_ != Atom::from(AtomEnum::STRING) {
                    return Some(String::from_utf8_lossy(&item.data).into_owned());
                }
            }
        }
        match self.convert(AtomEnum::STRING.into(), deadline, ITEM_CAP) {
            Ok(Some(item)) if item.format == 8 => {
                Some(item.data.iter().map(|&byte| char::from(byte)).collect())
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_targets_carry_utf8_and_a_latin1_string() {
        let atoms = Atoms::for_tests();
        let items = text_items("café €", &atoms);
        let by_target = |target: Atom| items.iter().find(|item| item.target == target).unwrap();
        assert_eq!(by_target(atoms.UTF8_STRING).data, "café €".as_bytes());
        assert_eq!(by_target(atoms.TEXT).type_, atoms.UTF8_STRING);
        assert_eq!(by_target(atoms.TEXT_PLAIN_UTF8).data, "café €".as_bytes());
        let string = by_target(AtomEnum::STRING.into());
        assert_eq!(string.data, b"caf\xe9 ?");
    }
}
