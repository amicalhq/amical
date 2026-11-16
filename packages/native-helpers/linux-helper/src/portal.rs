//! XDG desktop portal facts on the session bus: the host-registry
//! registration and the version of each portal interface that a later
//! backend uses. Every failure is logged and leaves the portal unavailable;
//! none is fatal.

use std::collections::HashMap;
use std::time::Duration;

use zbus::zvariant::{OwnedValue, Value};
use zbus::Connection;

use crate::log::log;

const PORTAL_SERVICE: &str = "org.freedesktop.portal.Desktop";
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
const REGISTRY_INTERFACE: &str = "org.freedesktop.host.portal.Registry";
const PROPERTIES_INTERFACE: &str = "org.freedesktop.DBus.Properties";
/// Covers bus connection, registration and version reads. The desktop's
/// call timeout is 7 s.
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// 0 means that the portal does not have the interface.
pub struct PortalVersions {
    pub global_shortcuts: u32,
    pub remote_desktop: u32,
    pub clipboard: u32,
}

pub struct PortalProbe {
    versions: Option<PortalVersions>,
    /// The registry binds the app id to this connection, so it stays open
    /// for the life of the helper.
    _connection: Option<Connection>,
}

impl PortalProbe {
    fn unavailable() -> Self {
        Self {
            versions: None,
            _connection: None,
        }
    }

    pub fn summary(&self) -> String {
        match &self.versions {
            Some(v) => format!(
                "GlobalShortcuts v{} RemoteDesktop v{} Clipboard v{}",
                v.global_shortcuts, v.remote_desktop, v.clipboard
            ),
            None => "unavailable".to_owned(),
        }
    }
}

pub async fn probe(app_id: Option<&str>) -> PortalProbe {
    match tokio::time::timeout(PROBE_TIMEOUT, probe_bus(app_id)).await {
        Ok(Ok(probe)) => probe,
        Ok(Err(error)) => {
            log!("Portal", "no session bus: {error}");
            PortalProbe::unavailable()
        }
        Err(_) => {
            log!("Portal", "probe timed out after {PROBE_TIMEOUT:?}");
            PortalProbe::unavailable()
        }
    }
}

async fn probe_bus(app_id: Option<&str>) -> zbus::Result<PortalProbe> {
    let connection = Connection::session().await?;
    // The registry accepts an app id only before the first portal call on
    // the connection, so registration comes first.
    if let Some(app_id) = app_id {
        register(&connection, app_id).await;
    }
    let versions = versions(&connection).await;
    Ok(PortalProbe {
        versions,
        _connection: Some(connection),
    })
}

async fn register(connection: &Connection, app_id: &str) {
    let options: HashMap<&str, Value<'_>> = HashMap::new();
    let reply = connection
        .call_method(
            Some(PORTAL_SERVICE),
            PORTAL_PATH,
            Some(REGISTRY_INTERFACE),
            "Register",
            &(app_id, options),
        )
        .await;
    match reply {
        Ok(_) => log!("Portal", "registered app id {app_id:?}"),
        // Portals older than the registry do not have it. Without it the
        // portal knows no app id for the helper.
        Err(error) => log!("Portal", "registration failed: {}", error_name(&error)),
    }
}

async fn versions(connection: &Connection) -> Option<PortalVersions> {
    let (global_shortcuts, remote_desktop, clipboard) = tokio::join!(
        version_of(connection, "org.freedesktop.portal.GlobalShortcuts"),
        version_of(connection, "org.freedesktop.portal.RemoteDesktop"),
        version_of(connection, "org.freedesktop.portal.Clipboard"),
    );
    for result in [&global_shortcuts, &remote_desktop, &clipboard] {
        if let Err(error) = result {
            if portal_is_missing(error) {
                log!("Portal", "no portal service: {}", error_name(error));
                return None;
            }
        }
    }
    // Any other error means that the portal does not have the interface.
    Some(PortalVersions {
        global_shortcuts: global_shortcuts.unwrap_or(0),
        remote_desktop: remote_desktop.unwrap_or(0),
        clipboard: clipboard.unwrap_or(0),
    })
}

async fn version_of(connection: &Connection, interface: &str) -> zbus::Result<u32> {
    let reply = connection
        .call_method(
            Some(PORTAL_SERVICE),
            PORTAL_PATH,
            Some(PROPERTIES_INTERFACE),
            "Get",
            &(interface, "version"),
        )
        .await?;
    let value: OwnedValue = reply.body().deserialize()?;
    Ok(u32::try_from(value)?)
}

fn portal_is_missing(error: &zbus::Error) -> bool {
    matches!(
        error,
        zbus::Error::MethodError(name, _, _)
            if name.as_str() == "org.freedesktop.DBus.Error.ServiceUnknown"
                || name.as_str() == "org.freedesktop.DBus.Error.NameHasNoOwner"
    )
}

/// For a D-Bus error, its name only: never the message text.
fn error_name(error: &zbus::Error) -> String {
    match error {
        zbus::Error::MethodError(name, _, _) => name.to_string(),
        other => other.to_string(),
    }
}
