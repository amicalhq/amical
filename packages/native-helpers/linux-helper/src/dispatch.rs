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

use crate::caps::{self, SessionEnv};
use crate::log::{log, Redacted};
use crate::models::*;
use crate::portal::{self, PortalProbe};
use crate::rpc::{optional, required, RpcError};
use crate::writer::Out;
use crate::x11::X11Backend;

/// Covers the three X connections and their setup. The desktop's call
/// timeout is 7 s.
const X11_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

pub struct Ctx {
    pub out: Out,
    env: SessionEnv,
    probe: OnceCell<Probe>,
    x11: OnceCell<Option<Arc<X11Backend>>>,
    /// Notified when the X11 backend loses its X connection.
    x11_lost: Arc<Notify>,
}

/// The first capability request runs the probe; later requests reuse it.
struct Probe {
    capabilities: Capabilities,
    _portal: PortalProbe,
    /// The app id the portal registration ran with, if any.
    app_id: Option<String>,
}

impl Ctx {
    pub fn new(out: Out, env: SessionEnv) -> Self {
        Self {
            out,
            env,
            probe: OnceCell::new(),
            x11: OnceCell::new(),
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
    pub fn shutdown(&self) {
        if let Some(Some(backend)) = self.x11.get() {
            backend.shutdown();
        }
    }

    async fn capabilities(&self, app_id: Option<&str>) -> Capabilities {
        let probe = self
            .probe
            .get_or_init(|| async {
                let (portal, x11) = tokio::join!(portal::probe(app_id), self.x11());
                let capabilities = caps::select(&self.env, x11.map(|backend| backend.features()));
                log!(
                    "Caps",
                    "session={:?} desktop={} portal={}",
                    capabilities.session_type,
                    capabilities.desktop.as_deref().unwrap_or("unset"),
                    portal.summary()
                );
                Probe {
                    capabilities,
                    _portal: portal,
                    app_id: app_id.map(str::to_owned),
                }
            })
            .await;
        // The probe runs once. The desktop sends getHelperCapabilities with
        // its app id first; a later id cannot register any more.
        if app_id.is_some() && probe.app_id.is_none() {
            log!(
                "Caps",
                "app id arrived after the probe ran; portal registration skipped"
            );
        }
        probe.capabilities.clone()
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
            if let Some(backend) = ctx.x11().await {
                let preserve = params.preserve_clipboard.unwrap_or(true);
                let result = blocking(move || backend.paste(&params.transcript, preserve)).await?;
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
