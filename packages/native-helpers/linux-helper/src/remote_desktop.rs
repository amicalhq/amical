//! Key injection through the XDG RemoteDesktop portal (G2 §5.2, §5.3) on
//! Wayland sessions: one keyboard-only session, restored with a saved token
//! so that the consent dialog comes once.
//!
//! Session policy:
//! - GNOME shows a remote-control indicator for as long as a session is
//!   open, so the session closes `IDLE_CLOSE` after the last chord.
//! - KDE shows a tray item for each session and a notification each time a
//!   restored session starts, so one session stays open for the life of
//!   the helper.
//!
//! A session that the compositor closes (the user stops it, the screen
//! locks) is started again from the token at the next use.
//!
//! The token is never logged. No text passes through this module: it sends
//! key codes only.

use std::collections::HashMap;
use std::io::Write as _;
use std::os::unix::fs::{DirBuilderExt as _, OpenOptionsExt as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use futures_util::StreamExt as _;
use tokio::sync::watch;
use tokio::task::AbortHandle;
use zbus::proxy::{Builder as ProxyBuilder, CacheProperties};
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};
use zbus::{Connection, Proxy};

use crate::log::log;
use crate::portal::{error_name, PORTAL_PATH, PORTAL_SERVICE};

const REMOTE_DESKTOP: &str = "org.freedesktop.portal.RemoteDesktop";
const REQUEST: &str = "org.freedesktop.portal.Request";
const SESSION: &str = "org.freedesktop.portal.Session";
/// SelectDevices `types`: keyboard only.
const KEYBOARD: u32 = 1;
/// SelectDevices `persist_mode`: until the user revokes the permission.
const PERSIST_UNTIL_REVOKED: u32 = 2;
/// GNOME: close the session this long after the last chord. Pastes closer
/// together than this share one session and one indicator.
const IDLE_CLOSE: Duration = Duration::from_secs(15);
/// Gap between the key events of a chord.
const KEY_GAP: Duration = Duration::from_millis(25);
/// How long a session start may wait for the user to answer the dialog
/// before it counts as failed.
const START_LIMIT: Duration = Duration::from_secs(300);
/// Request.Response codes.
const RESPONSE_SUCCESS: u32 = 0;
const RESPONSE_CANCELLED: u32 = 1;

pub type Error = Box<dyn std::error::Error + Send + Sync>;

/// The user's answer to the portal dialog, as far as the helper knows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Consent {
    Granted,
    /// No answer yet: the next session start shows the dialog.
    Required,
    /// The user refused. Pastes do not ask again until prepareInjection.
    Denied,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Policy {
    CloseWhenIdle,
    Keep,
}

/// Why no session is ready.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Unavailable {
    /// The dialog is open, or the start is still running.
    Pending,
    Denied,
    /// The keyboard was not granted, or a portal call failed.
    Failed(String),
}

impl Unavailable {
    pub fn message(&self) -> String {
        match self {
            Self::Pending => "Waiting for the remote control permission".to_owned(),
            Self::Denied => "The remote control permission was refused".to_owned(),
            Self::Failed(reason) => format!("Remote control session failed: {reason}"),
        }
    }
}

struct Session {
    handle: OwnedObjectPath,
    closed: AtomicBool,
}

#[derive(Clone)]
enum Outcome {
    Started(Arc<Session>),
    Denied,
    Failed(String),
}

struct State {
    consent: Consent,
    session: Option<Arc<Session>>,
    starting: Option<watch::Receiver<Option<Outcome>>>,
    idle_close: Option<AbortHandle>,
}

pub struct RemoteDesktop {
    conn: Connection,
    policy: Policy,
    token_file: Option<PathBuf>,
    state: Mutex<State>,
    next_token: AtomicU32,
}

fn lock(state: &Mutex<State>) -> MutexGuard<'_, State> {
    state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// `$XDG_STATE_HOME/amical-desktop/helper/remote-desktop.token`, with the
/// XDG default under `$HOME`.
pub fn default_token_file() -> Option<PathBuf> {
    let state_home = std::env::var_os("XDG_STATE_HOME")
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/state"))
        })?;
    Some(state_home.join("amical-desktop/helper/remote-desktop.token"))
}

/// The object path of the Request that a call with `token` creates (the
/// portal spec's rule): the sender's unique name without the leading ':'
/// and with '.' as '_'.
fn request_path(unique_name: &str, token: &str) -> String {
    let sender = unique_name.trim_start_matches(':').replace('.', "_");
    format!("{PORTAL_PATH}/request/{sender}/{token}")
}

