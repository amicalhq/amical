//! The X11 backend against a real X server: run with
//! `xvfb-run -a cargo test --features it-x11 --test x11`.
//!
//! A second X client plays the app: it has a focused window that logs its
//! key events and pastes on Ctrl+V, it owns and reads CLIPBOARD, and it
//! types through XTest. XTest keys come from the XTEST device, the same
//! device as the helper's own chords, so the helper treats them as
//! injected: the key tests enable setAllowInjectedKeys.
//!
//! The tests share one X server, so they run one at a time.

#![cfg(feature = "it-x11")]

mod support;

use std::collections::HashMap;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::sleep;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use support::{assert_valid, Helper};
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{
    Atom, AtomEnum, ChangeWindowAttributesAux, ConnectionExt as _, CreateWindowAux, EventMask,
    InputFocus, KeyButMask, PropMode, Property, SelectionNotifyEvent, Window, WindowClass,
    KEY_PRESS_EVENT, KEY_RELEASE_EVENT, SELECTION_NOTIFY_EVENT,
};
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;
use x11rb::wrapper::ConnectionExt as _;
use x11rb::{COPY_DEPTH_FROM_PARENT, CURRENT_TIME, NONE};

// X keycodes of the Xvfb keymap (evdev code + 8).
const LCTRL: u8 = 37;
const RCTRL: u8 = 105;
const LALT: u8 = 64;
const LSHIFT: u8 = 50;
const SPACE: u8 = 65;
const ENTER: u8 = 36;
const KP_ENTER: u8 = 104;
const KEY_A: u8 = 38;
const KEY_V: u8 = 55;
const KEY_C: u8 = 54;
const INSERT: u8 = 118;

/// The app serves values larger than this with INCR.
const APP_INCR_CHUNK: usize = 64 * 1024;
const WAIT: Duration = Duration::from_secs(3);
/// How long to wait before saying that a key did not arrive.
const QUIET: Duration = Duration::from_millis(250);

static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

x11rb::atom_manager! {
    Atoms: AtomsCookie {
        CLIPBOARD,
        TARGETS,
        INCR,
        UTF8_STRING,
        _NET_ACTIVE_WINDOW,
        TEXT_HTML: b"text/html",
        BIG: b"application/x-amical-test-big",
        APP_PASTE,
        APP_READ,
    }
}

/// One selection target the app serves: (target, type, format, data).
type Item = (Atom, Atom, u8, Vec<u8>);

#[derive(Default)]
struct AppState {
    /// Key events on the app window: (X keycode, pressed).
    keys: Vec<(u8, bool)>,
    /// What the app serves while it owns CLIPBOARD.
    served: Vec<Item>,
    /// Taken as the new clipboard on Ctrl+Insert or Ctrl+Shift+C.
    on_copy: Option<Vec<Item>>,
    /// Taken as the new clipboard right after a paste (a newer copy).
    after_paste: Option<Vec<Item>>,
    /// The app owns CLIPBOARD but never answers a request.
    stall: bool,
    /// Texts the app read from CLIPBOARD on Ctrl+V.
    pasted: Vec<String>,
    /// The paste read in progress, when the text comes with INCR.
    paste_incr: Option<Vec<u8>>,
    /// INCR transfers the app serves: (requestor, property) → (data, offset).
    transfers: HashMap<(Window, Atom), (Item, usize)>,
}

struct App {
    conn: Arc<RustConnection>,
    root: Window,
    window: Window,
    reader: Window,
    atoms: Atoms,
    state: Arc<Mutex<AppState>>,
    reads: Receiver<Event>,
}

