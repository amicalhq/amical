//! Session detection and backend selection for getHelperCapabilities.
//!
//! Each capability gets the first backend, in a fixed order per session, that
//! is built in and whose own probe passes (X connection and XI2, portal
//! session, Wayland globals, device access). The later tasks add each backend
//! together with its probe:
//! - key input: xi2, xi2-xwayland, evdev (opt-in), portal-global-shortcuts
//! - injection: xtest, portal-remote-desktop, wl-virtual-keyboard, uinput
//! - clipboard: x11, wl-data-control, portal-clipboard, wl-copy
//! - accessibility context: AT-SPI; sounds and mute: audio tools
//!
//! This build has the X11 backend (xi2, xtest, x11) for X11 sessions, and
//! on Wayland sessions the RemoteDesktop portal for paste keys with the
//! Xwayland clipboard (GNOME).

use crate::models::{
    Capabilities, ChordConsume, ClipboardBackend, Evdev, EvdevReason, HoldSupport,
    InjectionBackend, InjectionConsent, KeyInputBackend, KeyInputMode, SessionType,
};

/// The environment variables that the probe reads, captured at startup.
#[derive(Debug, Default)]
pub struct SessionEnv {
    pub xdg_session_type: Option<String>,
    pub wayland_display: Option<String>,
    pub display: Option<String>,
    pub xdg_current_desktop: Option<String>,
}

impl SessionEnv {
    pub fn from_process() -> Self {
        let var = |name: &str| {
            std::env::var_os(name)
                .map(|value| value.to_string_lossy().into_owned())
                .filter(|value| !value.is_empty())
        };
        Self {
            xdg_session_type: var("XDG_SESSION_TYPE"),
            wayland_display: var("WAYLAND_DISPLAY"),
            display: var("DISPLAY"),
            xdg_current_desktop: var("XDG_CURRENT_DESKTOP"),
        }
    }
}

pub fn session_type(env: &SessionEnv) -> SessionType {
    // XDG_SESSION_TYPE decides when it names a graphical session. Otherwise
    // (unset, or "tty" when started from a terminal) WAYLAND_DISPLAY wins over
    // DISPLAY, because a Wayland session also sets DISPLAY for Xwayland.
    match env.xdg_session_type.as_deref() {
        Some("wayland") => SessionType::Wayland,
        Some("x11") => SessionType::X11,
        _ if env.wayland_display.is_some() => SessionType::Wayland,
        _ if env.display.is_some() => SessionType::X11,
        _ => SessionType::Unknown,
    }
}

/// What the connected backends can do.
#[derive(Clone, Debug, Default)]
pub struct Backends {
    /// XInput 2 key input and consumption (X11 sessions).
    pub xi2: bool,
    pub injection: Option<(InjectionBackend, InjectionConsent)>,
    pub clipboard: Option<ClipboardBackend>,
}

/// True when XDG_CURRENT_DESKTOP names `name`. It can list several
/// desktops, separated by ':' (for example "ubuntu:GNOME").
pub fn desktop_is(env: &SessionEnv, name: &str) -> bool {
    env.xdg_current_desktop.as_deref().is_some_and(|desktops| {
        desktops
            .split(':')
            .any(|desktop| desktop.eq_ignore_ascii_case(name))
    })
}

pub fn select(env: &SessionEnv, backends: Backends) -> Capabilities {
    let key_input = backends.xi2;
    let mut missing = Vec::new();
    for (available, name) in [
        (key_input, "key input"),
        (
            backends.injection.is_some() && backends.clipboard.is_some(),
            "paste",
        ),
        (backends.clipboard.is_some(), "clipboard"),
        (false, "accessibility"),
        (false, "sound"),
    ] {
        if !available {
            missing.push(name);
        }
    }
    Capabilities {
        key_input_mode: if key_input {
            KeyInputMode::PerKey
        } else {
            KeyInputMode::None
        },
        key_input_backend: key_input.then_some(KeyInputBackend::Xi2),
        hold_support: if key_input {
            HoldSupport::Any
        } else {
            HoldSupport::TapOnly
        },
        chord: None,
        evdev: Evdev {
            available: false,
            reason: Some(EvdevReason::NotBuilt),
        },
        chord_consume: if key_input {
            ChordConsume::Helper
        } else {
            ChordConsume::None
        },
        injection_available: backends.injection.is_some(),
        injection_backend: backends.injection.clone().map(|(backend, _)| backend),
        injection_consent: backends
            .injection
            .map_or(InjectionConsent::None, |(_, consent)| consent),
        clipboard_backend: backends.clipboard,
        clipboard_steals_focus: false,
        accessibility_context_available: false,
        ambiance_available: false,
        session_type: session_type(env),
        // XDG_CURRENT_DESKTOP as read, for example "ubuntu:GNOME".
        desktop: env.xdg_current_desktop.clone(),
        helper_version: Some(env!("CARGO_PKG_VERSION").to_owned()),
        message: Some(format!(
            "This helper build has no {} backend",
            join_names(&missing)
        )),
    }
}

/// "a, b or c".
fn join_names(names: &[&str]) -> String {
    match names.split_last() {
        None => String::new(),
        Some((last, [])) => (*last).to_owned(),
        Some((last, rest)) => format!("{} or {last}", rest.join(", ")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_type_comes_from_the_environment() {
        // XDG_SESSION_TYPE, WAYLAND_DISPLAY, DISPLAY, expected type
        #[rustfmt::skip]
        let rows = [
            (Some("x11"), None, Some(":0"), SessionType::X11),
            // Xwayland's DISPLAY does not make a Wayland session X11.
            (Some("wayland"), Some("wayland-0"), Some(":0"), SessionType::Wayland),
            (Some("x11"), Some("wayland-0"), Some(":1"), SessionType::X11),
            // Started from a terminal inside a Wayland session.
            (Some("tty"), Some("wayland-1"), None, SessionType::Wayland),
            (None, None, Some(":0"), SessionType::X11),
            (None, None, None, SessionType::Unknown),
        ];
        for (xdg_session_type, wayland_display, display, expected) in rows {
            let env = SessionEnv {
                xdg_session_type: xdg_session_type.map(str::to_owned),
                wayland_display: wayland_display.map(str::to_owned),
                display: display.map(str::to_owned),
                xdg_current_desktop: None,
            };
            assert_eq!(session_type(&env), expected, "{env:?}");
        }
    }

    #[test]
    fn a_connected_x11_backend_gives_its_capabilities() {
        let full = Backends {
            xi2: true,
            injection: Some((InjectionBackend::Xtest, InjectionConsent::None)),
            clipboard: Some(ClipboardBackend::X11),
        };
        let x11 = SessionEnv {
            xdg_session_type: Some("x11".to_owned()),
            display: Some(":0".to_owned()),
            ..SessionEnv::default()
        };
        let capabilities = select(&x11, full);
        assert_eq!(capabilities.key_input_mode, KeyInputMode::PerKey);
        assert_eq!(capabilities.key_input_backend, Some(KeyInputBackend::Xi2));
        assert_eq!(capabilities.hold_support, HoldSupport::Any);
        assert_eq!(capabilities.chord_consume, ChordConsume::Helper);
        assert_eq!(
            capabilities.injection_backend,
            Some(InjectionBackend::Xtest)
        );
        assert_eq!(capabilities.clipboard_backend, Some(ClipboardBackend::X11));
        assert_eq!(
            capabilities.message.as_deref(),
            Some("This helper build has no accessibility or sound backend")
        );
    }
}
