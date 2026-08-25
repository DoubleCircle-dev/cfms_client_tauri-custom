//! Frontend heartbeat used by the WebView crash watchdog.
//!
//! The frontend calls the [`heartbeat`] command a few times per second while
//! its JavaScript is running. When the WebView2 renderer process crashes, the
//! frontend stops beating and the watchdog (see `webview_guard.rs`) can detect
//! the outage and restore the window.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Tracks the most recent heartbeat received from the frontend.
#[derive(Default)]
pub struct HeartbeatState {
    pub last_beat_ms: AtomicU64,
}

/// Current wall-clock time in milliseconds since the Unix epoch.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Called periodically by the frontend while the WebView is responsive.
#[tauri::command]
pub fn heartbeat(state: tauri::State<'_, HeartbeatState>) {
    state.last_beat_ms.store(now_ms(), Ordering::Relaxed);
}