impl App {
    fn start() -> Self {
        let (conn, screen) = RustConnection::connect(None)
            .expect("no X server: run the it-x11 tests under xvfb-run (DISPLAY and XAUTHORITY)");
        let conn = Arc::new(conn);
        let root = conn.setup().roots[screen].root;
        let atoms = Atoms::new(conn.as_ref()).unwrap().reply().unwrap();
        let window = conn.generate_id().unwrap();
        conn.create_window(
            COPY_DEPTH_FROM_PARENT,
            window,
            root,
            0,
            0,
            200,
            100,
            0,
            WindowClass::INPUT_OUTPUT,
            x11rb::COPY_FROM_PARENT,
            &CreateWindowAux::new().event_mask(
                EventMask::KEY_PRESS | EventMask::KEY_RELEASE | EventMask::PROPERTY_CHANGE,
            ),
        )
        .unwrap();
        let reader = conn.generate_id().unwrap();
        conn.create_window(
            COPY_DEPTH_FROM_PARENT,
            reader,
            root,
            0,
            0,
            1,
            1,
            0,
            WindowClass::INPUT_ONLY,
            x11rb::COPY_FROM_PARENT,
            &CreateWindowAux::new().event_mask(EventMask::PROPERTY_CHANGE),
        )
        .unwrap();
        conn.map_window(window).unwrap();
        conn.sync().unwrap();
        conn.set_input_focus(InputFocus::POINTER_ROOT, window, CURRENT_TIME)
            .unwrap();
        conn.sync().unwrap();

        let state = Arc::new(Mutex::new(AppState::default()));
        let (sender, reads) = channel();
        let thread = AppThread {
            conn: conn.clone(),
            window,
            reader,
            atoms,
            state: state.clone(),
            reads: sender,
        };
        std::thread::spawn(move || thread.run());
        Self {
            conn,
            root,
            window,
            reader,
            atoms,
            state,
            reads,
        }
    }

    fn state(&self) -> MutexGuard<'_, AppState> {
        self.state.lock().unwrap()
    }

    fn key(&self, keycode: u8, down: bool) {
        let kind = if down {
            KEY_PRESS_EVENT
        } else {
            KEY_RELEASE_EVENT
        };
        self.conn
            .xtest_fake_input(kind, keycode, CURRENT_TIME, NONE, 0, 0, 0)
            .unwrap();
        self.conn.sync().unwrap();
        sleep(Duration::from_millis(10));
    }

    /// Presses the keys in order and releases them in reverse.
    fn chord(&self, keycodes: &[u8]) {
        for &keycode in keycodes {
            self.key(keycode, true);
        }
        for &keycode in keycodes.iter().rev() {
            self.key(keycode, false);
        }
    }

    /// The key events that reached the window since the last call.
    fn take_keys(&self) -> Vec<(u8, bool)> {
        sleep(QUIET);
        std::mem::take(&mut self.state().keys)
    }

    fn own_clipboard(&self, items: Vec<Item>) {
        self.state().served = items;
        self.conn
            .set_selection_owner(self.window, self.atoms.CLIPBOARD, CURRENT_TIME)
            .unwrap();
        self.conn.sync().unwrap();
    }

    fn clipboard_owner(&self) -> Window {
        self.conn
            .get_selection_owner(self.atoms.CLIPBOARD)
            .unwrap()
            .reply()
            .unwrap()
            .owner
    }

    fn next_read_event(&self, deadline: Instant) -> Event {
        let left = deadline.saturating_duration_since(Instant::now());
        self.reads
            .recv_timeout(left)
            .expect("no selection answer in time")
    }

    /// Reads CLIPBOARD as `target`, with INCR. None when refused.
    fn read(&self, target: Atom) -> Option<(Atom, Vec<u8>)> {
        let deadline = Instant::now() + WAIT;
        while self.reads.try_recv().is_ok() {}
        let property = self.atoms.APP_READ;
        self.conn
            .convert_selection(
                self.reader,
                self.atoms.CLIPBOARD,
                target,
                property,
                CURRENT_TIME,
            )
            .unwrap();
        self.conn.flush().unwrap();
        loop {
            if let Event::SelectionNotify(notify) = self.next_read_event(deadline) {
                if notify.target != target {
                    continue;
                }
                if notify.property == NONE {
                    return None;
                }
                break;
            }
        }
        let reply = get_property(&self.conn, self.reader, property);
        if reply.type_ != self.atoms.INCR {
            return Some((reply.type_, reply.value));
        }
        let mut data = Vec::new();
        let mut type_ = NONE;
        loop {
            match self.next_read_event(deadline) {
                Event::PropertyNotify(notify)
                    if notify.atom == property && notify.state == Property::NEW_VALUE => {}
                _ => continue,
            }
            let chunk = get_property(&self.conn, self.reader, property);
            if chunk.value.is_empty() {
                return Some((type_, data));
            }
            type_ = chunk.type_;
            data.extend_from_slice(&chunk.value);
        }
    }

    fn read_text(&self) -> Option<String> {
        self.read(self.atoms.UTF8_STRING)
            .map(|(_, data)| String::from_utf8(data).unwrap())
    }

    fn targets(&self) -> Vec<Atom> {
        let (_, data) = self.read(self.atoms.TARGETS).expect("no TARGETS");
        data.as_chunks::<4>()
            .0
            .iter()
            .map(|word| u32::from_ne_bytes(*word))
            .collect()
    }

    /// What a window manager does when the focus moves.
    fn set_active_window(&self, window: Window) {
        self.conn
            .change_property32(
                PropMode::REPLACE,
                self.root,
                self.atoms._NET_ACTIVE_WINDOW,
                AtomEnum::WINDOW,
                &[window],
            )
            .unwrap();
        self.conn.sync().unwrap();
    }

    fn set_wm_class(&self, class: &[u8]) {
        self.conn
            .change_property8(
                PropMode::REPLACE,
                self.window,
                AtomEnum::WM_CLASS,
                AtomEnum::STRING,
                class,
            )
            .unwrap();
        self.conn.sync().unwrap();
    }

    fn text_item(&self, text: &str) -> Item {
        (
            self.atoms.UTF8_STRING,
            self.atoms.UTF8_STRING,
            8,
            text.as_bytes().to_vec(),
        )
    }
}

