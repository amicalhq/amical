//! Global shortcuts through the XDG GlobalShortcuts portal (G2 §4b, spike
//! S8): chord mode on GNOME 48+ and KDE Wayland. After a consent dialog the
//! compositor owns the keys and reports each press and release by shortcut
//! id.
//!
//! Rules from spike S8 §4:
//! - One session for the app, bound with the full list every time: the
//!   desktops store exactly the last bound list.
//! - A change closes the session first and then binds on a new one. While a
//!   bind waits for the user's answer nothing else happens; the newest
//!   list is bound after the answer. A pending bind is closed (Request.Close)
//!   before its session: closing only the session crashes GNOME's portal
//!   backend when the user answers later.
//! - GNOME repeats Activated while a key is held, and KDE can send extra
//!   events: one shortcutActivated per press, and a Deactivated with
//!   nothing held is dropped.
//! - The answer's trigger_description tells what really works: an empty
//!   one means that the shortcut has no key.
//! - When the portal or GNOME's portal backend restarts, the grabs are gone
//!   with no signal: bind again (the stored grant makes it silent).
//!
//! Key codes are never logged.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use futures_util::StreamExt as _;
use zbus::fdo::DBusProxy;
use zbus::message::Type as MessageType;
use zbus::proxy::{Builder as ProxyBuilder, CacheProperties};
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};
use zbus::{Connection, MatchRule, MessageStream, Proxy};

use crate::log::{iso8601_now, log};
use crate::models::*;
use crate::portal::{
    self, error_name, Error, PORTAL_PATH, PORTAL_SERVICE, RESPONSE_CANCELLED, RESPONSE_SUCCESS,
};
use crate::writer::WeakOut;

const GLOBAL_SHORTCUTS: &str = "org.freedesktop.portal.GlobalShortcuts";
const SESSION: &str = "org.freedesktop.portal.Session";
/// GNOME's portal backend. Its grabs vanish with it.
const GNOME_BACKEND: &str = "org.freedesktop.impl.portal.desktop.gnome";
/// GNOME repeats Activated while a key is held: the first repeat after the
/// keyboard delay (500 ms by default), then every repeat interval. A later
/// Activated for a held shortcut is a new press after a release that GNOME
/// lost (mutter#4846: a modifier lifted before the key). A keyboard delay
/// over this gap makes the first repeat look like a new press.
const REPEAT_GAP: Duration = Duration::from_millis(1100);
/// A bind that has no answer after this long shows a dialog: the desktop
/// hears that it is pending.
const DIALOG_HINT: Duration = Duration::from_millis(300);

/// Shortcut properties as the portal sends them (a{sv}).
type Properties = HashMap<String, OwnedValue>;
/// Activated and Deactivated: session, shortcut id, timestamp, options.
type Edge = (OwnedObjectPath, String, u64, Properties);
/// ShortcutsChanged: session, and each shortcut with its properties.
type Changed = (OwnedObjectPath, Vec<(String, Properties)>);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Desktop {
    Gnome,
    Kde,
}

/// One shortcut as the portal gets it.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Descriptor {
    id: String,
    description: String,
    trigger: String,
    has_modifiers: bool,
}

#[derive(Default)]
struct State {
    /// The newest list from setShortcuts, and the ids it could not use.
    wanted: Vec<Descriptor>,
    unsupported: Vec<Failed>,
    /// What the current session has bound.
    bound: Option<Vec<Descriptor>>,
    session: Option<OwnedObjectPath>,
    /// A bind task runs (it may wait for the dialog).
    binding: bool,
    /// The handle token of the pending BindShortcuts.
    pending: Option<String>,
    /// Ids held now, with the time of their latest Activated.
    held: HashMap<String, Instant>,
}

pub struct GlobalShortcuts {
    conn: Connection,
    app_id: String,
    desktop: Desktop,
    /// The portal's GlobalShortcuts version (KDE ≥ 2 reports releases).
    version: u32,
    events: WeakOut,
    state: Mutex<State>,
}

fn lock(state: &Mutex<State>) -> MutexGuard<'_, State> {
    state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The XDG shortcut name (an xkb keysym name) of an evdev key code, for
