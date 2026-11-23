//! One handler per RPC method. On an X11 session the X11 backend answers
//! the key, paste and clipboard methods. Everything else (and every method
//! on other sessions) gives the schema-valid "not available" answer. The
//! desktop turns every error answer into a telemetry exception, so a method
//! that it can call never answers with an error for valid params.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::sync::{Notify, OnceCell};

use crate::caps::{self, Backends, SessionEnv};
use crate::data_control::DataControl;
use crate::log::{log, Redacted};
use crate::models::*;
use crate::portal::{self, PortalProbe};
use crate::remote_desktop::{self, Consent, Policy, RemoteDesktop};
use crate::rpc::{optional, required, RpcError};
use crate::writer::Out;
use crate::x11::{ChordSender, PasteRoute, WaylandClipboard, X11Backend};

/// Covers the three X connections and their setup. The desktop's call
/// timeout is 7 s.
const X11_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// How long a paste waits for the remote control session. A restored
/// session starts in well under this; a longer wait means that the consent
/// dialog is open, and the desktop then shows the transcript on the
/// clipboard instead.
const SESSION_WAIT: Duration = Duration::from_secs(1);
/// How long prepareInjection waits for the user to answer the dialog. The
/// desktop gives this call a longer timeout than this.
const PREPARE_WAIT: Duration = Duration::from_secs(110);

pub struct Ctx {
    pub out: Out,
    env: SessionEnv,
    probe: OnceCell<Probe>,
    x11: OnceCell<Option<Arc<X11Backend>>>,
    wayland: OnceCell<Wayland>,
    /// Notified when an X connection closes.
    x11_lost: Arc<Notify>,
}

/// The first capability request runs the probe; later requests reuse it.
struct Probe {
    portal: PortalProbe,
    /// The app id the portal registration ran with, if any.
    app_id: Option<String>,
}

/// The backends of a Wayland session.
#[derive(Default)]
struct Wayland {
    /// The RemoteDesktop portal, for the paste and copy keys.
    injector: Option<Arc<RemoteDesktop>>,
    /// The clipboard of the paste route, and its kind.
    clipboard: Option<(Arc<dyn PasteRoute>, ClipboardBackend)>,
}

/// Sends chords through the RemoteDesktop portal from a blocking thread.
struct PortalChords {
    injector: Arc<RemoteDesktop>,
    runtime: tokio::runtime::Handle,
}

impl ChordSender for PortalChords {
    fn send(&self, codes: &[u16]) -> Result<(), String> {
        self.runtime.block_on(async {
            // The portal may have closed the session since the paste began.
            self.injector
                .session(SESSION_WAIT, false)
                .await
                .map_err(|unavailable| unavailable.message())?;
            self.injector.send_chord(codes).await
        })
    }
}

impl Ctx {
    pub fn new(out: Out, env: SessionEnv) -> Self {
        Self {
            out,
            env,
            probe: OnceCell::new(),
            x11: OnceCell::new(),
            wayland: OnceCell::new(),
            x11_lost: Arc::new(Notify::new()),
        }
    }

    /// The X11 backend on an X11 session, connected at the first call. On
    /// other sessions P1 has no backend: connecting there could start
    /// Xwayland, and its routes are not the ones those sessions use.
    pub async fn x11(&self) -> Option<Arc<X11Backend>> {
        self.x11
            .get_or_init(|| async {
                if caps::session_type(&self.env) != SessionType::X11 {
                    return None;
                }
                let display = self.env.display.clone();
                let (events, lost) = (self.out.downgrade(), self.x11_lost.clone());
                let connect = tokio::task::spawn_blocking(move || {
                    X11Backend::connect(display.as_deref(), events, lost)
                });
                match tokio::time::timeout(X11_CONNECT_TIMEOUT, connect).await {
                    Ok(Ok(Ok(backend))) => Some(Arc::new(backend)),
                    Ok(Ok(Err(error))) => {
                        log!("X11", "cannot use the X server: {error}");
                        None
                    }
                    Ok(Err(error)) => {
                        log!("X11", "the X11 setup stopped: {error}");
                        None
                    }
                    Err(_) => {
                        log!("X11", "no X connection within {X11_CONNECT_TIMEOUT:?}");
                        None
                    }
                }
            })
            .await
            .clone()
    }

    /// Completes when the X11 backend has lost its X connection.
    pub async fn x11_lost(&self) {
        self.x11_lost.notified().await;
    }