impl Drop for App {
    /// Destroying the windows also ends the app's clipboard ownership. The
    /// next test has no window manager either.
    fn drop(&mut self) {
        let _ = self
            .conn
            .delete_property(self.root, self.atoms._NET_ACTIVE_WINDOW);
        let _ = self.conn.destroy_window(self.window);
        let _ = self.conn.destroy_window(self.reader);
        let _ = self.conn.sync();
    }
}

fn get_property(
    conn: &RustConnection,
    window: Window,
    property: Atom,
) -> x11rb::protocol::xproto::GetPropertyReply {
    conn.get_property(true, window, property, AtomEnum::ANY, 0, u32::MAX / 4)
        .unwrap()
        .reply()
        .unwrap()
}

/// The app's event loop: logs keys, pastes on Ctrl+V, copies on the copy
/// chords, serves its clipboard and passes read answers to the test.
struct AppThread {
    conn: Arc<RustConnection>,
    window: Window,
    reader: Window,
    atoms: Atoms,
    state: Arc<Mutex<AppState>>,
    reads: Sender<Event>,
}

impl AppThread {
    fn run(self) {
        while let Ok(event) = self.conn.wait_for_event() {
            self.handle(event);
            let _ = self.conn.flush();
        }
    }

    fn handle(&self, event: Event) {
        let mut state = self.state.lock().unwrap();
        match event {
            Event::KeyPress(press) if press.event == self.window => {
                state.keys.push((press.detail, true));
                let ctrl = press.state.contains(KeyButMask::CONTROL);
                let shift = press.state.contains(KeyButMask::SHIFT);
                if ctrl && press.detail == KEY_V {
                    let _ = self.conn.convert_selection(
                        self.window,
                        self.atoms.CLIPBOARD,
                        self.atoms.UTF8_STRING,
                        self.atoms.APP_PASTE,
                        press.time,
                    );
                }
                let copy =
                    (ctrl && press.detail == INSERT) || (ctrl && shift && press.detail == KEY_C);
                if copy {
                    if let Some(items) = state.on_copy.take() {
                        state.served = items;
                        let _ = self.conn.set_selection_owner(
                            self.window,
                            self.atoms.CLIPBOARD,
                            press.time,
                        );
                    }
                }
            }
            Event::KeyRelease(release) if release.event == self.window => {
                state.keys.push((release.detail, false));
            }
            Event::SelectionNotify(notify) if notify.requestor == self.window => {
                if notify.property == NONE {
                    state.pasted.push("<refused>".to_owned());
                    return;
                }
                let reply = get_property(&self.conn, self.window, self.atoms.APP_PASTE);
                if reply.type_ == self.atoms.INCR {
                    state.paste_incr = Some(Vec::new());
                } else {
                    let text = String::from_utf8_lossy(&reply.value).into_owned();
                    self.pasted(&mut state, text);
                }
            }
            Event::PropertyNotify(notify)
                if notify.window == self.window
                    && notify.atom == self.atoms.APP_PASTE
                    && notify.state == Property::NEW_VALUE
                    && state.paste_incr.is_some() =>
            {
                let chunk = get_property(&self.conn, self.window, self.atoms.APP_PASTE);
                if chunk.value.is_empty() {
                    let data = state.paste_incr.take().unwrap();
                    self.pasted(&mut state, String::from_utf8_lossy(&data).into_owned());
                } else {
                    state.paste_incr.as_mut().unwrap().extend(chunk.value);
                }
            }
            Event::SelectionNotify(_) | Event::PropertyNotify(_)
                if matches!(&event, Event::SelectionNotify(n) if n.requestor == self.reader)
                    || matches!(&event, Event::PropertyNotify(n) if n.window == self.reader) =>
            {
                let _ = self.reads.send(event);
            }
            Event::PropertyNotify(notify) if notify.state == Property::DELETE => {
                let key = (notify.window, notify.atom);
                if let Some((item, offset)) = state.transfers.remove(&key) {
                    let end = (offset + APP_INCR_CHUNK).min(item.3.len());
                    let _ = self.conn.change_property(
                        PropMode::REPLACE,
                        key.0,
                        key.1,
                        item.1,
                        item.2,
                        (end - offset) as u32,
                        &item.3[offset..end],
                    );
                    if end > offset {
                        state.transfers.insert(key, (item, end));
                    }
                }
            }
            Event::SelectionRequest(_) if state.stall => {}
            Event::SelectionRequest(request) => {
                let property = request.property;
                let mut answered = true;
                if request.target == self.atoms.TARGETS {
                    let mut targets = vec![self.atoms.TARGETS];
                    targets.extend(state.served.iter().map(|item| item.0));
                    let _ = self.conn.change_property32(
                        PropMode::REPLACE,
                        request.requestor,
                        property,
                        AtomEnum::ATOM,
                        &targets,
                    );
                } else if let Some(item) = state
                    .served
                    .iter()
                    .find(|item| item.0 == request.target)
                    .cloned()
                {
                    if item.3.len() > APP_INCR_CHUNK {
                        let _ = self.conn.change_window_attributes(
                            request.requestor,
                            &ChangeWindowAttributesAux::new()
                                .event_mask(EventMask::PROPERTY_CHANGE),
                        );
                        let _ = self.conn.change_property32(
                            PropMode::REPLACE,
                            request.requestor,
                            property,
                            self.atoms.INCR,
                            &[item.3.len() as u32],
                        );
                        state
                            .transfers
                            .insert((request.requestor, property), (item, 0));
                    } else {
                        let _ = self.conn.change_property(
                            PropMode::REPLACE,
                            request.requestor,
                            property,
                            item.1,
                            item.2,
                            item.3.len() as u32 / u32::from(item.2 / 8),
                            &item.3,
                        );
                    }
                } else {
                    answered = false;
                }
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
            }
            _ => {}
        }
    }

