//! The helper as a process: the wire protocol against the JSON schemas in
//! packages/types/generated/json-schemas, shutdown, and portal registration.
//! The schemas come from `pnpm --filter @amical/types generate:all`.

mod support;

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use support::{assert_valid, schema, Helper, PrivateBus, TempDir};
use zbus::message::Header;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value as Variant};

const TRANSCRIPT: &str = "transcript canary 7f3a";

fn kebab_case(name: &str) -> String {
    let mut kebab = String::new();
    for c in name.chars() {
        if c.is_ascii_uppercase() {
            kebab.push('-');
        }
        kebab.push(c.to_ascii_lowercase());
    }
    kebab
}

/// Valid params for every method, as the desktop sends them.
fn requests() -> Vec<(&'static str, Value)> {
    vec![
        ("getAccessibilityTreeDetails", json!({})),
        ("getAccessibilityContext", json!({ "editableOnly": false })),
        ("getAccessibilityStatus", json!({})),
        ("requestAccessibilityPermission", json!({})),
        (
            "pasteText",
            json!({ "transcript": TRANSCRIPT, "preserveClipboard": true }),
        ),
        (
            "startRecording",
            json!({ "muteSystemAudio": true, "muteSounds": false }),
        ),
        (
            "stopRecording",
            json!({ "wasMuted": false, "muteSounds": false }),
        ),
        (
            "setShortcuts",
            json!({
                "subsetChords": [[29, 56, 57]],
                "exactChords": [],
                "shortcuts": [{
                    "id": "pushToTalk:0",
                    "keyCodes": [29, 56, 57],
                    "label": "Amical: Push to talk",
                    "kind": "hold"
                }]
            }),
        ),
        ("setDraftEnterCapture", json!({ "enabled": true })),
        ("setAllowInjectedKeys", json!({ "enabled": false })),
        ("recheckPressedKeys", json!({ "pressedKeyCodes": [29, 56] })),
        ("getSelectedTextViaCopy", json!({})),
        ("startEditWatch", json!({})),
        ("readEditWatch", json!({ "watchId": "w1" })),
        ("stopEditWatch", json!({ "watchId": "w1" })),
        (
            "getHelperCapabilities",
            json!({ "appId": "com.example.Test" }),
        ),
        ("setHelperOptions", json!({ "evdevKeyInput": true })),
        ("prepareInjection", json!({})),
    ]
}