    /// Undoes what the backends changed (key grabs).
    pub async fn shutdown(&self) {
        if let Some(Some(backend)) = self.x11.get() {
            backend.shutdown();
        }
        if let Some(injector) = self
            .wayland
            .get()
            .and_then(|wayland| wayland.injector.as_ref())
        {
            injector.shutdown().await;
        }
    }

    /// The portal probe, run once. Registration needs the app id, so the
    /// first call should carry it.
    async fn probe(&self, app_id: Option<&str>) -> &Probe {
        let probe = self
            .probe
            .get_or_init(|| async {
                let (portal, _) = tokio::join!(portal::probe(app_id), self.x11());
                log!(
                    "Caps",
                    "session={:?} desktop={} portal={}",
                    caps::session_type(&self.env),
                    self.env.xdg_current_desktop.as_deref().unwrap_or("unset"),
                    portal.summary()
                );
                Probe {
                    portal,
                    app_id: app_id.map(str::to_owned),
                }
            })
            .await;
        // The desktop sends getHelperCapabilities with its app id first; a
        // later id cannot register any more.
        if app_id.is_some() && probe.app_id.is_none() {
            log!(
                "Caps",
                "app id arrived after the probe ran; portal registration skipped"
            );
        }
        probe
    }

    /// The Wayland backends on a Wayland session, set up at the first call.
    async fn wayland(&self) -> &Wayland {
        self.wayland
            .get_or_init(|| async {
                if caps::session_type(&self.env) != SessionType::Wayland {
                    return Wayland::default();
                }
                let portal = &self.probe(None).await.portal;
                let injector = match (portal.connection(), portal.versions()) {
                    (Some(connection), Some(versions)) if versions.remote_desktop >= 1 => {
                        // KDE shows a notification each time a restored
                        // session starts, so it keeps one.
                        let policy = if caps::desktop_is(&self.env, "KDE") {
                            Policy::Keep
                        } else {
                            Policy::CloseWhenIdle
                        };
                        Some(RemoteDesktop::new(
                            connection.clone(),
                            policy,
                            remote_desktop::default_token_file(),
                        ))
                    }
                    _ => None,
                };
                let clipboard = if caps::desktop_is(&self.env, "GNOME") {
                    self.xwayland_clipboard().await
                } else if caps::desktop_is(&self.env, "KDE") {
                    self.data_control_clipboard().await
                } else {
                    None
                };
                Wayland {
                    injector,
                    clipboard,
                }
            })
            .await
    }

    /// Xwayland's CLIPBOARD, which GNOME bridges both ways.
    async fn xwayland_clipboard(&self) -> Option<(Arc<dyn PasteRoute>, ClipboardBackend)> {
        let display = self.env.display.clone()?;
        let lost = self.x11_lost.clone();
        let connect =
            tokio::task::spawn_blocking(move || WaylandClipboard::xwayland(Some(&display), lost));
        match tokio::time::timeout(X11_CONNECT_TIMEOUT, connect).await {
            Ok(Ok(Ok(clipboard))) => Some((Arc::new(clipboard), ClipboardBackend::X11)),
            Ok(Ok(Err(error))) => {
                log!("X11", "no Xwayland clipboard: {error}");
                None
            }
            Ok(Err(error)) => {
                log!("X11", "the Xwayland clipboard setup stopped: {error}");
                None
            }
            Err(_) => {
                log!(
                    "X11",
                    "no Xwayland connection within {X11_CONNECT_TIMEOUT:?}"
                );
                None
            }
        }
    }

    /// The data-control clipboard (KDE reads Wayland selections only
    /// through it; its Xwayland bridge passes them to X clients only while
    /// an X window is active).
    async fn data_control_clipboard(&self) -> Option<(Arc<dyn PasteRoute>, ClipboardBackend)> {
        let display = self.env.display.clone()?;
        let lost = self.x11_lost.clone();
        let connect = tokio::task::spawn_blocking(move || {
            let selection = DataControl::connect(lost)?;
            WaylandClipboard::with_selection(Some(&display), selection)
        });
        match tokio::time::timeout(X11_CONNECT_TIMEOUT, connect).await {
            Ok(Ok(Ok(clipboard))) => Some((Arc::new(clipboard), ClipboardBackend::WlDataControl)),
            Ok(Ok(Err(error))) => {
                log!("Clipboard", "no data-control clipboard: {error}");
                None
            }
            Ok(Err(error)) => {
                log!("Clipboard", "the data-control setup stopped: {error}");
                None
            }
            Err(_) => {
                log!(
                    "Clipboard",
                    "no data-control clipboard within {X11_CONNECT_TIMEOUT:?}"
                );
                None
            }
        }
    }

