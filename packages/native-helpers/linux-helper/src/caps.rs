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
//! This build has none of them, so every capability is unavailable, whatever
//! the session offers.

use crate::models::{
    Capabilities, ChordConsume, Evdev, EvdevReason, HoldSupport, InjectionConsent, KeyInputMode,
    SessionType,
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

fn session_type(env: &SessionEnv) -> SessionType {
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

pub fn select(env: &SessionEnv) -> Capabilities {
    Capabilities {
        key_input_mode: KeyInputMode::None,
        key_input_backend: None,
        hold_support: HoldSupport::TapOnly,
        chord: None,
        evdev: Evdev {
            available: false,
            reason: Some(EvdevReason::NotBuilt),
        },
        chord_consume: ChordConsume::None,
        injection_available: false,
        injection_backend: None,
        injection_consent: InjectionConsent::None,
        clipboard_backend: None,
        clipboard_steals_focus: false,
        accessibility_context_available: false,
        ambiance_available: false,
        session_type: session_type(env),
        // XDG_CURRENT_DESKTOP as read, for example "ubuntu:GNOME".
        desktop: env.xdg_current_desktop.clone(),
        helper_version: Some(env!("CARGO_PKG_VERSION").to_owned()),
        message: Some(
            "This helper build has no key input, paste, clipboard, accessibility or sound backend"
                .to_owned(),
        ),
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
}