/// the US layout. The compositor maps it to the user's layout.
fn key_name(code: i64) -> Option<String> {
    const LETTERS: [(i64, &str); 26] = [
        (16, "q"),
        (17, "w"),
        (18, "e"),
        (19, "r"),
        (20, "t"),
        (21, "y"),
        (22, "u"),
        (23, "i"),
        (24, "o"),
        (25, "p"),
        (30, "a"),
        (31, "s"),
        (32, "d"),
        (33, "f"),
        (34, "g"),
        (35, "h"),
        (36, "j"),
        (37, "k"),
        (38, "l"),
        (44, "z"),
        (45, "x"),
        (46, "c"),
        (47, "v"),
        (48, "b"),
        (49, "n"),
        (50, "m"),
    ];
    const OTHERS: [(i64, &str); 37] = [
        (1, "Escape"),
        (11, "0"),
        (12, "minus"),
        (13, "equal"),
        (14, "BackSpace"),
        (15, "Tab"),
        (26, "bracketleft"),
        (27, "bracketright"),
        (28, "Return"),
        (39, "semicolon"),
        (40, "apostrophe"),
        (41, "grave"),
        (43, "backslash"),
        (51, "comma"),
        (52, "period"),
        (53, "slash"),
        (57, "space"),
        (70, "Scroll_Lock"),
        (96, "KP_Enter"),
        (99, "Print"),
        (102, "Home"),
        (103, "Up"),
        (104, "Prior"),
        (105, "Left"),
        (106, "Right"),
        (107, "End"),
        (108, "Down"),
        (109, "Next"),
        (110, "Insert"),
        (111, "Delete"),
        (119, "Pause"),
        (87, "F11"),
        (88, "F12"),
        (127, "Menu"),
        (113, "XF86AudioMute"),
        (114, "XF86AudioLowerVolume"),
        (115, "XF86AudioRaiseVolume"),
    ];
    match code {
        2..=10 => Some((code - 1).to_string()),
        59..=68 => Some(format!("F{}", code - 58)),
        183..=194 => Some(format!("F{}", code - 170)),
        _ => LETTERS
            .iter()
            .chain(OTHERS.iter())
            .find(|(known, _)| *known == code)
            .map(|(_, name)| (*name).to_owned()),
    }
}

/// The XDG trigger of a chord ("CTRL+ALT+space"): its modifiers and exactly
/// one other key. None for any other shape.
fn trigger(codes: &[i64]) -> Option<(String, bool)> {
    let mut modifiers = Vec::new();
    let mut keys = Vec::new();
    for &code in codes {
        let modifier = match code {
            29 | 97 => Some("CTRL"),
            56 | 100 => Some("ALT"),
            42 | 54 => Some("SHIFT"),
            125 | 126 => Some("LOGO"),
            _ => None,
        };
        match modifier {
            Some(name) if !modifiers.contains(&name) => modifiers.push(name),
            Some(_) => {}
            None => keys.push(code),
        }
    }
    let [key] = keys[..] else {
        return None;
    };
    let mut parts: Vec<String> = ["CTRL", "ALT", "SHIFT", "LOGO"]
        .iter()
        .filter(|name| modifiers.contains(name))
        .map(|name| (*name).to_owned())
        .collect();
    let has_modifiers = !parts.is_empty();
    parts.push(key_name(key)?);
    Some((parts.join("+"), has_modifiers))
}

fn failed(id: &str, reason: FailedReason, message: &str) -> Failed {
    Failed {
        id: id.to_owned(),
        reason,
        message: Some(message.to_owned()),
    }
}

impl GlobalShortcuts {
    /// `conn` must be the connection that registered `app_id`.
    pub async fn start(
        conn: Connection,
        app_id: String,
        desktop: Desktop,
        version: u32,
        events: WeakOut,
    ) -> Result<Arc<Self>, Error> {
        let this = Arc::new(Self {
            conn,
            app_id,
            desktop,
            version,
            events,
            state: Mutex::new(State::default()),
        });
        this.watch_edges().await?;
        this.watch_restarts().await;
        Ok(this)
    }

    pub fn hold_support(&self) -> HoldSupport {
        match self.desktop {
            Desktop::Gnome => HoldSupport::UnmodifiedKeyOnly,
            Desktop::Kde if self.version >= 2 => HoldSupport::ModifierPlusKey,
            Desktop::Kde => HoldSupport::TapOnly,
        }
    }