    /// What the backends of this session can do now. The probe runs once;
    /// the consent state is read at each call.
    async fn backends(&self) -> Backends {
        if let Some(backend) = self.x11().await {
            let features = backend.features();
            return Backends {
                xi2: true,
                injection: features
                    .injection
                    .then_some((InjectionBackend::Xtest, InjectionConsent::None)),
                clipboard: features.clipboard.then_some(ClipboardBackend::X11),
            };
        }
        let wayland = self.wayland().await;
        Backends {
            xi2: false,
            injection: wayland.injector.as_ref().map(|injector| {
                let consent = match injector.consent() {
                    Consent::Granted => InjectionConsent::Granted,
                    Consent::Required => InjectionConsent::Required,
                    Consent::Denied => InjectionConsent::Denied,
                };
                (InjectionBackend::PortalRemoteDesktop, consent)
            }),
            clipboard: wayland
                .clipboard
                .as_ref()
                .map(|(_, backend)| backend.clone()),
        }
    }

    async fn capabilities(&self, app_id: Option<&str>) -> Capabilities {
        self.probe(app_id).await;
        caps::select(&self.env, self.backends().await)
    }

    /// The Wayland paste route: the portal sends the keys, Xwayland holds
    /// the clipboard. None when the session has no such route.
    async fn wayland_routes(&self) -> Option<(Arc<RemoteDesktop>, Arc<dyn PasteRoute>)> {
        let wayland = self.wayland().await;
        Some((
            wayland.injector.clone()?,
            wayland.clipboard.as_ref()?.0.clone(),
        ))
    }
}

/// The method enum generated from the request schema, or None for a name
/// that the protocol does not have.
pub fn method(name: &str) -> Option<Method> {
    serde_json::from_value(Value::String(name.to_owned())).ok()
}