fn read_token(file: &Path) -> Option<String> {
    let token = std::fs::read_to_string(file).ok()?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_owned())
}

/// Writes the token readable by the user only, through a rename so that a
/// crash never leaves half a token.
fn write_token(file: &Path, token: &str) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)?;
    }
    let temporary = file.with_extension("token.new");
    let mut out = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&temporary)?;
    out.write_all(token.as_bytes())?;
    out.sync_all()?;
    std::fs::rename(&temporary, file)
}

impl RemoteDesktop {
    pub fn new(conn: Connection, policy: Policy, token_file: Option<PathBuf>) -> Arc<Self> {
        let consent = if token_file.as_deref().and_then(read_token).is_some() {
            Consent::Granted
        } else {
            Consent::Required
        };
        Arc::new(Self {
            conn,
            policy,
            token_file,
            state: Mutex::new(State {
                consent,
                session: None,
                starting: None,
                idle_close: None,
            }),
            next_token: AtomicU32::new(0),
        })
    }

    pub fn consent(&self) -> Consent {
        lock(&self.state).consent
    }

    /// A started session, waiting at most `wait` for it. A start that is
    /// still running after `wait` (the dialog is open) goes on in the
    /// background: a later call gets its session. `ask_again` starts a new
    /// attempt after a refusal (prepareInjection); otherwise a refusal is
    /// final for the life of the helper.
    pub async fn session(
        self: &Arc<Self>,
        wait: Duration,
        ask_again: bool,
    ) -> Result<(), Unavailable> {
        let mut starting = {
            let mut state = lock(&self.state);
            if let Some(idle_close) = state.idle_close.take() {
                idle_close.abort();
            }
            match &state.session {
                Some(session) if !session.closed.load(Ordering::Acquire) => return Ok(()),
                _ => state.session = None,
            }
            if state.consent == Consent::Denied && !ask_again {
                return Err(Unavailable::Denied);
            }
            match &state.starting {
                Some(starting) => starting.clone(),
                None => {
                    let (done, starting) = watch::channel(None);
                    state.starting = Some(starting.clone());
                    let this = self.clone();
                    tokio::spawn(async move { this.run_start(done).await });
                    starting
                }
            }
        };
        let outcome = tokio::time::timeout(wait, starting.wait_for(Option::is_some)).await;
        match outcome {
            Err(_) => Err(Unavailable::Pending),
            Ok(Err(_)) => Err(Unavailable::Failed("the start task stopped".to_owned())),
            Ok(Ok(outcome)) => match outcome.as_ref() {
                Some(Outcome::Started(_)) => Ok(()),
                Some(Outcome::Denied) => Err(Unavailable::Denied),
                Some(Outcome::Failed(reason)) => Err(Unavailable::Failed(reason.clone())),
                None => Err(Unavailable::Pending),
            },
        }
    }

    async fn run_start(self: Arc<Self>, done: watch::Sender<Option<Outcome>>) {
        let outcome = match tokio::time::timeout(START_LIMIT, self.start()).await {
            Ok(Ok(Some(session))) => Outcome::Started(session),
            Ok(Ok(None)) => Outcome::Denied,
            Ok(Err(error)) => Outcome::Failed(error.to_string()),
            Err(_) => Outcome::Failed(format!("no answer within {START_LIMIT:?}")),
        };
        {
            let mut state = lock(&self.state);
            state.starting = None;
            match &outcome {
                Outcome::Started(session) => {
                    state.consent = Consent::Granted;
                    state.session = Some(session.clone());
                }
                Outcome::Denied => state.consent = Consent::Denied,
                Outcome::Failed(_) => {}
            }
        }
        match &outcome {
            Outcome::Started(_) => {
                log!("Inject", "remote control session started");
                // Unused until the first chord: close it like an idle one.
                self.schedule_idle_close();
            }
            Outcome::Denied => log!("Inject", "remote control permission refused"),
            Outcome::Failed(reason) => log!("Inject", "remote control session failed: {reason}"),
        }
        let _ = done.send(Some(outcome));
    }

