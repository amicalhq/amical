//! The helper as a process: the wire protocol against the JSON schemas in
//! packages/types/generated/json-schemas, shutdown, and portal registration.
//! The schemas come from `pnpm --filter @amical/types generate:all`.

mod support;

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use support::{assert_valid, schema, Helper, PrivateBus};
use zbus::zvariant::OwnedValue;

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

    let with_portal = capabilities_on(&bus).await;
    // No backend uses the portal yet, so the answer is the same.
    assert_eq!(with_portal["result"], without_portal["result"]);
    // The registry takes an app id only before any other portal call.
    assert_eq!(
        *calls.lock().unwrap(),
        ["Register com.example.Test", "GlobalShortcuts version"]
    );
}