pub async fn handle(
    ctx: &Ctx,
    method: Method,
    name: &str,
    params: Option<Value>,
) -> Result<Value, RpcError> {
    match method {
        Method::GetAccessibilityTreeDetails => {
            let _: GetAccessibilityTreeDetailsParams = optional(name, params)?;
            to_value(GetAccessibilityTreeDetailsResult { tree: None })
        }
        Method::GetAccessibilityContext => {
            let _: GetAccessibilityContextParams = optional(name, params)?;
            to_value(GetAccessibilityContextResult { context: None })
        }
        Method::GetAccessibilityStatus => {
            let _: GetAccessibilityStatusParams = optional(name, params)?;
            to_value(GetAccessibilityStatusResult {
                has_permission: false,
                is_enabled: false,
            })
        }
        Method::RequestAccessibilityPermission => {
            let _: RequestAccessibilityPermissionParams = optional(name, params)?;
            to_value(RequestAccessibilityPermissionResult { granted: false })
        }
        Method::PasteText => {
            // The transcript must not reach an error message either.
            let params: PasteTextParams =
                required(name, params).map_err(RpcError::without_content)?;
            let preserve = params.preserve_clipboard.unwrap_or(true);
            if let Some(backend) = ctx.x11().await {
                let result = blocking(move || backend.paste(&params.transcript, preserve)).await?;
                return to_value(result);
            }
            if let Some((injector, clipboard)) = ctx.wayland_routes().await {
                if let Err(unavailable) = injector.session(SESSION_WAIT, false).await {
                    log!(
                        "Paste",
                        "{}; transcript {}",
                        unavailable.message(),
                        Redacted(&params.transcript)
                    );
                    // clipboardSet false: the desktop puts the transcript
                    // on the clipboard and tells the user.
                    return to_value(PasteTextResult {
                        success: false,
                        clipboard_set: Some(false),
                        message: Some(unavailable.message()),
                    });
                }
                let sender = PortalChords {
                    injector,
                    runtime: tokio::runtime::Handle::current(),
                };
                let result =
                    blocking(move || clipboard.paste(&sender, &params.transcript, preserve))
                        .await?;
                return to_value(result);
            }
            log!(
                "Paste",
                "no paste backend; transcript {}",
                Redacted(&params.transcript)
            );
            // clipboardSet false: the desktop puts the transcript on the
            // clipboard itself.
            to_value(PasteTextResult {
                success: false,
                clipboard_set: Some(false),
                message: Some("This helper build cannot paste".to_owned()),
            })
        }
        Method::StartRecording => {
            let params: StartRecordingParams = required(name, params)?;
            // No sound to play and no mute: success only if no mute was asked.
            to_value(StartRecordingResult {
                success: !params.mute_system_audio,
                message: params
                    .mute_system_audio
                    .then(|| "This helper build cannot mute system audio".to_owned()),
            })
        }
        Method::StopRecording => {
            let params: StopRecordingParams = required(name, params)?;
            to_value(StopRecordingResult {
                success: !params.was_muted,
                message: params
                    .was_muted
                    .then(|| "This helper build cannot restore system audio".to_owned()),
            })
        }
        Method::SetShortcuts => {
            let params: SetShortcutsParams = required(name, params)?;
            if let Some(backend) = ctx.x11().await {
                let (chords, ids) = chords_with_ids(params);
                blocking(move || backend.set_shortcuts(chords, ids)).await?;
                return to_value(SetShortcutsResult { success: true });
            }
            log!(
                "Keys",
                "no key input backend; {} shortcuts not bound",
                params.shortcuts.as_ref().map_or(0, Vec::len)
            );
            to_value(SetShortcutsResult { success: true })
        }
        Method::SetDraftEnterCapture => {
            let params: SetDraftEnterCaptureParams = required(name, params)?;
            if let Some(backend) = ctx.x11().await {
                blocking(move || backend.set_draft_enter_capture(params.enabled)).await?;
            }
            to_value(SetDraftEnterCaptureResult { success: true })
        }
        Method::SetAllowInjectedKeys => {
            let params: SetAllowInjectedKeysParams = required(name, params)?;
            if let Some(backend) = ctx.x11().await {
                backend.set_allow_injected_keys(params.enabled);
            }
            to_value(SetAllowInjectedKeysResult { success: true })
        }
        Method::RecheckPressedKeys => {
            let params: RecheckPressedKeysParams = required(name, params)?;
            // Without key input nothing is tracked, so nothing is stale.
            let stale_key_codes = match ctx.x11().await {
                Some(backend) => {
                    blocking(move || backend.stale_keys(&params.pressed_key_codes)).await?
                }
                None => Vec::new(),
            };
            to_value(RecheckPressedKeysResult { stale_key_codes })
        }
        Method::GetSelectedTextViaCopy => {
            let _: GetSelectedTextViaCopyParams = optional(name, params)?;
            if let Some(backend) = ctx.x11().await {
                return to_value(blocking(move || backend.copy_selection()).await?);
            }
            if let Some((injector, clipboard)) = ctx.wayland_routes().await {
                if let Err(unavailable) = injector.session(SESSION_WAIT, false).await {
                    return to_value(GetSelectedTextViaCopyResult {
                        selected_text: None,
                        clipboard_changed: false,
                        message: Some(unavailable.message()),
                    });
                }
                let sender = PortalChords {
                    injector,
                    runtime: tokio::runtime::Handle::current(),
                };
                return to_value(blocking(move || clipboard.copy_selection(&sender)).await?);
            }
            to_value(GetSelectedTextViaCopyResult {
                selected_text: None,
                clipboard_changed: false,
                message: Some("This helper build cannot copy the selection".to_owned()),
            })
        }
        Method::StartEditWatch => {
            let _: StartEditWatchParams = optional(name, params)?;
            to_value(StartEditWatchResult {
                watch_id: None,
                start_status: StartStatus::NoElement,
            })
        }
        Method::ReadEditWatch => {
            let _: ReadEditWatchParams = required(name, params)?;
            to_value(ReadEditWatchResult {
                read_status: ReadStatus::UnknownWatch,
                text: None,
                selection: None,
                read_ms: 0.0,
            })
        }
        Method::StopEditWatch => {
            let _: StopEditWatchParams = required(name, params)?;
            to_value(StopEditWatchResult { stopped: false })
        }
        Method::GetHelperCapabilities => {
            let params: GetHelperCapabilitiesParams = optional(name, params)?;
            to_value(ctx.capabilities(params.app_id.as_deref()).await)
        }
        Method::SetHelperOptions => {
            let params: SetHelperOptionsParams = optional(name, params)?;
            if params.evdev_key_input == Some(true) {
                log!(
                    "Keys",
                    "evdev key input asked for; this build has no evdev reader"
                );
            }
            to_value(SetHelperOptionsResult {
                success: true,
                capabilities: ctx.capabilities(None).await,
            })
        }
        Method::PrepareInjection => {
            let _: PrepareInjectionParams = optional(name, params)?;
            // XTest on an X11 session needs no consent.
            if ctx
                .x11()
                .await
                .is_some_and(|backend| backend.features().injection)
            {
                return to_value(PrepareInjectionResult {
                    ready: true,
                    message: None,
                });
            }
            if let Some(injector) = ctx.wayland().await.injector.clone() {
                // Shows the portal dialog when there is no saved consent,
                // also after an earlier refusal.
                let result = injector.session(PREPARE_WAIT, true).await;
                return to_value(PrepareInjectionResult {
                    ready: result.is_ok(),
                    message: result.err().map(|unavailable| unavailable.message()),
                });
            }
            to_value(PrepareInjectionResult {
                ready: false,
                message: Some("This helper build has no injection backend".to_owned()),
            })
        }
    }
}