    /// CreateSession, SelectDevices (keyboard, persistent, with the saved
    /// token) and Start. None when the user refused.
    async fn start(self: &Arc<Self>) -> Result<Option<Arc<Session>>, Error> {
        let session_token = self.token();
        let mut options = Options::new();
        options.insert("session_handle_token", Value::from(session_token));
        let (code, results) = self
            .request("CreateSession", |handle| (with_handle(&options, handle),))
            .await?;
        if code != RESPONSE_SUCCESS {
            return Err(format!("CreateSession answered {code}").into());
        }
        let handle = String::try_from(
            results
                .get("session_handle")
                .ok_or("CreateSession gave no session handle")?
                .try_clone()?,
        )?;
        let handle = OwnedObjectPath::try_from(handle)?;
        let session = Arc::new(Session {
            handle,
            closed: AtomicBool::new(false),
        });
        self.watch_closed(&session).await;

        let mut options = Options::new();
        options.insert("types", Value::from(KEYBOARD));
        options.insert("persist_mode", Value::from(PERSIST_UNTIL_REVOKED));
        let saved = self.token_file.as_deref().and_then(read_token);
        if let Some(token) = &saved {
            options.insert("restore_token", Value::from(token.clone()));
        }
        let path = session.handle.as_ref();
        let (code, _) = self
            .request("SelectDevices", |handle| {
                (path.clone(), with_handle(&options, handle))
            })
            .await?;
        if code != RESPONSE_SUCCESS {
            self.close(&session).await;
            return Err(format!("SelectDevices answered {code}").into());
        }

        let options = Options::new();
        let (code, results) = self
            .request("Start", |handle| {
                (path.clone(), "", with_handle(&options, handle))
            })
            .await?;
        if code == RESPONSE_CANCELLED {
            self.close(&session).await;
            return Ok(None);
        }
        if code != RESPONSE_SUCCESS {
            self.close(&session).await;
            return Err(format!("Start answered {code}").into());
        }
        let devices = results
            .get("devices")
            .and_then(|value| u32::try_from(value.try_clone().ok()?).ok())
            .unwrap_or(0);
        if devices & KEYBOARD == 0 {
            self.close(&session).await;
            return Err("the keyboard was not granted".into());
        }
        let new_token = results
            .get("restore_token")
            .and_then(|value| String::try_from(value.try_clone().ok()?).ok());
        if let (Some(file), Some(token)) = (&self.token_file, new_token) {
            if saved.as_deref() != Some(token.as_str()) {
                if let Err(error) = write_token(file, &token) {
                    log!("Inject", "cannot save the restore token: {}", error.kind());
                }
            }
        }
        Ok(Some(session))
    }

    /// Calls a RemoteDesktop method that answers through a Request, and
    /// waits for the answer. The Response subscription exists before the
    /// call, so a quick answer is never missed.
    async fn request<B, F>(
        &self,
        method: &str,
        body: F,
    ) -> Result<(u32, HashMap<String, OwnedValue>), Error>
    where
        F: FnOnce(&str) -> B,
        B: serde::Serialize + zbus::zvariant::DynamicType,
    {
        let token = self.token();
        let unique_name = self
            .conn
            .unique_name()
            .ok_or("the bus connection has no unique name")?;
        let request: Proxy<'_> = ProxyBuilder::new(&self.conn)
            .destination(PORTAL_SERVICE)?
            .path(request_path(unique_name.as_str(), &token))?
            .interface(REQUEST)?
            .cache_properties(CacheProperties::No)
            .build()
            .await?;
        let mut responses = request.receive_signal("Response").await?;
        self.conn
            .call_method(
                Some(PORTAL_SERVICE),
                PORTAL_PATH,
                Some(REMOTE_DESKTOP),
                method,
                &body(&token),
            )
            .await
            .map_err(|error| format!("{method}: {}", error_name(&error)))?;
        let response = responses
            .next()
            .await
            .ok_or_else(|| format!("{method}: no Response"))?;
        Ok(response.body().deserialize()?)
    }

    fn token(&self) -> String {
        format!(
            "amical{}_{}",
            std::process::id(),
            self.next_token.fetch_add(1, Ordering::Relaxed)
        )
    }