    pub fn chord(&self) -> Chord {
        Chord {
            backend: match self.desktop {
                Desktop::Gnome => Backend::Gnome,
                Desktop::Kde => Backend::Kde,
            },
            emits_shortcuts_changed: true,
            needs_manual_bind: false,
            release_on_any_key_up: self.desktop == Desktop::Kde,
            reports_bound_trigger: true,
        }
    }

    fn hold_reliable(&self, descriptor: &Descriptor) -> bool {
        match self.hold_support() {
            HoldSupport::UnmodifiedKeyOnly => !descriptor.has_modifiers,
            HoldSupport::ModifierPlusKey | HoldSupport::Any => true,
            HoldSupport::TapOnly => false,
        }
    }

    /// Takes the newest list and binds it in the background. The answer
    /// comes as shortcutsBound.
    pub fn set_shortcuts(self: &Arc<Self>, shortcuts: Vec<Shortcut>) {
        let mut wanted = Vec::new();
        let mut unsupported = Vec::new();
        for shortcut in shortcuts {
            match trigger(&shortcut.key_codes) {
                Some((trigger, has_modifiers)) => wanted.push(Descriptor {
                    id: shortcut.id,
                    description: shortcut.label,
                    trigger,
                    has_modifiers,
                }),
                None => unsupported.push(failed(
                    &shortcut.id,
                    FailedReason::UnsupportedShape,
                    "A system shortcut needs exactly one key that is not a modifier",
                )),
            }
        }
        let start = {
            let mut state = lock(&self.state);
            state.wanted = wanted;
            state.unsupported = unsupported;
            !std::mem::replace(&mut state.binding, true)
        };
        if start {
            let this = self.clone();
            tokio::spawn(async move { this.bind_loop().await });
        }
    }

    /// Binds until the bound list is the wanted one.
    async fn bind_loop(self: Arc<Self>) {
        loop {
            let wanted = {
                let mut state = lock(&self.state);
                if state.session.is_some() && state.bound.as_ref() == Some(&state.wanted) {
                    state.binding = false;
                    return;
                }
                state.wanted.clone()
            };
            let payload = match self.bind(&wanted).await {
                Ok(payload) => payload,
                Err(error) => {
                    log!("Shortcuts", "bind failed: {error}");
                    let mut state = lock(&self.state);
                    // Do not loop on an error; the next setShortcuts or a
                    // portal restart tries again.
                    state.bound = Some(wanted.clone());
                    state.binding = false;
                    let mut failures = state.unsupported.clone();
                    failures.extend(wanted.iter().map(|descriptor| {
                        failed(
                            &descriptor.id,
                            FailedReason::BackendError,
                            "The system shortcut portal failed",
                        )
                    }));
                    drop(state);
                    self.send_bound(Vec::new(), failures, false);
                    return;
                }
            };
            self.events.send(&ShortcutsBoundEvent {
                payload,
                timestamp: Some(iso8601_now()),
                shortcuts_bound_event_schema_type: ShortcutsBoundEventType::ShortcutsBound,
            });
        }
    }