    fn pasted(&self, state: &mut AppState, text: String) {
        state.pasted.push(text);
        if let Some(items) = state.after_paste.take() {
            state.served = items;
            let _ = self
                .conn
                .set_selection_owner(self.window, self.atoms.CLIPBOARD, CURRENT_TIME);
        }
    }
}

fn helper() -> Helper {
    let display = std::env::var("DISPLAY").expect("DISPLAY is not set: run under xvfb-run");
    let mut env = vec![("DISPLAY", display), ("XDG_SESSION_TYPE", "x11".to_owned())];
    if let Ok(xauthority) = std::env::var("XAUTHORITY") {
        env.push(("XAUTHORITY", xauthority));
    }
    let env: Vec<(&str, &str)> = env.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let mut helper = Helper::spawn(None, &env);
    // The first call waits for the X connection and the key thread.
    let capabilities = helper.call("getHelperCapabilities", json!({}));
    assert_eq!(
        capabilities["result"]["keyInputMode"], "per-key",
        "{capabilities}"
    );
    helper
}

fn result(helper: &mut Helper, method: &str, params: Value) -> Value {
    let answer = helper.call(method, params);
    assert!(answer.get("error").is_none(), "{method}: {answer}");
    answer["result"].clone()
}

/// The key events on stdout within QUIET, as (evdev code, pressed).
fn key_events(helper: &mut Helper) -> Vec<(i64, bool)> {
    let mut events = Vec::new();
    while let Some(line) = helper.next_line_within(QUIET) {
        let event: Value = serde_json::from_str(&line).unwrap();
        let down = match event["type"].as_str() {
            Some("keyDown") => true,
            Some("keyUp") => false,
            _ => continue,
        };
        let file = if down { "key-down" } else { "key-up" };
        assert_valid(&format!("events/{file}-event.schema.json"), &event);
        events.push((event["payload"]["keyCode"].as_i64().unwrap(), down));
    }
    events
}