    /// Marks the session closed when the portal closes it.
    async fn watch_closed(self: &Arc<Self>, session: &Arc<Session>) {
        let proxy = ProxyBuilder::new(&self.conn)
            .destination(PORTAL_SERVICE)
            .and_then(|builder| builder.path(session.handle.clone()))
            .and_then(|builder| builder.interface(SESSION));
        let proxy: Result<Proxy<'static>, zbus::Error> = match proxy {
            Ok(builder) => builder.cache_properties(CacheProperties::No).build().await,
            Err(error) => Err(error),
        };
        let mut closed = match proxy {
            Ok(proxy) => match proxy.receive_signal("Closed").await {
                Ok(closed) => closed,
                Err(error) => {
                    log!("Inject", "cannot watch the session: {}", error_name(&error));
                    return;
                }
            },
            Err(error) => {
                log!("Inject", "cannot watch the session: {}", error_name(&error));
                return;
            }
        };
        let this = Arc::downgrade(self);
        let session = session.clone();
        tokio::spawn(async move {
            if closed.next().await.is_some() {
                session.closed.store(true, Ordering::Release);
                if let Some(this) = this.upgrade() {
                    let mut state = lock(&this.state);
                    if state
                        .session
                        .as_ref()
                        .is_some_and(|current| Arc::ptr_eq(current, &session))
                    {
                        state.session = None;
                    }
                }
                log!("Inject", "the portal closed the remote control session");
            }
        });
    }

    /// Sends `codes` (evdev key codes) as one chord on the current session:
    /// presses in order, releases in reverse. Every release goes out even
    /// after a failed press, so that no key stays down.
    pub async fn send_chord(self: &Arc<Self>, codes: &[u16]) -> Result<(), String> {
        let session = lock(&self.state)
            .session
            .clone()
            .ok_or("no remote control session")?;
        let events = codes
            .iter()
            .map(|&code| (code, true))
            .chain(codes.iter().rev().map(|&code| (code, false)));
        let mut first_error = None;
        for (index, (code, down)) in events.enumerate() {
            if index > 0 {
                tokio::time::sleep(KEY_GAP).await;
            }
            let options: HashMap<&str, Value<'_>> = HashMap::new();
            let result = self
                .conn
                .call_method(
                    Some(PORTAL_SERVICE),
                    PORTAL_PATH,
                    Some(REMOTE_DESKTOP),
                    "NotifyKeyboardKeycode",
                    &(
                        session.handle.as_ref(),
                        options,
                        i32::from(code),
                        u32::from(down),
                    ),
                )
                .await;
            if let Err(error) = result {
                first_error.get_or_insert_with(|| error_name(&error));
            }
        }
        self.schedule_idle_close();
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    /// GNOME: closes the session `IDLE_CLOSE` from now, unless it is used
    /// again first.
    fn schedule_idle_close(self: &Arc<Self>) {
        if self.policy != Policy::CloseWhenIdle {
            return;
        }
        let this = Arc::downgrade(self);
        let task = tokio::spawn(async move {
            tokio::time::sleep(IDLE_CLOSE).await;
            let Some(this) = this.upgrade() else { return };
            let session = {
                let mut state = lock(&this.state);
                state.idle_close = None;
                state.session.take()
            };
            if let Some(session) = session {
                this.close(&session).await;
                log!(
                    "Inject",
                    "remote control session closed after {IDLE_CLOSE:?} idle"
                );
            }
        });
        let mut state = lock(&self.state);
        if let Some(previous) = state.idle_close.replace(task.abort_handle()) {
            previous.abort();
        }
    }

    async fn close(&self, session: &Session) {
        if session.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        let result = self
            .conn
            .call_method(
                Some(PORTAL_SERVICE),
                session.handle.as_ref(),
                Some(SESSION),
                "Close",
                &(),
            )
            .await;
        if let Err(error) = result {
            log!("Inject", "cannot close the session: {}", error_name(&error));
        }
    }

    /// Closes the session (helper exit).
    pub async fn shutdown(&self) {
        let session = {
            let mut state = lock(&self.state);
            if let Some(idle_close) = state.idle_close.take() {
                idle_close.abort();
            }
            state.session.take()
        };
        if let Some(session) = session {
            self.close(&session).await;
        }
    }
}

type Options = HashMap<&'static str, Value<'static>>;

/// `options` plus the `handle_token` of the Request.
fn with_handle(options: &Options, handle: &str) -> Options {
    let mut options: Options = options
        .iter()
        .filter_map(|(key, value)| Some((*key, value.try_clone().ok()?)))
        .collect();
    options.insert("handle_token", Value::from(handle.to_owned()));
    options
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_paths_follow_the_portal_rule() {
        assert_eq!(
            request_path(":1.42", "amical7_0"),
            "/org/freedesktop/portal/desktop/request/1_42/amical7_0"
        );
    }

    #[test]
    fn the_token_file_is_private_and_replaced_whole() {
        let dir = std::env::temp_dir().join(format!("rd-token-{}", std::process::id()));
        let file = dir.join("helper/remote-desktop.token");
        write_token(&file, "first").unwrap();
        write_token(&file, "second").unwrap();
        assert_eq!(read_token(&file).as_deref(), Some("second"));
        use std::os::unix::fs::PermissionsExt as _;
        let mode = std::fs::metadata(&file).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