    /// Closes the old session, then creates a new one and binds `wanted`.
    async fn bind(
        self: &Arc<Self>,
        wanted: &[Descriptor],
    ) -> Result<ShortcutsBoundEventPayload, Error> {
        let old = lock(&self.state).session.take();
        if let Some(old) = old {
            self.close_session(&old).await;
        }
        lock(&self.state).held.clear();

        let token = portal::token();
        let mut options: HashMap<&str, Value<'_>> = HashMap::new();
        options.insert("handle_token", Value::from(token.as_str()));
        let session_token = portal::token();
        options.insert("session_handle_token", Value::from(session_token.as_str()));
        let (code, results) = portal::request(
            &self.conn,
            GLOBAL_SHORTCUTS,
            "CreateSession",
            &token,
            &(options,),
        )
        .await?;
        if code != RESPONSE_SUCCESS {
            return Err(format!("CreateSession answered {code}").into());
        }
        let session = String::try_from(
            results
                .get("session_handle")
                .ok_or("CreateSession gave no session handle")?
                .try_clone()?,
        )?;
        let session = OwnedObjectPath::try_from(session)?;
        lock(&self.state).session = Some(session.clone());
        self.watch_closed(&session).await;

        let shortcuts: Vec<(&str, HashMap<&str, Value<'_>>)> = wanted
            .iter()
            .map(|descriptor| {
                let mut properties = HashMap::new();
                properties.insert("description", Value::from(descriptor.description.as_str()));
                properties.insert(
                    "preferred_trigger",
                    Value::from(descriptor.trigger.as_str()),
                );
                (descriptor.id.as_str(), properties)
            })
            .collect();
        let token = portal::token();
        let mut options: HashMap<&str, Value<'_>> = HashMap::new();
        options.insert("handle_token", Value::from(token.as_str()));
        lock(&self.state).pending = Some(token.clone());
        let hint = self.dialog_hint();
        let answer = portal::request(
            &self.conn,
            GLOBAL_SHORTCUTS,
            "BindShortcuts",
            &token,
            &(session.as_ref(), shortcuts, "", options),
        )
        .await;
        hint.abort();
        lock(&self.state).pending = None;
        let (code, results) = answer?;
        lock(&self.state).bound = Some(wanted.to_vec());

        let mut failures = lock(&self.state).unsupported.clone();
        if code != RESPONSE_SUCCESS {
            let reason = if code == RESPONSE_CANCELLED {
                FailedReason::Dismissed
            } else {
                FailedReason::Denied
            };
            log!("Shortcuts", "the bind was not approved (code {code})");
            failures.extend(wanted.iter().map(|descriptor| {
                failed(
                    &descriptor.id,
                    reason.clone(),
                    "The shortcuts were not approved",
                )
            }));
            return Ok(ShortcutsBoundEventPayload {
                bound: Vec::new(),
                failed: failures,
                pending: false,
            });
        }
        let triggers = results
            .get("shortcuts")
            .map(triggers_of)
            .unwrap_or_default();
        let (bound, more) = self.report(wanted, &triggers);
        failures.extend(more);
        log!(
            "Shortcuts",
            "bound {} of {} shortcuts",
            bound.len(),
            wanted.len() + lock(&self.state).unsupported.len()
        );
        Ok(ShortcutsBoundEventPayload {
            bound,
            failed: failures,
            pending: false,
        })
    }

    /// The bound and failed lists for `wanted`, from the triggers that the
    /// compositor reports per id.
    fn report(
        &self,
        wanted: &[Descriptor],
        triggers: &HashMap<String, String>,
    ) -> (Vec<Bound>, Vec<Failed>) {
        let mut bound = Vec::new();
        let mut failures = Vec::new();
        for descriptor in wanted {
            match triggers
                .get(&descriptor.id)
                .filter(|trigger| !trigger.is_empty())
            {
                Some(trigger) => bound.push(Bound {
                    id: descriptor.id.clone(),
                    trigger: Some(trigger.clone()),
                    hold_reliable: self.hold_reliable(descriptor),
                }),
                None => failures.push(failed(
                    &descriptor.id,
                    FailedReason::Dismissed,
                    "The system has no key for this shortcut",
                )),
            }
        }
        (bound, failures)
    }

    /// Sends shortcutsBound with `pending` true if the bind has no answer
    /// after DIALOG_HINT: the compositor shows its dialog.
    fn dialog_hint(self: &Arc<Self>) -> tokio::task::AbortHandle {
        let this = Arc::downgrade(self);
        tokio::spawn(async move {
            tokio::time::sleep(DIALOG_HINT).await;
            if let Some(this) = this.upgrade() {
                let unsupported = lock(&this.state).unsupported.clone();
                this.send_bound(Vec::new(), unsupported, true);
            }
        })
        .abort_handle()
    }

    fn send_bound(&self, bound: Vec<Bound>, failures: Vec<Failed>, pending: bool) {
        self.events.send(&ShortcutsBoundEvent {
            payload: ShortcutsBoundEventPayload {
                bound,
                failed: failures,
                pending,
            },
            timestamp: Some(iso8601_now()),
            shortcuts_bound_event_schema_type: ShortcutsBoundEventType::ShortcutsBound,
        });
    }

    /// Activated, Deactivated and ShortcutsChanged for this connection's
    /// sessions; only the current session counts.
    async fn watch_edges(self: &Arc<Self>) -> Result<(), Error> {
        // One stream for the three signals: separate streams lose the order
        // between a press, its repeats and its release.
        let rule = MatchRule::builder()
            .msg_type(MessageType::Signal)
            .sender(PORTAL_SERVICE)?
            .path(PORTAL_PATH)?
            .interface(GLOBAL_SHORTCUTS)?
            .build();
        let mut signals = MessageStream::for_match_rule(rule, &self.conn, None).await?;
        let this = Arc::downgrade(self);
        tokio::spawn(async move {
            while let Some(Ok(message)) = signals.next().await {
                let Some(this) = this.upgrade() else { return };
                let header = message.header();
                match header.member().map(|member| member.as_str()) {
                    Some("Activated") | Some("Deactivated") => {
                        let down = header
                            .member()
                            .is_some_and(|member| member.as_str() == "Activated");
                        if let Ok((session, id, _, _)) = message.body().deserialize::<Edge>() {
                            this.on_edge(&session, id, down);
                        }
                    }
                    Some("ShortcutsChanged") => {
                        if let Ok((session, shortcuts)) = message.body().deserialize::<Changed>() {
                            this.on_changed(&session, &shortcuts);
                        }
                    }
                    _ => {}
                }
            }
        });
        Ok(())
    }

    fn on_edge(&self, session: &OwnedObjectPath, id: String, down: bool) {
        let mut state = lock(&self.state);
        if state.session.as_ref() != Some(session) {
            return;
        }
        // GNOME repeats Activated while a key is held, and KDE can send a
        // Deactivated with nothing held. An Activated long after the last one
        // is a new press (see REPEAT_GAP).
        let now = Instant::now();
        let news = if down {
            state
                .held
                .insert(id.clone(), now)
                .is_none_or(|previous| now.duration_since(previous) > REPEAT_GAP)
        } else {
            state.held.remove(&id).is_some()
        };
        drop(state);
        if !news {
            return;
        }
        let timestamp = Some(iso8601_now());
        if down {
            self.events.send(&ShortcutActivatedEvent {
                payload: ShortcutActivatedEventPayload { id },
                timestamp,
                shortcut_activated_event_schema_type: ShortcutActivatedEventType::ShortcutActivated,
            });
        } else {
            self.events.send(&ShortcutDeactivatedEvent {
                payload: ShortcutDeactivatedEventPayload { id },
                timestamp,
                shortcut_deactivated_event_schema_type:
                    ShortcutDeactivatedEventType::ShortcutDeactivated,
            });
        }
    }

    /// The user changed a shortcut in the system settings.
    fn on_changed(&self, session: &OwnedObjectPath, shortcuts: &[(String, Properties)]) {
        let (wanted, unsupported) = {
            let state = lock(&self.state);
            if state.session.as_ref() != Some(session) || state.pending.is_some() {
                return;
            }
            (
                state.bound.clone().unwrap_or_default(),
                state.unsupported.clone(),
            )
        };
        let triggers = shortcuts
            .iter()
            .map(|(id, properties)| (id.clone(), trigger_description(properties)))
            .collect();
        let (bound, mut failures) = self.report(&wanted, &triggers);
        failures.splice(0..0, unsupported);
        log!("Shortcuts", "the system settings changed the shortcuts");
        self.send_bound(bound, failures, false);
    }

    /// Forgets the session when the portal closes it, and binds again.
    async fn watch_closed(self: &Arc<Self>, session: &OwnedObjectPath) {
        let proxy = ProxyBuilder::new(&self.conn)
            .destination(PORTAL_SERVICE)
            .and_then(|builder| builder.path(session.clone()))
            .and_then(|builder| builder.interface(SESSION));
        let proxy: Result<Proxy<'static>, zbus::Error> = match proxy {
            Ok(builder) => builder.cache_properties(CacheProperties::No).build().await,
            Err(error) => Err(error),
        };
        let mut closed = match proxy {
            Ok(proxy) => match proxy.receive_signal("Closed").await {
                Ok(closed) => closed,
                Err(_) => return,
            },
            Err(_) => return,
        };
        let this = Arc::downgrade(self);
        let session = session.clone();
        tokio::spawn(async move {
            if closed.next().await.is_none() {
                return;
            }
            let Some(this) = this.upgrade() else { return };
            let ours = {
                let mut state = lock(&this.state);
                let ours = state.session.as_ref() == Some(&session);
                if ours {
                    state.session = None;
                    state.bound = None;
                    state.held.clear();
                }
                ours
            };
            if ours {
                log!(
                    "Shortcuts",
                    "the portal closed the shortcut session; binding again"
                );
                this.rebind();
            }
        });
    }