fn evdev(keycodes: &[(u8, bool)]) -> Vec<(i64, bool)> {
    keycodes
        .iter()
        .map(|&(keycode, down)| (i64::from(keycode) - 8, down))
        .collect()
}

#[test]
fn capabilities_on_an_x11_session() {
    let _serial = serial();
    let mut helper = helper();
    let mut capabilities = result(&mut helper, "getHelperCapabilities", json!({}));
    assert_valid(
        "methods/get-helper-capabilities-result.schema.json",
        &capabilities,
    );
    capabilities.as_object_mut().unwrap().remove("message");
    capabilities
        .as_object_mut()
        .unwrap()
        .remove("helperVersion");
    assert_eq!(
        capabilities,
        json!({
            "keyInputMode": "per-key",
            "keyInputBackend": "xi2",
            "holdSupport": "any",
            "chord": null,
            "evdev": { "available": false, "reason": "not-built" },
            "chordConsume": "helper",
            "injectionAvailable": true,
            "injectionBackend": "xtest",
            "injectionConsent": "none",
            "clipboardBackend": "x11",
            "clipboardStealsFocus": false,
            "accessibilityContextAvailable": false,
            "ambianceAvailable": false,
            "sessionType": "x11",
            "desktop": null,
        })
    );
    assert_eq!(
        result(&mut helper, "prepareInjection", json!({})),
        json!({ "ready": true })
    );
}

#[test]
fn both_key_edges_stream_with_evdev_codes() {
    let _serial = serial();
    let app = App::start();
    let mut helper = helper();

    // XTest keys from other clients stream only when allowed.
    app.chord(&[KEY_A]);
    assert_eq!(key_events(&mut helper), []);

    result(
        &mut helper,
        "setAllowInjectedKeys",
        json!({ "enabled": true }),
    );
    app.chord(&[LCTRL, KEY_A]);
    assert_eq!(
        key_events(&mut helper),
        [(29, true), (30, true), (30, false), (29, false)]
    );
}

#[test]
fn a_chord_key_is_consumed_only_when_the_chord_is_exactly_held() {
    let _serial = serial();
    let app = App::start();
    let mut helper = helper();
    result(
        &mut helper,
        "setAllowInjectedKeys",
        json!({ "enabled": true }),
    );
    result(
        &mut helper,
        "setShortcuts",
        json!({ "subsetChords": [[29, 56, 57]], "exactChords": [] }),
    );

    app.chord(&[LCTRL, LALT, SPACE]);
    // Space never reaches the app; the helper still reports both edges.
    assert_eq!(
        app.take_keys(),
        [(LCTRL, true), (LALT, true), (LALT, false), (LCTRL, false)]
    );
    assert_eq!(
        key_events(&mut helper),
        evdev(&[
            (LCTRL, true),
            (LALT, true),
            (SPACE, true),
            (SPACE, false),
            (LALT, false),
            (LCTRL, false)
        ])
    );

    // Not exactly held: the other Ctrl, a partial chord, an extra modifier.
    for keys in [
        &[RCTRL, LALT, SPACE][..],
        &[LCTRL, SPACE],
        &[LCTRL, LALT, LSHIFT, SPACE],
    ] {
        app.chord(keys);
        let reached: Vec<u8> = app
            .take_keys()
            .into_iter()
            .filter(|&(_, down)| down)
            .map(|(keycode, _)| keycode)
            .collect();
        assert_eq!(reached, keys, "{keys:?}");
        key_events(&mut helper);
    }

    // Injected keys that are not allowed never complete a chord.
    result(
        &mut helper,
        "setAllowInjectedKeys",
        json!({ "enabled": false }),
    );
    app.chord(&[LCTRL, LALT, SPACE]);
    assert!(app.take_keys().contains(&(SPACE, true)));
    assert_eq!(key_events(&mut helper), []);

    // An empty shortcut list removes the grab.
    result(
        &mut helper,
        "setAllowInjectedKeys",
        json!({ "enabled": true }),
    );
    result(
        &mut helper,
        "setShortcuts",
        json!({ "subsetChords": [], "exactChords": [] }),
    );
    app.chord(&[LCTRL, LALT, SPACE]);
    assert!(app.take_keys().contains(&(SPACE, true)));
}