#[test]
fn every_method_answers_with_a_schema_valid_result() {
    let requests = requests();
    let protocol_methods: BTreeSet<String> = schema("rpc/rpc-request.schema.json")["properties"]
        ["method"]["anyOf"]
        .as_array()
        .unwrap()
        .iter()
        .map(|literal| literal["const"].as_str().unwrap().to_owned())
        .collect();
    let tested_methods: BTreeSet<String> = requests
        .iter()
        .map(|(method, _)| method.to_string())
        .collect();
    assert_eq!(tested_methods, protocol_methods);

    let mut helper = Helper::spawn(
        None,
        &[
            ("WAYLAND_DISPLAY", "wayland-0"),
            ("XDG_CURRENT_DESKTOP", "ubuntu:GNOME"),
        ],
    );
    // Lines that are not requests get no answer.
    for line in [
        "",
        "   ",
        "not json",
        "[1, 2]",
        r#"{"method":"setShortcuts","params":{}}"#,
        r#"{"id":7,"method":"setShortcuts","params":{}}"#,
    ] {
        helper.send(line);
    }
    for (index, (method, params)) in requests.iter().enumerate() {
        helper.send(
            &json!({ "id": format!("r{index}"), "method": method, "params": params }).to_string(),
        );
    }
    helper.send(r#"{"id":"unknown","method":"noSuchMethod","params":{}}"#);
    // At stdin EOF the helper answers what it has read, then exits.
    helper.close_stdin();
    let lines = helper.read_to_end();
    assert_eq!(helper.wait().code(), Some(0));

    let mut answers = HashMap::new();
    for line in &lines {
        let answer: Value = serde_json::from_str(line)
            .unwrap_or_else(|_| panic!("stdout line is not JSON: {line}"));
        assert_valid("rpc/rpc-response.schema.json", &answer);
        let id = answer["id"].as_str().unwrap().to_owned();
        assert!(answers.insert(id, answer).is_none(), "two answers: {line}");
    }
    assert_eq!(answers.len(), requests.len() + 1);
    assert_eq!(
        answers["unknown"]["error"],
        json!({ "code": -32601, "message": "Method not found" })
    );

    let mut results = HashMap::new();
    for (index, (method, _)) in requests.iter().enumerate() {
        let answer = &answers[&format!("r{index}")];
        assert!(answer.get("error").is_none(), "{method}: {answer}");
        let result = answer["result"].clone();
        assert_valid(
            &format!("methods/{}-result.schema.json", kebab_case(method)),
            &result,
        );
        results.insert(*method, result);
    }

    // A nullable field goes out as null; an optional field is left out.
    assert_eq!(
        results["startEditWatch"],
        json!({ "watchId": null, "startStatus": "no_element" })
    );
    assert_eq!(
        results["readEditWatch"],
        json!({ "readStatus": "unknown_watch", "text": null, "selection": null, "readMs": 0.0 })
    );
    assert_eq!(results["stopEditWatch"], json!({ "stopped": false }));
    assert_eq!(results["pasteText"]["success"], false);
    assert_eq!(results["pasteText"]["clipboardSet"], false);
    assert_eq!(results["startRecording"]["success"], false);
    assert_eq!(results["stopRecording"], json!({ "success": true }));
    assert_eq!(
        results["recheckPressedKeys"],
        json!({ "staleKeyCodes": [] })
    );

    let mut capabilities = results["getHelperCapabilities"].clone();
    assert!(capabilities["message"].is_string());
    capabilities.as_object_mut().unwrap().remove("message");
    assert_eq!(
        capabilities,
        json!({
            "keyInputMode": "none",
            "keyInputBackend": null,
            "holdSupport": "tap-only",
            "chord": null,
            "evdev": { "available": false, "reason": "not-built" },
            "chordConsume": "none",
            "injectionAvailable": false,
            "injectionBackend": null,
            "injectionConsent": "none",
            "clipboardBackend": null,
            "clipboardStealsFocus": false,
            "accessibilityContextAvailable": false,
            "ambianceAvailable": false,
            "sessionType": "wayland",
            "desktop": "ubuntu:GNOME",
            "helperVersion": env!("CARGO_PKG_VERSION"),
        })
    );
    assert_eq!(
        results["setHelperOptions"],
        json!({ "success": true, "capabilities": results["getHelperCapabilities"] })
    );

    // The transcript reaches neither stdout nor the log.
    assert!(!lines.iter().any(|line| line.contains(TRANSCRIPT)));
    assert!(!helper.stderr().contains(TRANSCRIPT));
}

#[test]
fn signals_and_stdin_eof_shut_down_with_exit_code_0() {
    let stops: [(Option<libc::c_int>, &str); 4] = [
        (Some(libc::SIGTERM), "SIGTERM"),
        (Some(libc::SIGINT), "SIGINT"),
        (Some(libc::SIGHUP), "SIGHUP"),
        (None, "stdin closed"),
    ];
    for (signal, reason) in stops {
        let mut helper = Helper::spawn(None, &[]);
        let answer = helper.call("setDraftEnterCapture", json!({ "enabled": true }));
        assert_eq!(answer["result"], json!({ "success": true }));
        match signal {
            Some(signal) => helper.signal(signal),
            None => helper.close_stdin(),
        }
        let status = helper.wait();
        assert_eq!(status.code(), Some(0), "{reason}: {status:?}");
        assert!(
            helper
                .stderr()
                .contains(&format!("shutting down: {reason}")),
            "{reason}: the shutdown hook did not run:\n{}",
            helper.stderr()
        );
    }
}

type Calls = Arc<Mutex<Vec<String>>>;

struct FakeRegistry(Calls);

#[zbus::interface(name = "org.freedesktop.host.portal.Registry")]
impl FakeRegistry {
    fn register(&self, app_id: String, _options: HashMap<String, OwnedValue>) {
        self.0.lock().unwrap().push(format!("Register {app_id}"));
    }
}

struct FakeGlobalShortcuts(Calls);

#[zbus::interface(name = "org.freedesktop.portal.GlobalShortcuts")]
impl FakeGlobalShortcuts {
    #[zbus(property, name = "version")]
    fn version(&self) -> u32 {
        self.0
            .lock()
            .unwrap()
            .push("GlobalShortcuts version".to_owned());
        1
    }
}

async fn capabilities_on(bus: &PrivateBus) -> Value {
    let address = bus.address.clone();
    tokio::task::spawn_blocking(move || {
        let mut helper = Helper::spawn(Some(&address), &[]);
        helper.call(
            "getHelperCapabilities",
            json!({ "appId": "com.example.Test" }),
        )
    })
    .await
    .unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn portal_registration_comes_first_and_is_optional() {
    let bus = PrivateBus::start();

    // No portal on the bus: registration fails, and the answer still comes.
    let without_portal = capabilities_on(&bus).await;
    assert_eq!(without_portal["result"]["keyInputMode"], "none");

    let calls = Calls::default();
    let _portal = zbus::connection::Builder::address(bus.address.as_str())
        .unwrap()
        .name("org.freedesktop.portal.Desktop")
        .unwrap()
        .serve_at(
            "/org/freedesktop/portal/desktop",
            FakeRegistry(calls.clone()),
        )
        .unwrap()
        .serve_at(
            "/org/freedesktop/portal/desktop",
            FakeGlobalShortcuts(calls.clone()),
        )
        .unwrap()
        .build()
        .await
        .unwrap();

    // The probe runs in the background: keep the helper until the portal
    // has seen it.
    let address = bus.address.clone();
    let seen = calls.clone();
    let with_portal = tokio::task::spawn_blocking(move || {
        let mut helper = Helper::spawn(Some(&address), &[]);
        let answer = helper.call(
            "getHelperCapabilities",
            json!({ "appId": "com.example.Test" }),
        );
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while seen.lock().unwrap().len() < 2 && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        answer
    })
    .await
    .unwrap();
    // No backend of this session uses the portal, so the answer is the same.
    assert_eq!(with_portal["result"], without_portal["result"]);
    // The registry takes an app id only before any other portal call.
    assert_eq!(
        *calls.lock().unwrap(),
        ["Register com.example.Test", "GlobalShortcuts version"]
    );
}

/// A RemoteDesktop portal that sends each Request's Response before the
/// method returns, as a fast portal can: a client that subscribes to the
/// Response after its call never sees it.
struct FakeRemoteDesktop {
    calls: Calls,
    /// The Start answer: 0 allowed, 1 refused.
    start_code: u32,
}

fn request_handle(header: &Header<'_>, options: &HashMap<String, OwnedValue>) -> OwnedObjectPath {
    let sender = header
        .sender()
        .unwrap()
        .trim_start_matches(':')
        .replace('.', "_");
    let token = String::try_from(options["handle_token"].try_clone().unwrap()).unwrap();
    OwnedObjectPath::try_from(format!(
        "/org/freedesktop/portal/desktop/request/{sender}/{token}"
    ))
    .unwrap()
}

async fn respond(
    connection: &zbus::Connection,
    handle: &OwnedObjectPath,
    code: u32,
    results: HashMap<&str, Variant<'_>>,
) {
    connection
        .emit_signal(
            None::<&str>,
            handle,
            "org.freedesktop.portal.Request",
            "Response",
            &(code, results),
        )
        .await
        .unwrap();
}

#[zbus::interface(name = "org.freedesktop.portal.RemoteDesktop")]
impl FakeRemoteDesktop {
    #[zbus(property, name = "version")]
    fn version(&self) -> u32 {
        2
    }

    async fn create_session(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &zbus::Connection,
        options: HashMap<String, OwnedValue>,
    ) -> OwnedObjectPath {
        self.calls.lock().unwrap().push("CreateSession".to_owned());
        let handle = request_handle(&header, &options);
        let session = "/org/freedesktop/portal/desktop/session/test/1";
        respond(
            connection,
            &handle,
            0,
            HashMap::from([("session_handle", Variant::from(session))]),
        )
        .await;
        handle
    }

    async fn select_devices(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &zbus::Connection,
        _session: OwnedObjectPath,
        options: HashMap<String, OwnedValue>,
    ) -> OwnedObjectPath {
        let number = |key: &str| u32::try_from(options[key].try_clone().unwrap()).unwrap();
        let token = options
            .get("restore_token")
            .map(|token| String::try_from(token.try_clone().unwrap()).unwrap());
        self.calls.lock().unwrap().push(format!(
            "SelectDevices types={} persist_mode={} restore_token={token:?}",
            number("types"),
            number("persist_mode")
        ));
        let handle = request_handle(&header, &options);
        respond(connection, &handle, 0, HashMap::new()).await;
        handle
    }

    async fn start(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &zbus::Connection,
        _session: OwnedObjectPath,
        _parent_window: String,
        options: HashMap<String, OwnedValue>,
    ) -> OwnedObjectPath {
        self.calls.lock().unwrap().push("Start".to_owned());
        let handle = request_handle(&header, &options);
        let results = if self.start_code == 0 {
            HashMap::from([
                ("devices", Variant::from(1u32)),
                ("restore_token", Variant::from("token-1")),
            ])
        } else {
            HashMap::new()
        };
        respond(connection, &handle, self.start_code, results).await;
        handle
    }
}

async fn serve_remote_desktop(
    bus: &PrivateBus,
    calls: &Calls,
    start_code: u32,
) -> zbus::Connection {
    zbus::connection::Builder::address(bus.address.as_str())
        .unwrap()
        .name("org.freedesktop.portal.Desktop")
        .unwrap()
        .serve_at(
            "/org/freedesktop/portal/desktop",
            FakeRegistry(calls.clone()),
        )
        .unwrap()
        .serve_at(
            "/org/freedesktop/portal/desktop",
            FakeRemoteDesktop {
                calls: calls.clone(),
                start_code,
            },
        )
        .unwrap()
        .build()
        .await
        .unwrap()
}

/// Runs `steps` against a helper on a KDE Wayland session that keeps its
/// state in `state`.
async fn on_wayland<T: Send + 'static>(
    bus: &PrivateBus,
    state: &TempDir,
    steps: impl FnOnce(&mut Helper) -> T + Send + 'static,
) -> T {
    let address = bus.address.clone();
    let state = state.path().to_str().unwrap().to_owned();
    tokio::task::spawn_blocking(move || {
        let mut helper = Helper::spawn(
            Some(&address),
            &[
                ("XDG_SESSION_TYPE", "wayland"),
                ("WAYLAND_DISPLAY", "wayland-test"),
                ("XDG_CURRENT_DESKTOP", "KDE"),
                ("XDG_STATE_HOME", &state),
            ],
        );
        steps(&mut helper)
    })
    .await
    .unwrap()
}

fn consent(helper: &mut Helper) -> Value {
    let answer = helper.call(
        "getHelperCapabilities",
        json!({ "appId": "com.example.Test" }),
    );
    assert_eq!(
        answer["result"]["injectionBackend"],
        "portal-remote-desktop"
    );
    answer["result"]["injectionConsent"].clone()
}

#[tokio::test(flavor = "multi_thread")]
async fn remote_desktop_consent_is_asked_once_and_restored_with_the_token() {
    let bus = PrivateBus::start();
    let calls = Calls::default();
    let _portal = serve_remote_desktop(&bus, &calls, 0).await;
    let state = TempDir::new("state");

    let first = on_wayland(&bus, &state, |helper| {
        let before = consent(helper);
        let prepared = helper.call("prepareInjection", json!({}));
        (before, prepared["result"].clone(), consent(helper))
    })
    .await;
    assert_eq!(
        first,
        (
            json!("required"),
            json!({ "ready": true }),
            json!("granted")
        )
    );
    let token = state
        .path()
        .join("amical-desktop/helper/remote-desktop.token");
    assert_eq!(std::fs::read_to_string(&token).unwrap(), "token-1");
    use std::os::unix::fs::PermissionsExt as _;
    assert_eq!(
        std::fs::metadata(&token).unwrap().permissions().mode() & 0o777,
        0o600
    );

    // A new helper starts its session from the saved token.
    let second = on_wayland(&bus, &state, |helper| {
        let before = consent(helper);
        (
            before,
            helper.call("prepareInjection", json!({}))["result"].clone(),
        )
    })
    .await;
    assert_eq!(second, (json!("granted"), json!({ "ready": true })));
    assert_eq!(
        *calls.lock().unwrap(),
        [
            "Register com.example.Test",
            "CreateSession",
            "SelectDevices types=1 persist_mode=2 restore_token=None",
            "Start",
            "Register com.example.Test",
            "CreateSession",
            "SelectDevices types=1 persist_mode=2 restore_token=Some(\"token-1\")",
            "Start",
        ]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_refused_remote_desktop_dialog_counts_until_asked_again() {
    let bus = PrivateBus::start();
    let calls = Calls::default();
    let _portal = serve_remote_desktop(&bus, &calls, 1).await;
    let state = TempDir::new("state");

    let answers = on_wayland(&bus, &state, |helper| {
        let refused = helper.call("prepareInjection", json!({}))["result"].clone();
        let after = consent(helper);
        // prepareInjection asks again (onboarding's retry).
        helper.call("prepareInjection", json!({}));
        (refused, after)
    })
    .await;
    assert_eq!(answers.0["ready"], false);
    assert_eq!(answers.1, "denied");
    let starts = calls
        .lock()
        .unwrap()
        .iter()
        .filter(|call| *call == "Start")
        .count();
    assert_eq!(starts, 2);
    assert!(!state
        .path()
        .join("amical-desktop/helper/remote-desktop.token")
        .exists());
}

/// A portal service that takes 4 s to register an app, like one that the
/// session bus starts on demand on a busy machine.
struct SlowRegistry;

#[zbus::interface(name = "org.freedesktop.host.portal.Registry")]
impl SlowRegistry {
    async fn register(&self, _app_id: String, _options: HashMap<String, OwnedValue>) {
        tokio::time::sleep(std::time::Duration::from_secs(4)).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_slow_portal_sends_capabilities_changed_when_it_answers() {
    let bus = PrivateBus::start();
    let calls = Calls::default();
    let _portal = zbus::connection::Builder::address(bus.address.as_str())
        .unwrap()
        .name("org.freedesktop.portal.Desktop")
        .unwrap()
        .serve_at("/org/freedesktop/portal/desktop", SlowRegistry)
        .unwrap()
        .serve_at(
            "/org/freedesktop/portal/desktop",
            FakeRemoteDesktop {
                calls: calls.clone(),
                start_code: 0,
            },
        )
        .unwrap()
        .build()
        .await
        .unwrap();
    let state = TempDir::new("state");

    let (first, event, second) = on_wayland(&bus, &state, |helper| {
        let first = helper.call(
            "getHelperCapabilities",
            json!({ "appId": "com.example.Test" }),
        );
        let event = helper.next_line_within(std::time::Duration::from_secs(10));
        let second = helper.call("getHelperCapabilities", json!({}));
        (first, event, second)
    })
    .await;
    // The first answer comes within the desktop's 3 s, without the portal.
    assert_eq!(first["result"]["injectionBackend"], Value::Null);
    let event: Value = serde_json::from_str(&event.expect("no capabilitiesChanged")).unwrap();
    assert_valid("events/capabilities-changed-event.schema.json", &event);
    assert_eq!(event["type"], "capabilitiesChanged");
    assert_eq!(
        second["result"]["injectionBackend"],
        "portal-remote-desktop"
    );
}

/// A GlobalShortcuts portal: CreateSession and BindShortcuts answer at
/// once, BindShortcuts reports "Press <preferred trigger>" per id, and the
/// test sends Activated and Deactivated itself.
struct FakeGlobalShortcutsPortal {
    calls: Calls,
}

const GS_SESSION: &str = "/org/freedesktop/portal/desktop/session/test/gs";

#[zbus::interface(name = "org.freedesktop.portal.GlobalShortcuts")]
impl FakeGlobalShortcutsPortal {
    #[zbus(property, name = "version")]
    fn version(&self) -> u32 {
        2
    }

    async fn create_session(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &zbus::Connection,
        options: HashMap<String, OwnedValue>,
    ) -> OwnedObjectPath {
        self.calls.lock().unwrap().push("CreateSession".to_owned());
        let handle = request_handle(&header, &options);
        respond(
            connection,
            &handle,
            0,
            HashMap::from([("session_handle", Variant::from(GS_SESSION))]),
        )
        .await;
        handle
    }

    async fn bind_shortcuts(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &zbus::Connection,
        _session: OwnedObjectPath,
        shortcuts: Vec<(String, HashMap<String, OwnedValue>)>,
        _parent_window: String,
        options: HashMap<String, OwnedValue>,
    ) -> OwnedObjectPath {
        let trigger = |properties: &HashMap<String, OwnedValue>| {
            String::try_from(properties["preferred_trigger"].try_clone().unwrap()).unwrap()
        };
        let listed: Vec<String> = shortcuts
            .iter()
            .map(|(id, properties)| format!("{id}={}", trigger(properties)))
            .collect();
        self.calls
            .lock()
            .unwrap()
            .push(format!("BindShortcuts {}", listed.join(" ")));
        let answer: Vec<(String, HashMap<&str, Variant<'_>>)> = shortcuts
            .iter()
            .map(|(id, properties)| {
                let shown = format!("Press {}", trigger(properties));
                (
                    id.clone(),
                    HashMap::from([("trigger_description", Variant::from(shown))]),
                )
            })
            .collect();
        let handle = request_handle(&header, &options);
        respond(
            connection,
            &handle,
            0,
            HashMap::from([("shortcuts", Variant::from(answer))]),
        )
        .await;
        handle
    }
}

struct FakeSession(Calls);

#[zbus::interface(name = "org.freedesktop.portal.Session")]
impl FakeSession {
    fn close(&self) {
        self.0.lock().unwrap().push("Session.Close".to_owned());
    }
}

/// The next shortcutsBound or shortcut edge event, skipping others.
fn next_event(helper: &mut Helper, kind: &str) -> Value {
    loop {
        let line = helper
            .next_line_within(std::time::Duration::from_secs(5))
            .unwrap_or_else(|| panic!("no {kind} event"));
        let event: Value = serde_json::from_str(&line).unwrap();
        if event["type"] == kind {
            return event;
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn portal_shortcuts_bind_the_full_list_and_report_one_edge_per_press() {
    let bus = PrivateBus::start();
    let calls = Calls::default();
    let portal = zbus::connection::Builder::address(bus.address.as_str())
        .unwrap()
        .name("org.freedesktop.portal.Desktop")
        .unwrap()
        .serve_at(
            "/org/freedesktop/portal/desktop",
            FakeRegistry(calls.clone()),
        )
        .unwrap()
        .serve_at(
            "/org/freedesktop/portal/desktop",
            FakeGlobalShortcutsPortal {
                calls: calls.clone(),
            },
        )
        .unwrap()
        .serve_at(GS_SESSION, FakeSession(calls.clone()))
        .unwrap()
        .build()
        .await
        .unwrap();
    let state = TempDir::new("state");
    let address = bus.address.clone();
    let state_path = state.path().to_str().unwrap().to_owned();
    let shortcuts = |toggle_key: i64| {
        json!({
            "subsetChords": [[29, 56, 57]],
            "exactChords": [[29, 56, toggle_key], [29, 56]],
            "shortcuts": [
                { "id": "pushToTalk:0", "keyCodes": [29, 56, 57], "label": "Push to talk", "kind": "hold" },
                { "id": "toggleRecording:0", "keyCodes": [29, 56, toggle_key], "label": "Toggle", "kind": "tap" },
                { "id": "newNote:0", "keyCodes": [29, 56], "label": "New note", "kind": "tap" }
            ]
        })
    };
    let (mut helper, capabilities, bound) = {
        let first = shortcuts(35);
        tokio::task::spawn_blocking(move || {
            let mut helper = Helper::spawn(
                Some(&address),
                &[
                    ("XDG_SESSION_TYPE", "wayland"),
                    ("WAYLAND_DISPLAY", "wayland-test"),
                    ("XDG_CURRENT_DESKTOP", "KDE"),
                    ("XDG_STATE_HOME", &state_path),
                ],
            );
            let capabilities = helper.call(
                "getHelperCapabilities",
                json!({ "appId": "com.example.Test" }),
            );
            helper.call("setShortcuts", first);
            let bound = next_event(&mut helper, "shortcutsBound");
            (helper, capabilities, bound)
        })
        .await
        .unwrap()
    };
    let capabilities = &capabilities["result"];
    assert_eq!(capabilities["keyInputMode"], "chord");
    assert_eq!(capabilities["keyInputBackend"], "portal-global-shortcuts");
    assert_eq!(capabilities["holdSupport"], "modifier-plus-key");
    assert_eq!(capabilities["chordConsume"], "compositor");
    assert_eq!(capabilities["chord"]["backend"], "kde");
    assert_valid("events/shortcuts-bound-event.schema.json", &bound);
    assert_eq!(
        bound["payload"],
        json!({
            "bound": [
                { "id": "pushToTalk:0", "trigger": "Press CTRL+ALT+space", "holdReliable": true },
                { "id": "toggleRecording:0", "trigger": "Press CTRL+ALT+h", "holdReliable": true }
            ],
            "failed": [{
                "id": "newNote:0",
                "reason": "unsupported-shape",
                "message": "A system shortcut needs exactly one key that is not a modifier"
            }],
            "pending": false
        })
    );

    // A held key repeats Activated (GNOME); a release can come twice (KDE).
    let edge = |name: &str| {
        let portal = portal.clone();
        let name = name.to_owned();
        async move {
            let options: HashMap<&str, Variant<'_>> = HashMap::new();
            portal
                .emit_signal(
                    None::<&str>,
                    "/org/freedesktop/portal/desktop",
                    "org.freedesktop.portal.GlobalShortcuts",
                    name.as_str(),
                    &(
                        OwnedObjectPath::try_from(GS_SESSION).unwrap(),
                        "pushToTalk:0",
                        0u64,
                        options,
                    ),
                )
                .await
                .unwrap();
        }
    };
    for name in [
        "Activated",
        "Activated",
        "Activated",
        "Deactivated",
        "Deactivated",
    ] {
        edge(name).await;
    }
    let (helper_back, edges) = tokio::task::spawn_blocking(move || {
        let mut edges = Vec::new();
        while let Some(line) = helper.next_line_within(std::time::Duration::from_millis(500)) {
            let event: Value = serde_json::from_str(&line).unwrap();
            edges.push(format!(
                "{} {}",
                event["type"].as_str().unwrap(),
                event["payload"]["id"].as_str().unwrap()
            ));
        }
        (helper, edges)
    })
    .await
    .unwrap();
    helper = helper_back;
    assert_eq!(
        edges,
        [
            "shortcutActivated pushToTalk:0",
            "shortcutDeactivated pushToTalk:0"
        ]
    );

    // A new list closes the old session before it binds again.
    let second = shortcuts(44);
    let rebound = tokio::task::spawn_blocking(move || {
        helper.call("setShortcuts", second);
        next_event(&mut helper, "shortcutsBound")
    })
    .await
    .unwrap();
    assert_eq!(
        rebound["payload"]["bound"][1]["trigger"],
        "Press CTRL+ALT+z"
    );
    assert_eq!(
        calls.lock().unwrap()[1..],
        [
            "CreateSession",
            "BindShortcuts pushToTalk:0=CTRL+ALT+space toggleRecording:0=CTRL+ALT+h",
            "Session.Close",
            "CreateSession",
            "BindShortcuts pushToTalk:0=CTRL+ALT+space toggleRecording:0=CTRL+ALT+z",
        ]
    );
}
