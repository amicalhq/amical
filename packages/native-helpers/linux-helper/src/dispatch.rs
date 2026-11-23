//! One handler per RPC method. This build has no key input, injection,
//! clipboard, AT-SPI or audio backend, so every handler gives the
//! schema-valid "not available" answer. The desktop turns every error answer
//! into a telemetry exception, so a method that it can call never answers
//! with an error for valid params.

use serde::Serialize;
use serde_json::Value;
use tokio::sync::OnceCell;

use crate::caps::{self, SessionEnv};
use crate::log::{log, Redacted};
use crate::models::*;
use crate::portal::{self, PortalProbe};
use crate::rpc::{optional, required, RpcError};
use crate::writer::Out;

pub struct Ctx {
    pub out: Out,
    env: SessionEnv,
    probe: OnceCell<Probe>,
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
        }
    }

    async fn capabilities(&self, app_id: Option<&str>) -> Capabilities {
        let probe = self
            .probe
            .get_or_init(|| async {
                let portal = portal::probe(app_id).await;
                let capabilities = caps::select(&self.env);
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
            log!(
                "Keys",
                "no key input backend; {} shortcuts not bound",
                params.shortcuts.as_ref().map_or(0, Vec::len)
            );
            to_value(SetShortcutsResult { success: true })
        }
        Method::SetDraftEnterCapture => {
            let _: SetDraftEnterCaptureParams = required(name, params)?;
            to_value(SetDraftEnterCaptureResult { success: true })
        }
        Method::SetAllowInjectedKeys => {
            let _: SetAllowInjectedKeysParams = required(name, params)?;
            to_value(SetAllowInjectedKeysResult { success: true })
        }
        Method::RecheckPressedKeys => {
            // Nothing is tracked, so nothing is stale.
            let _: RecheckPressedKeysParams = required(name, params)?;
            to_value(RecheckPressedKeysResult {
                stale_key_codes: Vec::new(),
            })
        }
        Method::GetSelectedTextViaCopy => {
            let _: GetSelectedTextViaCopyParams = optional(name, params)?;
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
            to_value(PrepareInjectionResult {
                ready: false,
                message: Some("This helper build has no injection backend".to_owned()),
            })
        }
    }
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