#[test]
fn a_refused_grab_is_tried_again_by_the_next_set_shortcuts() {
    let _serial = serial();
    let app = App::start();
    let chords = json!({ "subsetChords": [[29, 56, 57]], "exactChords": [] });
    let mut holder = helper();
    result(&mut holder, "setShortcuts", chords.clone());

    // Another client holds the keys: this grab is refused.
    let mut helper = helper();
    result(
        &mut helper,
        "setAllowInjectedKeys",
        json!({ "enabled": true }),
    );
    result(&mut helper, "setShortcuts", chords.clone());
    drop(holder);
    sleep(Duration::from_millis(100));

    // The same shortcuts again: now the grab is free.
    result(&mut helper, "setShortcuts", chords);
    app.chord(&[LCTRL, LALT, SPACE]);
    assert_eq!(
        app.take_keys(),
        [(LCTRL, true), (LALT, true), (LALT, false), (LCTRL, false)]
    );
}

#[test]
fn the_draft_enter_mask_swallows_one_press() {
    let _serial = serial();
    let app = App::start();
    let mut helper = helper();
    result(
        &mut helper,
        "setAllowInjectedKeys",
        json!({ "enabled": true }),
    );

    result(
        &mut helper,
        "setDraftEnterCapture",
        json!({ "enabled": true }),
    );
    app.chord(&[ENTER]);
    assert_eq!(app.take_keys(), []);
    assert_eq!(key_events(&mut helper), [(28, true), (28, false)]);
    // The mask disarmed itself on the key-up.
    app.chord(&[ENTER]);
    assert_eq!(app.take_keys(), [(ENTER, true), (ENTER, false)]);
    key_events(&mut helper);

    // Keypad Enter, with a modifier held.
    result(
        &mut helper,
        "setDraftEnterCapture",
        json!({ "enabled": true }),
    );
    app.chord(&[LSHIFT, KP_ENTER]);
    assert_eq!(app.take_keys(), [(LSHIFT, true), (LSHIFT, false)]);
    key_events(&mut helper);

    // A disarm during the press does not let the key-up through.
    result(
        &mut helper,
        "setDraftEnterCapture",
        json!({ "enabled": true }),
    );
    app.key(ENTER, true);
    result(
        &mut helper,
        "setDraftEnterCapture",
        json!({ "enabled": false }),
    );
    app.key(ENTER, false);
    assert_eq!(app.take_keys(), []);
    app.chord(&[ENTER]);
    assert_eq!(app.take_keys(), [(ENTER, true), (ENTER, false)]);
}

#[test]
fn recheck_reads_the_server_key_state() {
    let _serial = serial();
    let app = App::start();
    let mut helper = helper();
    app.key(LCTRL, true);
    assert_eq!(
        result(
            &mut helper,
            "recheckPressedKeys",
            json!({ "pressedKeyCodes": [29, 30, 300] })
        ),
        json!({ "staleKeyCodes": [30] })
    );
    app.key(LCTRL, false);
    assert_eq!(
        result(
            &mut helper,
            "recheckPressedKeys",
            json!({ "pressedKeyCodes": [29] })
        ),
        json!({ "staleKeyCodes": [29] })
    );
}

#[test]
fn paste_sends_the_chord_and_restores_every_target() {
    let _serial = serial();
    let app = App::start();
    let mut helper = helper();
    result(
        &mut helper,
        "setAllowInjectedKeys",
        json!({ "enabled": true }),
    );
    let big: Vec<u8> = (0..300_000u32).map(|n| (n % 251) as u8).collect();
    let old = vec![
        app.text_item("old clipboard"),
        (
            app.atoms.TEXT_HTML,
            app.atoms.TEXT_HTML,
            8,
            b"<b>old</b>".to_vec(),
        ),
        (app.atoms.BIG, app.atoms.BIG, 8, big.clone()),
    ];
    app.own_clipboard(old);

    let paste = result(
        &mut helper,
        "pasteText",
        json!({ "transcript": "pasted ✓ text", "preserveClipboard": true }),
    );
    assert_valid("methods/paste-text-result.schema.json", &paste);
    assert_eq!(paste, json!({ "success": true, "clipboardSet": true }));
    assert_eq!(app.state().pasted, ["pasted ✓ text"]);
    assert_eq!(
        app.take_keys(),
        [(LCTRL, true), (KEY_V, true), (KEY_V, false), (LCTRL, false)]
    );
    // The helper's own chord is not reported as keys.
    assert_eq!(key_events(&mut helper), []);

    // The helper now serves a copy of every old target (BIG through INCR,
    // both ways).
    assert_ne!(app.clipboard_owner(), app.window);
    let targets = app.targets();
    for target in [app.atoms.UTF8_STRING, app.atoms.TEXT_HTML, app.atoms.BIG] {
        assert!(targets.contains(&target), "{targets:?}");
    }
    assert_eq!(app.read_text().as_deref(), Some("old clipboard"));
    assert_eq!(
        app.read(app.atoms.TEXT_HTML),
        Some((app.atoms.TEXT_HTML, b"<b>old</b>".to_vec()))
    );
    assert_eq!(app.read(app.atoms.BIG), Some((app.atoms.BIG, big)));
}

