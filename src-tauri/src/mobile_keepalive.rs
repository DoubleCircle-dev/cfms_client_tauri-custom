//! Mobile keep-alive bridge for the background file-update check.
//!
//! [`crate::file_auto_check`] owns the schedule, but on Android the OS freezes
//! (and eventually reclaims) any process that has no foreground service, so a
//! timer alone would not survive the app being backgrounded. This module turns
//! the "automatic checks are enabled and a session is active" state into the
//! platform's own keep-alive primitive:
//!
//! * **Android** — a foreground service with a persistent notification, which
//!   also keeps the WSS connection and the download queue alive.
//! * **iOS** — a `BGTask` request; iOS decides when (or whether) it fires.
//!
//! Desktop has no equivalent: the process simply keeps running, so both
//! functions are no-ops there.

use tauri::AppHandle;

/// Bring the platform keep-alive up, if it is not already running.
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn start(app: &AppHandle) {
    use tauri::Manager;
    use tauri_plugin_background_service::{ServiceManagerHandle, StartConfig};

    let Some(handle) = app.try_state::<ServiceManagerHandle<tauri::Wry>>() else {
        tracing::debug!("Background service plugin is not available; keep-alive skipped");
        return;
    };
    if handle.is_running().await {
        return;
    }

    let label = app
        .try_state::<crate::AppHandleState>()
        .map(|state| {
            state
                .localizer
                .translate("background-file-check-notification")
        })
        .filter(|label| !label.trim().is_empty())
        .unwrap_or_else(|| "CFMS Client is checking for file updates".to_string());

    let config = StartConfig {
        service_label: label,
        foreground_service_type: "dataSync".to_string(),
    };

    match handle.start(app.clone(), config).await {
        Ok(()) => tracing::info!("Background keep-alive started"),
        // AlreadyRunning races are harmless: the service is up either way.
        Err(error) if is_already_running(&error) => {}
        Err(error) => tracing::warn!("Could not start background keep-alive: {error}"),
    }
}

/// Tear the platform keep-alive down.
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn stop(app: &AppHandle) {
    use tauri::Manager;
    use tauri_plugin_background_service::ServiceManagerHandle;

    let Some(handle) = app.try_state::<ServiceManagerHandle<tauri::Wry>>() else {
        return;
    };
    if !handle.is_running().await {
        return;
    }

    match handle.stop().await {
        Ok(()) => tracing::info!("Background keep-alive stopped"),
        Err(error) if is_not_running(&error) => {}
        Err(error) => tracing::warn!("Could not stop background keep-alive: {error}"),
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn is_already_running(error: &tauri_plugin_background_service::ServiceError) -> bool {
    matches!(
        error,
        tauri_plugin_background_service::ServiceError::AlreadyRunning
    )
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn is_not_running(error: &tauri_plugin_background_service::ServiceError) -> bool {
    matches!(
        error,
        tauri_plugin_background_service::ServiceError::NotRunning
    )
}

/// Desktop: nothing to keep alive.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn start(_app: &AppHandle) {}

/// Desktop: nothing to stop.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn stop(_app: &AppHandle) {}