    /// GNOME's portal backend or the portal itself restarted: the grabs
    /// are gone, and a new portal also forgets the app id.
    async fn watch_restarts(self: &Arc<Self>) {
        let Ok(bus) = DBusProxy::new(&self.conn).await else {
            return;
        };
        let mut names = Vec::new();
        for name in [PORTAL_SERVICE, GNOME_BACKEND] {
            if let Ok(stream) = bus.receive_name_owner_changed_with_args(&[(0, name)]).await {
                names.push(stream);
            }
        }
        let mut changes = futures_util::stream::select_all(names);
        let this = Arc::downgrade(self);
        tokio::spawn(async move {
            while let Some(change) = changes.next().await {
                let Ok(args) = change.args() else { continue };
                if args.new_owner().is_none() {
                    continue;
                }
                let Some(this) = this.upgrade() else { return };
                let portal_restarted = args.name().as_str() == PORTAL_SERVICE;
                log!("Shortcuts", "{} restarted; binding again", args.name());
                if portal_restarted {
                    portal::register(&this.conn, &this.app_id).await;
                }
                {
                    let mut state = lock(&this.state);
                    state.session = None;
                    state.bound = None;
                    state.held.clear();
                }
                this.rebind();
            }
        });
    }

    fn rebind(self: &Arc<Self>) {
        let start = !std::mem::replace(&mut lock(&self.state).binding, true);
        if start {
            let this = self.clone();
            tokio::spawn(async move { this.bind_loop().await });
        }
    }