#[test]
fn a_large_transcript_goes_out_with_incr_and_an_empty_clipboard_comes_back() {
    let _serial = serial();
    let app = App::start();
    let mut helper = helper();
    assert_eq!(app.clipboard_owner(), NONE);
    let transcript = "große Wörter ".repeat(30_000);
    let paste = result(
        &mut helper,
        "pasteText",
        json!({ "transcript": transcript, "preserveClipboard": true }),
    );
    assert_eq!(paste, json!({ "success": true, "clipboardSet": true }));
    assert_eq!(app.state().pasted, [transcript]);
    assert_eq!(app.clipboard_owner(), NONE);
}

#[test]
fn the_restore_never_replaces_a_newer_clipboard() {
    let _serial = serial();
    let app = App::start();
    let mut helper = helper();
    app.own_clipboard(vec![app.text_item("old")]);
    app.state().after_paste = Some(vec![app.text_item("newer copy")]);
    let paste = result(
        &mut helper,
        "pasteText",
        json!({ "transcript": "transcript", "preserveClipboard": true }),
    );
    assert_eq!(paste["success"], true);
    assert!(
        paste["message"].as_str().unwrap().contains("changed"),
        "{paste}"
    );
    assert_eq!(app.state().pasted, ["transcript"]);
    assert_eq!(app.clipboard_owner(), app.window);
    assert_eq!(app.read_text().as_deref(), Some("newer copy"));
}

#[test]
fn without_preserve_the_transcript_stays_on_the_clipboard() {
    let _serial = serial();
    let app = App::start();
    let mut helper = helper();
    app.own_clipboard(vec![app.text_item("old")]);
    let paste = result(
        &mut helper,
        "pasteText",
        json!({ "transcript": "keep me", "preserveClipboard": false }),
    );
    assert_eq!(paste, json!({ "success": true, "clipboardSet": true }));
    assert_eq!(app.read_text().as_deref(), Some("keep me"));
}

#[test]
fn a_terminal_gets_the_terminal_paste_chord() {
    let _serial = serial();
    let app = App::start();
    app.set_wm_class(b"kitty\0kitty\0");
    let mut helper = helper();
    result(
        &mut helper,
        "pasteText",
        json!({ "transcript": "ls", "preserveClipboard": false }),
    );
    assert_eq!(
        app.take_keys(),
        [
            (LCTRL, true),
            (LSHIFT, true),
            (KEY_V, true),
            (KEY_V, false),
            (LSHIFT, false),
            (LCTRL, false)
        ]
    );
}

#[test]
fn a_terminal_without_clipboard_keys_gets_no_chord() {
    let _serial = serial();
    let app = App::start();
    app.set_wm_class(b"xterm\0XTerm\0");
    app.own_clipboard(vec![app.text_item("old")]);
    let mut helper = helper();

    // Ctrl+Shift+V and Ctrl+Shift+C reach the program in xterm, the
    // second as an interrupt. The desktop gets the transcript back.
    let paste = result(
        &mut helper,
        "pasteText",
        json!({ "transcript": "ls", "preserveClipboard": true }),
    );
    assert_eq!(paste["success"], false);
    assert_eq!(paste["clipboardSet"], false);
    let copy = result(&mut helper, "getSelectedTextViaCopy", json!({}));
    assert_eq!(copy["selectedText"], Value::Null);
    assert_eq!(copy["clipboardChanged"], false);
    assert_eq!(app.take_keys(), []);
    assert_eq!(app.read_text().as_deref(), Some("old"));
}

