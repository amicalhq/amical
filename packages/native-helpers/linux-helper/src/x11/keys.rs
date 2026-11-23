//! Key input on X11 (G2 §4a): XInput 2 raw key events on the root window,
//! passive key grabs that consume shortcut keys and Enter for Draft, the
//! server key state for recheckPressedKeys, and the active-window trigger.
//!
//! The grabs are XInput 2 passive grabs in async mode: when one fires, the
//! server keeps the key from the focused app and never waits for this
//! helper. (A sync grab would freeze the whole keyboard while the helper is
//! stopped or stalled; X11 has no timeout for that.) The server matches the
//! chord's modifier mask, not the keys: the chord with the other Ctrl, Alt,
//! Shift or Super, or with an extra regular key held, is consumed too,
//! although the desktop does not act on it. A chord with two regular keys
//! is not grabbed: one of them alone would be consumed.
//!
//! The grab mask includes the raw key events: while a client holds a grab,
//! the server sends that client raw events only through the grab, so a core
//! grab would hide every key release until the grab ends. The grabs are
//! placed on each master keyboard and move when the masters change.
//!
//! Key codes are never logged.

use std::collections::{BTreeMap, BTreeSet, HashSet, VecDeque};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use tokio::sync::Notify;
use x11rb::connection::Connection;
use x11rb::errors::ReplyError;
use x11rb::protocol::xinput::{
    self, ConnectionExt as _, DeviceType, GrabMode22, GrabOwner, GrabType, ModifierMask,
    XIEventMask,
};
use x11rb::protocol::xproto::{
    ChangeWindowAttributesAux, ConnectionExt as _, EventMask, GrabMode, Mapping, Window,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;
use x11rb::{CURRENT_TIME, NONE};

use super::gate::{self, Gate, KeyEvent, Source, ENTER_CODES};
use super::keymap::Keymap;
use super::{active_window, connection_lost, lock, Atoms, Error};
use crate::log::{iso8601_now, log};
use crate::models::*;
use crate::writer::WeakOut;

/// XIAllMasterDevices: one raw event per key, from the master keyboard,
/// with the physical device in `sourceid`.
const ALL_MASTER_DEVICES: u16 = 1;
const ALL_DEVICES: u16 = 0;
/// How long an injected key waits for its echo before it counts as lost.
const ECHO_WINDOW: Duration = Duration::from_secs(1);

/// The X keycode of an evdev code (evdev + 8), if it has one.
fn x_keycode(code: u16) -> Option<u8> {
    u8::try_from(code.checked_add(8)?).ok()
}

/// The evdev code of an X keycode.
fn evdev_code(keycode: u32) -> Option<u16> {
    u16::try_from(keycode.checked_sub(8)?).ok()
}

/// The helper's own XTest key events, in the order they were sent. Raw
/// events from the XTest device that match them are the helper's echo;
/// the others come from other clients.
#[derive(Default)]
pub struct EchoQueue {
    expected: VecDeque<(u8, bool, Instant)>,
}

impl EchoQueue {
    pub fn expect(&mut self, keys: &[(u8, bool)]) {
        let deadline = Instant::now() + ECHO_WINDOW;
        self.expected.extend(
            keys.iter()
                .map(|&(keycode, down)| (keycode, down, deadline)),
        );
    }

    fn take(&mut self, keycode: u8, down: bool) -> bool {
        let now = Instant::now();
        self.expected.retain(|&(_, _, deadline)| deadline > now);
        match self
            .expected
            .iter()
            .position(|&(k, d, _)| k == keycode && d == down)
        {
            Some(index) => {
                self.expected.drain(..=index);
                true
            }
            None => false,
        }
    }
}

/// A passive grab: X keycode and modifier mask (XI2 modifier bits).
type GrabKey = (u8, u32);

#[derive(Default)]
struct Grabs {
    /// The master keyboards that carry `keys`.
    devices: Vec<u16>,
    /// The grabs in place. A key that the server refused is left out, so
    /// that the next setShortcuts tries it again.
    keys: Vec<GrabKey>,
    /// Shortcut ids per chord, for logs about chords that cannot be grabbed.
    chord_ids: Vec<String>,
}

pub struct KeyInput {
    conn: RustConnection,
    root: Window,
    atoms: Atoms,
    keymap: RwLock<Keymap>,
    gate: Mutex<Gate>,
    /// The passive grabs in place. Its lock also serializes grab changes.
    grabs: Mutex<Grabs>,
    echo: Mutex<EchoQueue>,
    xtest_devices: Mutex<HashSet<u16>>,
    /// The master keyboard of the latest active grab.
    grab_device: AtomicU16,
    events: WeakOut,
    lost: Arc<Notify>,
}

impl KeyInput {
    /// Selects raw key events and the root property changes, and starts the
    /// key thread. Fails when the server has no XInput 2.1 or later.
    pub fn start(
        conn: RustConnection,
        root: Window,
        atoms: Atoms,
        events: WeakOut,
        lost: Arc<Notify>,
    ) -> Result<Arc<Self>, Error> {
        let version = conn.xinput_xi_query_version(2, 2)?.reply()?;
        if (version.major_version, version.minor_version) < (2, 1) {
            // XI 2.0 sends no raw events while another client grabs the
            // keyboard (a menu, the desktop's own shortcuts).
            return Err(format!(
                "XInput {}.{} is older than 2.1",
                version.major_version, version.minor_version
            )
            .into());
        }
        let keymap = RwLock::new(Keymap::fetch(&conn)?);
        let masks = [
            xinput::EventMask {
                deviceid: ALL_MASTER_DEVICES,
                mask: vec![XIEventMask::RAW_KEY_PRESS | XIEventMask::RAW_KEY_RELEASE],
            },
            xinput::EventMask {
                deviceid: ALL_DEVICES,
                mask: vec![XIEventMask::HIERARCHY],
            },
        ];
        conn.xinput_xi_select_events(root, &masks)?.check()?;
        // _NET_ACTIVE_WINDOW changes for activeDisplayChanged.
        conn.change_window_attributes(
            root,
            &ChangeWindowAttributesAux::new().event_mask(EventMask::PROPERTY_CHANGE),
        )?
        .check()?;

        let keys = Arc::new(Self {
            conn,
            root,
            atoms,
            keymap,
            gate: Mutex::new(Gate::default()),
            grabs: Mutex::new(Grabs::default()),
            echo: Mutex::new(EchoQueue::default()),
            xtest_devices: Mutex::new(HashSet::new()),
            grab_device: AtomicU16::new(0),
            events,
            lost,
        });
        keys.refresh_devices();
        let thread_keys = keys.clone();
        std::thread::Builder::new()
            .name("x11-keys".to_owned())
            .spawn(move || thread_keys.run())?;
        Ok(keys)
    }

    /// Replaces the chords and the grabs for them. `ids` names each chord in
    /// logs (a shortcut id, or its index).
    pub fn set_shortcuts(&self, chords: Vec<BTreeSet<u16>>, ids: Vec<String>) {
        let mut grabs = lock(&self.grabs);
        lock(&self.gate).set_chords(chords);
        grabs.chord_ids = ids;
        self.regrab(&mut grabs);
    }

    pub fn set_draft_enter_capture(&self, enabled: bool) {
        let mut grabs = lock(&self.grabs);
        lock(&self.gate).set_draft_armed(enabled);
        self.regrab(&mut grabs);
    }

    pub fn set_allow_injected_keys(&self, enabled: bool) {
        lock(&self.gate).set_allow_injected(enabled);
    }

    pub fn consumed_key_held(&self) -> bool {
        lock(&self.gate).consumed_key_held()
    }

    /// Registers the helper's own XTest key events before they are sent.
    pub fn expect_echo(&self, keys: &[(u8, bool)]) {
        lock(&self.echo).expect(keys);
    }

    pub fn keymap(&self) -> Keymap {
        self.keymap
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// The server's key state: a 256-bit map indexed by X keycode.
    pub fn key_state(&self) -> Result<[u8; 32], ReplyError> {
        Ok(self.conn.query_keymap()?.reply()?.keys)
    }

    /// The codes in `codes` that the server says are up. A code with no X
    /// key never counts as stale.
    pub fn stale_keys(&self, codes: &[i64]) -> Result<Vec<i64>, ReplyError> {
        let state = self.key_state()?;
        Ok(codes
            .iter()
            .copied()
            .filter(|&code| {
                u16::try_from(code)
                    .ok()
                    .and_then(x_keycode)
                    .is_some_and(|keycode| !is_down(&state, keycode))
            })
            .collect())
    }

    /// Ends an active grab that this helper holds, so that injected keys
    /// reach the focused app.
    pub fn release_keyboard(&self) {
        let device = self.grab_device.load(Ordering::Relaxed);
        let _ = self.conn.xinput_xi_ungrab_device(CURRENT_TIME, device);
        let _ = self.conn.flush();
    }

    /// Removes every grab (shutdown).
    pub fn ungrab_all(&self) {
        let mut grabs = lock(&self.grabs);
        for (keycode, masks) in by_keycode(&grabs.keys) {
            for &device in &grabs.devices {
                self.ungrab(device, keycode, &masks);
            }
        }
        let _ = self.conn.flush();
        grabs.keys.clear();
    }

    fn ungrab(&self, device: u16, keycode: u8, masks: &[u32]) {
        let _ = self.conn.xinput_xi_passive_ungrab_device(
            self.root,
            u32::from(keycode),
            device,
            GrabType::KEYCODE,
            masks,
        );
    }

    /// The grabs that the chords and the Draft-Enter mask need, and who
    /// needs each grabbed key (for logs). A chord with one regular key
    /// grabs it with the chord's modifier mask. Modifier-only chords and
    /// chords with two or more regular keys are never consumed.
    fn wanted_grabs(&self, ids: &[String]) -> (Vec<GrabKey>, BTreeMap<u8, BTreeSet<String>>) {
        let keymap = self.keymap();
        let gate = lock(&self.gate);
        let mut grabs = Vec::new();
        let mut owners: BTreeMap<u8, BTreeSet<String>> = BTreeMap::new();
        for (index, chord) in gate.chords().iter().enumerate() {
            let name = ids
                .get(index)
                .cloned()
                .unwrap_or_else(|| format!("chord {index}"));
            let (modifiers, keys): (Vec<u16>, Vec<u16>) =
                chord.iter().partition(|&&code| gate::is_modifier(code));
            let [key] = keys[..] else {
                continue;
            };
            let Some(keycode) = x_keycode(key) else {
                continue;
            };
            let mask = modifiers
                .into_iter()
                .filter_map(x_keycode)
                .fold(0, |mask, keycode| mask | keymap.mask_of(keycode));
            for variant in keymap.lock_variants(mask) {
                grabs.push((keycode, variant));
            }
            owners.entry(keycode).or_default().insert(name);
        }
        if gate.draft_armed() {
            // Enter is consumed with any modifiers, as on macOS and Windows.
            for keycode in ENTER_CODES.into_iter().filter_map(x_keycode) {
                grabs.push((keycode, u32::from(ModifierMask::ANY)));
                owners
                    .entry(keycode)
                    .or_default()
                    .insert("Draft Enter".to_owned());
            }
        }
        grabs.sort_unstable();
        grabs.dedup();
        (grabs, owners)
    }

    /// Brings the grabs in line with the gate.
    fn regrab(&self, grabs: &mut Grabs) {
        let devices = grabs.devices.clone();
        self.regrab_on(grabs, devices);
    }

    /// Brings the grabs in line with the gate, on the master keyboards
    /// `devices`. A key whose masks changed is ungrabbed and grabbed again
    /// with its new masks; other keys keep their grabs, so a keymap change
    /// that moves nothing changes nothing.
    fn regrab_on(&self, grabs: &mut Grabs, devices: Vec<u16>) {
        let (wanted, owners) = self.wanted_grabs(&grabs.chord_ids);
        let same_devices = devices == grabs.devices;
        let keys_changed = wanted != grabs.keys;
        if same_devices && !keys_changed {
            return;
        }
        let (old, new) = (by_keycode(&grabs.keys), by_keycode(&wanted));
        let keycodes: BTreeSet<u8> = old.keys().chain(new.keys()).copied().collect();
        let events = XIEventMask::KEY_PRESS
            | XIEventMask::KEY_RELEASE
            | XIEventMask::RAW_KEY_PRESS
            | XIEventMask::RAW_KEY_RELEASE;
        let mut cookies = Vec::new();
        for keycode in keycodes {
            if same_devices && old.get(&keycode) == new.get(&keycode) {
                continue;
            }
            if let Some(masks) = old.get(&keycode) {
                for &device in &grabs.devices {
                    self.ungrab(device, keycode, masks);
                }
            }
            let Some(masks) = new.get(&keycode) else {
                continue;
            };
            for &device in &devices {
                let cookie = self.conn.xinput_xi_passive_grab_device(
                    CURRENT_TIME,
                    self.root,
                    NONE,
                    u32::from(keycode),
                    device,
                    GrabType::KEYCODE,
                    GrabMode22::ASYNC,
                    GrabMode::ASYNC,
                    GrabOwner::NO_OWNER,
                    &[u32::from(events)],
                    masks,
                );
                cookies.push((keycode, cookie));
            }
        }
        let mut refused = BTreeSet::new();
        let mut refused_keys = BTreeSet::new();
        for (keycode, cookie) in cookies {
            let result = cookie
                .map_err(ReplyError::from)
                .and_then(|cookie| cookie.reply());
            let failed = match result {
                // The reply lists the masks that another client holds.
                Ok(reply) if reply.modifiers.is_empty() => continue,
                Ok(_) => "another client grabs the same keys".to_owned(),
                Err(error) => error.to_string(),
            };
            refused_keys.insert(keycode);
            for who in owners.get(&keycode).into_iter().flatten() {
                refused.insert(format!("{who}: {failed}"));
            }
        }
        // Drop what the server did grant for a refused key, so that no
        // grab is left behind that `keys` does not list.
        for keycode in &refused_keys {
            if let Some(masks) = new.get(keycode) {
                for &device in &devices {
                    self.ungrab(device, *keycode, masks);
                }
            }
        }
        let _ = self.conn.flush();
        for message in &refused {
            log!("Keys", "cannot consume {message}");
        }
        if keys_changed {
            let (chords, draft) = {
                let gate = lock(&self.gate);
                (gate.chords().len(), gate.draft_armed())
            };
            log!(
                "Keys",
                "{} grabs for {chords} chords{}",
                wanted.len(),
                if draft { " and Draft Enter" } else { "" }
            );
        }
        grabs.devices = devices;
        grabs.keys = wanted
            .into_iter()
            .filter(|(keycode, _)| !refused_keys.contains(keycode))
            .collect();
    }

    /// Reads the XTest keyboards (to tell injected keys) and the master
    /// keyboards (which carry the grabs). Grabs move when the masters
    /// change.
    fn refresh_devices(&self) {
        let devices = self
            .conn
            .xinput_xi_query_device(ALL_DEVICES)
            .map_err(ReplyError::from)
            .and_then(|cookie| cookie.reply());
        let infos = match devices {
            Ok(reply) => reply.infos,
            Err(error) => {
                log!("Keys", "cannot list input devices: {error}");
                return;
            }
        };
        let of_type = |type_: DeviceType| infos.iter().filter(move |info| info.type_ == type_);
        *lock(&self.xtest_devices) = of_type(DeviceType::SLAVE_KEYBOARD)
            .filter(|info| info.name.ends_with(b"XTEST keyboard"))
            .map(|info| info.deviceid)
            .collect();
        let masters: Vec<u16> = of_type(DeviceType::MASTER_KEYBOARD)
            .map(|info| info.deviceid)
            .collect();
        let mut grabs = lock(&self.grabs);
        self.regrab_on(&mut grabs, masters);
    }

    fn run(self: Arc<Self>) {
        let mut active_window = NONE;
        loop {
            let event = match self.conn.wait_for_event() {
                Ok(event) => event,
                Err(error) => return connection_lost("keys", &error, &self.lost),
            };
            match event {
                Event::XinputRawKeyPress(raw) => self.on_raw(raw.detail, true, raw.sourceid),
                Event::XinputRawKeyRelease(raw) => self.on_raw(raw.detail, false, raw.sourceid),
                // A grab fired, or a key arrived during an active grab.
                Event::XinputKeyPress(press) => self.on_grabbed_press(press.detail, press.deviceid),
                Event::XinputHierarchy(_) => self.refresh_devices(),
                Event::MappingNotify(notify) if notify.request != Mapping::POINTER => {
                    self.on_mapping_change();
                }
                Event::PropertyNotify(notify)
                    if notify.window == self.root
                        && notify.atom == self.atoms._NET_ACTIVE_WINDOW =>
                {
                    self.on_active_window(&mut active_window);
                }
                Event::Error(error) => log!("Keys", "X error {:?}", error.error_kind),
                _ => {}
            }
        }
    }

    fn on_raw(&self, detail: u32, down: bool, sourceid: u16) {
        let (Ok(keycode), Some(code)) = (u8::try_from(detail), evdev_code(detail)) else {
            return;
        };
        let source = if lock(&self.xtest_devices).contains(&sourceid) {
            if lock(&self.echo).take(keycode, down) {
                Source::Own
            } else {
                Source::Injected
            }
        } else {
            Source::Device
        };
        let outcome = lock(&self.gate).raw(code, down, source);
        if let Some(event) = outcome.event {
            self.send_key_event(event);
        }
        if outcome.draft_disarmed {
            let mut grabs = lock(&self.grabs);
            self.regrab(&mut grabs);
        }
    }

    fn on_grabbed_press(&self, detail: u32, device: u16) {
        let Some(code) = evdev_code(detail) else {
            return;
        };
        if lock(&self.gate).grabbed(code) {
            self.grab_device.store(device, Ordering::Relaxed);
        }
    }

    fn on_mapping_change(&self) {
        match Keymap::fetch(&self.conn) {
            Ok(keymap) => {
                *self
                    .keymap
                    .write()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) = keymap;
                // The modifier bits of the chords may have moved.
                let mut grabs = lock(&self.grabs);
                self.regrab(&mut grabs);
            }
            Err(error) => log!("Keys", "cannot read the new keyboard mapping: {error}"),
        }
    }

    /// `last`: the active window of the previous event.
    fn on_active_window(&self, last: &mut Window) {
        let window = active_window(&self.conn, self.root, &self.atoms).unwrap_or(NONE);
        if window == NONE || window == *last {
            return;
        }
        *last = window;
        self.events.send(&ActiveDisplayChangedEvent {
            timestamp: Some(iso8601_now()),
            active_display_changed_event_schema_type:
                ActiveDisplayChangedEventType::ActiveDisplayChanged,
        });
    }

    fn send_key_event(&self, event: KeyEvent) {
        // The generated keyDown and keyUp payloads are two types with the
        // same fields.
        macro_rules! payload {
            ($payload:ident) => {
                $payload {
                    alt_key: Some(event.alt),
                    code: None,
                    ctrl_key: Some(event.ctrl),
                    fn_key_pressed: Some(false),
                    key: None,
                    key_code: i64::from(event.code),
                    meta_key: Some(event.meta),
                    shift_key: Some(event.shift),
                }
            };
        }
        let timestamp = Some(iso8601_now());
        if event.down {
            self.events.send(&KeyDownEvent {
                payload: payload!(KeyDownEventPayload),
                timestamp,
                key_down_event_schema_type: KeyDownEventType::KeyDown,
            });
        } else {
            self.events.send(&KeyUpEvent {
                payload: payload!(KeyUpEventPayload),
                timestamp,
                key_up_event_schema_type: KeyUpEventType::KeyUp,
            });
        }
    }
}

fn by_keycode(grabs: &[GrabKey]) -> BTreeMap<u8, Vec<u32>> {
    let mut map: BTreeMap<u8, Vec<u32>> = BTreeMap::new();
    for &(keycode, mask) in grabs {
        map.entry(keycode).or_default().push(mask);
    }
    map
}

pub fn is_down(state: &[u8; 32], keycode: u8) -> bool {
    state[usize::from(keycode / 8)] & (1 << (keycode % 8)) != 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn own_injections_are_matched_in_order_and_expire() {
        let mut echo = EchoQueue::default();
        echo.expect(&[(37, true), (55, true), (55, false), (37, false)]);
        assert!(echo.take(37, true));
        // A key from another XTest client between ours.
        assert!(!echo.take(38, true));
        assert!(echo.take(55, true));
        assert!(echo.take(55, false));
        assert!(echo.take(37, false));
        assert!(!echo.take(37, false));

        echo.expected
            .push_back((37, true, Instant::now() - Duration::from_millis(1)));
        assert!(!echo.take(37, true));
    }
}