    async fn close_session(&self, session: &OwnedObjectPath) {
        let result = self
            .conn
            .call_method(
                Some(PORTAL_SERVICE),
                session.as_ref(),
                Some(SESSION),
                "Close",
                &(),
            )
            .await;
        if let Err(error) = result {
            log!(
                "Shortcuts",
                "cannot close the session: {}",
                error_name(&error)
            );
        }
    }

    /// Helper exit: a pending bind's Request first, then the session.
    pub async fn shutdown(&self) {
        let (pending, session) = {
            let mut state = lock(&self.state);
            (state.pending.take(), state.session.take())
        };
        if let Some(token) = pending {
            portal::close_request(&self.conn, &token).await;
        }
        if let Some(session) = session {
            self.close_session(&session).await;
        }
    }
}

fn trigger_description(properties: &Properties) -> String {
    properties
        .get("trigger_description")
        .and_then(|value| String::try_from(value.try_clone().ok()?).ok())
        .unwrap_or_default()
}

/// The trigger text per id in a Response's `shortcuts` (a(sa{sv})).
fn triggers_of(value: &OwnedValue) -> HashMap<String, String> {
    let Ok(value) = value.try_clone() else {
        return HashMap::new();
    };
    let shortcuts: Vec<(String, Properties)> = match value.try_into() {
        Ok(shortcuts) => shortcuts,
        Err(_) => return HashMap::new(),
    };
    shortcuts
        .iter()
        .map(|(id, properties)| (id.clone(), trigger_description(properties)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn triggers_follow_the_xdg_shortcut_syntax() {
        assert_eq!(
            trigger(&[29, 56, 57]),
            Some(("CTRL+ALT+space".to_owned(), true))
        );
        // Left and right modifiers give one name; the order is fixed.
        assert_eq!(
            trigger(&[126, 97, 35]),
            Some(("CTRL+LOGO+h".to_owned(), true))
        );
        assert_eq!(trigger(&[67]), Some(("F9".to_owned(), false)));
        assert_eq!(
            trigger(&[29, 56, 28]),
            Some(("CTRL+ALT+Return".to_owned(), true))
        );
        // A modifier-only chord, two regular keys, an unknown key.
        assert_eq!(trigger(&[29, 56]), None);
        assert_eq!(trigger(&[29, 30, 31]), None);
        assert_eq!(trigger(&[29, 240]), None);
    }
}