#[test]
fn copy_capture_reads_the_selection_and_restores_the_clipboard() {
    let _serial = serial();
    let app = App::start();
    let mut helper = helper();
    app.own_clipboard(vec![app.text_item("old")]);

    // The app ignores the chord: nothing changed.
    let copy = result(&mut helper, "getSelectedTextViaCopy", json!({}));
    assert_valid(
        "methods/get-selected-text-via-copy-result.schema.json",
        &copy,
    );
    assert_eq!(copy["selectedText"], Value::Null);
    assert_eq!(copy["clipboardChanged"], false);
    assert_eq!(
        app.take_keys(),
        [
            (LCTRL, true),
            (INSERT, true),
            (INSERT, false),
            (LCTRL, false)
        ]
    );

    app.state().on_copy = Some(vec![app.text_item("selected words")]);
    let copy = result(&mut helper, "getSelectedTextViaCopy", json!({}));
    assert_eq!(
        copy,
        json!({ "selectedText": "selected words", "clipboardChanged": true })
    );
    assert_eq!(app.read_text().as_deref(), Some("old"));
}

#[test]
fn the_paste_waits_for_held_modifiers_and_a_consumed_key() {
    let _serial = serial();
    let app = App::start();
    let mut helper = helper();
    result(
        &mut helper,
        "setAllowInjectedKeys",
        json!({ "enabled": true }),
    );
    let paste = json!({ "transcript": "first", "preserveClipboard": false });
    let chord = [(LCTRL, true), (KEY_V, true), (KEY_V, false), (LCTRL, false)];

    // A held Shift would turn Ctrl+V into Ctrl+Shift+V.
    app.key(LSHIFT, true);
    let id = helper.send_request("pasteText", paste);
    sleep(Duration::from_millis(300));
    app.key(LSHIFT, false);
    assert_eq!(helper.answer(&id)["result"]["success"], true);
    let mut expected = vec![(LSHIFT, true), (LSHIFT, false)];
    expected.extend(chord);
    assert_eq!(app.take_keys(), expected);

    // A consumed Enter (Draft Insert) holds a grab that would take the chord.
    result(
        &mut helper,
        "setDraftEnterCapture",
        json!({ "enabled": true }),
    );
    app.key(ENTER, true);
    let paste = json!({ "transcript": "second", "preserveClipboard": false });
    let id = helper.send_request("pasteText", paste);
    sleep(Duration::from_millis(300));
    app.key(ENTER, false);
    assert_eq!(helper.answer(&id)["result"]["success"], true);
    assert_eq!(app.take_keys(), chord);
    assert_eq!(app.state().pasted, ["first", "second"]);
}

#[test]
fn a_stalled_clipboard_owner_does_not_block_the_paste() {
    let _serial = serial();
    let app = App::start();
    let mut helper = helper();
    app.own_clipboard(vec![app.text_item("old")]);
    app.state().stall = true;
    let start = Instant::now();
    let paste = result(
        &mut helper,
        "pasteText",
        json!({ "transcript": "transcript", "preserveClipboard": true }),
    );
    assert!(
        start.elapsed() < Duration::from_secs(2),
        "{:?}",
        start.elapsed()
    );
    assert_eq!(paste["success"], true);
    assert_eq!(paste["clipboardSet"], true);
    assert!(
        paste["message"]
            .as_str()
            .unwrap()
            .contains("could not be read"),
        "{paste}"
    );
    assert_eq!(app.state().pasted, ["transcript"]);
    // Nothing to restore: the transcript stays.
    assert_eq!(app.read_text().as_deref(), Some("transcript"));
}

#[test]
fn a_new_active_window_sends_active_display_changed() {
    let _serial = serial();
    let app = App::start();
    let mut helper = helper();
    let changes = |helper: &mut Helper| {
        let mut count = 0;
        while let Some(line) = helper.next_line_within(QUIET) {
            let event: Value = serde_json::from_str(&line).unwrap();
            if event["type"] == "activeDisplayChanged" {
                assert_valid("events/active-display-changed-event.schema.json", &event);
                count += 1;
            }
        }
        count
    };
    app.set_active_window(app.window);
    assert_eq!(changes(&mut helper), 1);
    // The same window again is no focus change.
    app.set_active_window(app.window);
    assert_eq!(changes(&mut helper), 0);
    app.set_active_window(app.reader);
    assert_eq!(changes(&mut helper), 1);
}
