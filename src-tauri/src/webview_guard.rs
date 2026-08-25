//! WebView crash watchdog.
//!
//! The WebView2 renderer process occasionally crashes on Windows (observed
//! with runtime 151.x), leaving the host process alive while the window goes
//! blank or disappears entirely. Tauri's `eval` cannot detect this because the
//! script is queued even when the renderer is dead, so the watchdog instead
//! relies on a heartbeat that the frontend sends while its JavaScript runs.
//! When the heartbeat goes stale the window is restored and reloaded, falling
//! back to a full application restart if reloads do not recover the renderer.

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewWindow};

use crate::heartbeat::{HeartbeatState, now_ms};

const CHECK_INTERVAL: Duration = Duration::from_secs(3);
const STALE_AFTER_MS: u64 = 15_000;
const CONFIRM_WAIT: Duration = Duration::from_secs(5);
const GRACE_AFTER_START_MS: u64 = 30_000;
const RELOAD_ATTEMPTS: u32 = 3;

/// Starts the background watchdog for the main window's WebView.
///
/// No-op when the main window is not available yet. Only call this after the
/// main window has been built.
pub fn start_webview_watchdog(app: AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let started_at_ms = now_ms();
    std::thread::spawn(move || watch(window, app, started_at_ms));
}

fn watch(window: WebviewWindow, app: AppHandle, started_at_ms: u64) {
    let mut reload_attempts = 0u32;

    loop {
        std::thread::sleep(CHECK_INTERVAL);

        // The window being gone means the app is shutting down, not that the
        // renderer crashed. Stop watching instead of trying to revive it.
        if window.is_visible().is_err() {
            return;
        }

        let last_beat_ms = app.state::<HeartbeatState>().last_beat_ms.load(Ordering::Relaxed);

        // No heartbeat yet: give the freshly created page time to boot before
        // treating the absence of a heartbeat as a crash.
        if last_beat_ms == 0 {
            if now_ms().saturating_sub(started_at_ms) < GRACE_AFTER_START_MS {
                continue;
            }
        } else if now_ms().saturating_sub(last_beat_ms) < STALE_AFTER_MS {
            reload_attempts = 0;
            continue;
        }

        // The heartbeat is stale. Wait briefly in case the machine just woke
        // from sleep: timers pause while sleeping, but a healthy page resumes
        // beating within a couple of seconds of waking.
        std::thread::sleep(CONFIRM_WAIT);
        let last_beat_ms = app.state::<HeartbeatState>().last_beat_ms.load(Ordering::Relaxed);
        if last_beat_ms != 0 && now_ms().saturating_sub(last_beat_ms) < STALE_AFTER_MS {
            continue; // Heartbeat resumed — the earlier staleness was a false alarm.
        }

        if reload_attempts < RELOAD_ATTEMPTS {
            reload_attempts += 1;
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            match window.reload() {
                Ok(()) => tracing::warn!(
                    "WebView became unresponsive; automatic reload attempt {}/{}",
                    reload_attempts,
                    RELOAD_ATTEMPTS
                ),
                Err(err) => tracing::error!("Failed to reload unresponsive WebView: {err}"),
            }
            // Reset the heartbeat so the post-reload state is measured fresh.
            app.state::<HeartbeatState>()
                .last_beat_ms
                .store(0, Ordering::Relaxed);
            continue;
        }

        tracing::error!(
            "WebView did not recover after {} reloads; restarting application",
            RELOAD_ATTEMPTS
        );
        app.request_restart();
        return;
    }
}