/// Runs backend work (X round trips, waits) off the async workers.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, RpcError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|_| RpcError::internal("the X11 backend task stopped"))
}

/// Every chord of both groups (the consume gate treats them alike), with a
/// name for each in logs: the id of the shortcut with the same keys, or its
/// index. Never the key codes.
fn chords_with_ids(params: SetShortcutsParams) -> (Vec<Vec<i64>>, Vec<String>) {
    let shortcuts = params.shortcuts.unwrap_or_default();
    let chords: Vec<Vec<i64>> = params
        .subset_chords
        .into_iter()
        .chain(params.exact_chords)
        .collect();
    let ids = chords
        .iter()
        .enumerate()
        .map(|(index, chord)| {
            let mut keys = chord.clone();
            keys.sort_unstable();
            shortcuts
                .iter()
                .find(|shortcut| {
                    let mut codes = shortcut.key_codes.clone();
                    codes.sort_unstable();
                    codes == keys
                })
                .map_or_else(|| format!("chord {index}"), |shortcut| shortcut.id.clone())
        })
        .collect();
    (chords, ids)
}

fn to_value<T: Serialize>(result: T) -> Result<Value, RpcError> {
    serde_json::to_value(result).map_err(|error| RpcError::internal(&error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rpc::INVALID_PARAMS;
    use crate::writer;
    use serde_json::json;

    async fn call(name: &str, params: Option<Value>) -> Result<Value, RpcError> {
        let (out, _lines) = writer::channel();
        let ctx = Ctx::new(out, SessionEnv::default());
        handle(&ctx, method(name).unwrap(), name, params).await
    }

    #[tokio::test]
    async fn no_x_connection_outside_x11_sessions() {
        // Xwayland's DISPLAY in a Wayland session must not reach the X11
        // backend: connecting could start Xwayland.
        let (out, _lines) = writer::channel();
        let env = SessionEnv {
            xdg_session_type: Some("wayland".to_owned()),
            wayland_display: Some("wayland-0".to_owned()),
            display: Some(":0".to_owned()),
            xdg_current_desktop: None,
        };
        assert!(Ctx::new(out, env).x11().await.is_none());
    }

    #[tokio::test]
    async fn params_errors_follow_the_contract() {
        for params in [None, Some(Value::Null)] {
            assert_eq!(
                call("setShortcuts", params).await,
                Err(RpcError {
                    code: INVALID_PARAMS,
                    message: "Missing params for setShortcuts".to_owned(),
                    data: None,
                })
            );
        }

        let bad = json!({ "subsetChords": "not chords", "exactChords": [] });
        let error = call("setShortcuts", Some(bad.clone())).await.unwrap_err();
        assert_eq!(error.code, INVALID_PARAMS);
        assert!(error
            .message
            .starts_with("Invalid params for setShortcuts: "));
        assert_eq!(error.data, Some(bad));

        // A decode error can quote a param value; for pasteText that could be
        // the transcript.
        let canary = "transcript canary";
        let paste = json!({ "transcript": canary, "preserveClipboard": canary });
        assert_eq!(
            call("pasteText", Some(paste)).await,
            Err(RpcError {
                code: INVALID_PARAMS,
                message: "Invalid params for pasteText".to_owned(),
                data: None,
            })
        );

        // Methods whose params are all optional accept absent params.
        assert_eq!(
            call("startEditWatch", None).await,
            Ok(json!({ "watchId": null, "startStatus": "no_element" }))
        );
    }
}
