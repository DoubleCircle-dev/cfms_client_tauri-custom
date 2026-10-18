//! Automatic file-update check that keeps working while the app is in the
//! background.
//!
//! The check used to be a `setTimeout` chain owned by the Webview, which the
//! platform throttles (or freezes outright) as soon as the app leaves the
//! foreground. Moving the schedule and the tree walk into a Tokio service makes
//! the feature independent of the Webview: the process keeps its service lock on
//! Android for as long as [`crate::mobile_keepalive`] holds the foreground
//! service, and the walk talks to the server through the same
//! `list_directory` / `get_document_info` / `get_document` backend paths the
//! interactive UI uses.
//!
//! # Division of labour with the frontend
//!
//! This service owns two things the Webview cannot own reliably: *when* the
//! check runs, and the recursive comparison itself. Everything that needs a UI
//! (the conflict prompt, placeholders for denied folders, the check history
//! list, the git snapshot) still lives in the Svelte layer, which reacts to
//! [`CHECK_EVENT`]. A background check therefore reports what it found and —
//! when the user enabled "download updates immediately" — downloads it with the
//! configured overwrite strategy, but never asks a question.
//!
//! # Freshness
//!
//! The comparison is server SHA-256 against the local file's SHA-256, computed
//! from disk. Nothing is cached across runs, so the first check after a cold
//! start is as accurate as any other one.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::watch;

use crate::AppHandleState;

/// Emitted with a [`FileAutoCheckReport`] whenever a background check finishes.
pub const CHECK_EVENT: &str = "cfms:file-auto-check";

/// Emitted with a [`FileAutoCheckSchedule`] when the Rust-side timer moves.
pub const SCHEDULE_EVENT: &str = "cfms:file-auto-check-schedule";

/// How often the scheduler re-reads its inputs on its own (milliseconds).
///
/// Settings changes and manual checks arrive through [`FileAutoCheckRuntime`]
/// without waiting for this; the tick only bounds how long a missed signal or a
/// login/logout can go unnoticed.
const IDLE_TICK_MS: i64 = 10_000;

/// Upper bound on the number of directory levels the walk descends into.
const MAX_WALK_DEPTH: usize = 20;

/// Pause between directory listings, mirroring the interactive check so the
/// server is not hit with a burst of requests from a background task.
const DIRECTORY_DELAY_MS: u64 = 200;

/// Downloads queued per burst before pausing (mirrors the sync engine).
const DOWNLOAD_BATCH_SIZE: usize = 25;

/// Pause between download bursts (mirrors the sync engine).
const DOWNLOAD_BATCH_DELAY_MS: u64 = 2_500;

/// Pause before retrying a check that failed for a transient reason.
const RETRY_AFTER_FAILURE_MS: i64 = 120_000;

/// Pause before the very first check when "check once at startup" is enabled.
const STARTUP_CHECK_DELAY_MS: i64 = 5_000;

/// SHA-256 of the empty byte string — the digest every zero-byte file has.
const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/// One server document that is missing locally or superseded by a newer
/// revision.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAutoCheckItem {
    /// Server document ID.
    pub id: String,
    /// Display title of the document.
    pub title: String,
    /// Download-root-relative path, which is also the display path.
    pub path: String,
    /// Server SHA-256 digest of the new revision, when the server provides one.
    pub sha256: Option<String>,
    /// Whether a local file already occupies `path` (a replacement) rather than
    /// the document being new locally.
    pub existed_locally: bool,
}

/// Result of one background check.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAutoCheckReport {
    /// Account the check ran for, so the UI never attributes it to another user.
    pub account: String,
    /// When the walk finished (Unix milliseconds).
    pub checked_at: i64,
    /// When the next check is due (Unix milliseconds).
    pub next_check_at: i64,
    /// Number of outdated documents found.
    pub outdated: u32,
    /// Documents the server refused to hand over.
    pub denied: u32,
    /// Folders visited.
    pub dirs: u32,
    /// Documents inspected.
    pub docs: u32,
    /// The outdated documents themselves.
    pub items: Vec<FileAutoCheckItem>,
    /// Whether "download updates immediately" was enabled for this run.
    pub auto_download: bool,
    /// Documents queued for download by this run.
    pub downloaded: u32,
    /// Documents the download queue refused for a reason other than access.
    pub download_failed: u32,
    /// Documents left untouched by the "skip" overwrite strategy.
    pub skipped: u32,
}

/// Timer state handed to the frontend so the countdown survives navigation.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAutoCheckSchedule {
    /// When the last check finished (Unix milliseconds), or `0`.
    pub last_check_at: i64,
    /// When the next check is due (Unix milliseconds), or `0` when idle.
    pub next_check_at: i64,
}

/// Full scheduler state as returned by `get_file_auto_check_state`.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAutoCheckState {
    /// Most recent completed report, if any.
    pub report: Option<FileAutoCheckReport>,
    /// Current timer state.
    pub schedule: FileAutoCheckSchedule,
}

/// Live scheduler state shared between the service, the IPC commands and the
/// preference writer.
#[derive(Debug)]
pub struct FileAutoCheckRuntime {
    report: Mutex<Option<FileAutoCheckReport>>,
    last_check_at: AtomicI64,
    next_check_at: AtomicI64,
    /// Set by the frontend after a manual check so the countdown restarts.
    rebase_requested: AtomicBool,
    /// Wakes the scheduler out of its sleep (settings changed, rebase, ...).
    wake: tokio::sync::Notify,
}

impl Default for FileAutoCheckRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl FileAutoCheckRuntime {
    pub fn new() -> Self {
        Self {
            report: Mutex::new(None),
            last_check_at: AtomicI64::new(0),
            next_check_at: AtomicI64::new(0),
            rebase_requested: AtomicBool::new(false),
            wake: tokio::sync::Notify::new(),
        }
    }

    /// Snapshot for the frontend.
    pub fn state(&self) -> FileAutoCheckState {
        FileAutoCheckState {
            report: self.report.lock().ok().and_then(|report| report.clone()),
            schedule: self.schedule(),
        }
    }

    /// Current timer state.
    pub fn schedule(&self) -> FileAutoCheckSchedule {
        FileAutoCheckSchedule {
            last_check_at: self.last_check_at.load(Ordering::Relaxed),
            next_check_at: self.next_check_at.load(Ordering::Relaxed),
        }
    }

    /// Wake the scheduler because the settings it reads may have changed.
    pub fn notify_settings_changed(&self) {
        self.wake.notify_one();
    }

    /// Ask the scheduler to restart its countdown from now.
    ///
    /// Used after a manual check, which the frontend runs itself: the timer has
    /// to agree with what the user just did, or the countdown would fire a
    /// second check moments later.
    pub fn request_rebase(&self) {
        self.rebase_requested.store(true, Ordering::SeqCst);
        self.wake.notify_one();
    }

    fn take_rebase(&self) -> bool {
        self.rebase_requested.swap(false, Ordering::SeqCst)
    }

    fn set_schedule(&self, last_check_at: i64, next_check_at: i64) {
        self.last_check_at.store(last_check_at, Ordering::Relaxed);
        self.next_check_at.store(next_check_at, Ordering::Relaxed);
    }

    /// Drop the published report and countdown (sign-out, feature disabled).
    fn clear(&self) {
        if let Ok(mut report) = self.report.lock() {
            *report = None;
        }
        self.set_schedule(0, 0);
    }

    fn store_report(&self, report: FileAutoCheckReport) {
        if let Ok(mut stored) = self.report.lock() {
            *stored = Some(report);
        }
    }
}

/// Settings the scheduler needs, re-read from the encrypted preference file.
#[derive(Debug, Clone)]
pub struct AutoCheckSettings {
    /// Account whose preferences were read.
    pub username: String,
    pub enabled: bool,
    pub interval_minutes: u32,
    pub auto_download: bool,
    pub detect_on_startup: bool,
    pub overwrite_strategy: String,
}

impl AutoCheckSettings {
    fn interval_ms(&self) -> i64 {
        // Keep the same bounds the settings UI enforces (5 minutes – 24 hours).
        i64::from(self.interval_minutes.clamp(5, 24 * 60)) * 60_000
    }
}

/// Read the automatic-check preferences for the signed-in account.
///
/// Returns `None` while signed out, when the preference DEK is unavailable, or
/// when the file cannot be decrypted — the caller treats all of those as "no
/// background checking right now".
async fn read_settings(app: &AppHandle) -> Option<AutoCheckSettings> {
    let state = app.state::<AppHandleState>();
    let username = state.inner.username.read().await.clone()?;
    let server_address = state.inner.server_address.read().await.clone()?;
    let dek = state.inner.dek.read().await.clone()?;
    let server_hash = cfms_core::get_server_hash(&server_address);
    let app_data_dir = state.app_data_dir.clone();
    let settings_username = username.clone();

    let load = tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::load(&app_data_dir, &server_hash, &username, Some(&*dek))
    })
    .await
    .ok()?
    .ok()?;

    Some(AutoCheckSettings {
        username: settings_username,
        enabled: load.file_auto_update_enabled,
        interval_minutes: load.file_auto_update_interval_minutes,
        auto_download: load.file_auto_update_auto_download,
        detect_on_startup: load.file_auto_detect_on_startup,
        overwrite_strategy: load.sync_overwrite_strategy,
    })
}

/// Whether a session is active.
async fn is_logged_in(app: &AppHandle) -> bool {
    let state = app.state::<AppHandleState>();
    state.inner.token.read().await.is_some()
}

/// Sleep for `ms`, waking early when the scheduler is signalled.
///
/// Returns `true` when the service was asked to shut down.
async fn sleep_or_wake(
    runtime: &FileAutoCheckRuntime,
    shutdown: &mut watch::Receiver<bool>,
    ms: i64,
) -> bool {
    if *shutdown.borrow() {
        return true;
    }

    tokio::select! {
        changed = shutdown.changed() => changed.is_err() || *shutdown.borrow(),
        () = runtime.wake.notified() => false,
        () = tokio::time::sleep(Duration::from_millis(ms.max(0) as u64)) => false,
    }
}

/// The background file-update check service.
///
/// Runs for the lifetime of the process (or until [`crate::AppHandleState`]'s
/// service manager shuts it down) and:
///
/// * keeps the Android foreground service in sync with the user's setting, so
///   the process is not frozen while the app is backgrounded;
/// * runs the recursive comparison on the configured interval;
/// * downloads the changes itself when "download updates immediately" is on;
/// * publishes both the schedule and the result as events.
pub async fn run(app: AppHandle, mut shutdown: watch::Receiver<bool>) {
    let mut settings: Option<AutoCheckSettings> = None;
    let mut settings_read_at: i64 = 0;
    let mut next_check_at: Option<i64> = None;
    let mut startup_check_done = false;
    let mut keepalive_running = false;

    loop {
        if *shutdown.borrow() {
            break;
        }

        // The managed state is installed after the service manager is created;
        // wait for it instead of panicking on a cold start.
        if app.try_state::<AppHandleState>().is_none() {
            if tokio::select! {
                changed = shutdown.changed() => changed.is_err() || *shutdown.borrow(),
                () = tokio::time::sleep(Duration::from_millis(250)) => false,
            } {
                break;
            }
            continue;
        }
        let runtime = Arc::clone(&app.state::<AppHandleState>().file_auto_check);

        let now = now_ms();
        if settings.is_none() || now - settings_read_at >= 60_000 {
            settings = read_settings(&app).await;
            settings_read_at = now;
        }

        let active = is_logged_in(&app).await && settings.as_ref().is_some_and(|s| s.enabled);

        if active != keepalive_running {
            if active {
                crate::mobile_keepalive::start(&app).await;
            } else {
                crate::mobile_keepalive::stop(&app).await;
                // Signed out or the feature switched off: the schedule and the
                // report belong to a session that no longer exists.
                next_check_at = None;
                startup_check_done = false;
                runtime.clear();
                emit_schedule(&app, &runtime);
            }
            keepalive_running = active;
        }

        if !active {
            // Idle until checking becomes possible again.
            if sleep_or_wake(&runtime, &mut shutdown, IDLE_TICK_MS).await {
                break;
            }
            continue;
        }

        let Some(current) = settings.clone() else {
            if sleep_or_wake(&runtime, &mut shutdown, IDLE_TICK_MS).await {
                break;
            }
            continue;
        };

        let now = now_ms();

        if runtime.take_rebase() {
            next_check_at = Some(now + current.interval_ms());
            runtime.set_schedule(now, now + current.interval_ms());
            emit_schedule(&app, &runtime);
        }

        let due_at = match next_check_at {
            Some(due_at) => due_at,
            None => {
                let delay = if current.detect_on_startup && !startup_check_done {
                    STARTUP_CHECK_DELAY_MS
                } else {
                    current.interval_ms()
                };
                let due_at = now + delay;
                next_check_at = Some(due_at);
                runtime.set_schedule(now, due_at);
                emit_schedule(&app, &runtime);
                due_at
            }
        };

        if now < due_at {
            let wait = (due_at - now).min(IDLE_TICK_MS);
            if sleep_or_wake(&runtime, &mut shutdown, wait).await {
                break;
            }
            continue;
        }

        startup_check_done = true;
        match perform_check(&app, &current).await {
            Ok(mut report) => {
                let finished_at = now_ms();
                let next = finished_at + current.interval_ms();
                report.checked_at = finished_at;
                report.next_check_at = next;
                runtime.store_report(report.clone());
                runtime.set_schedule(finished_at, next);
                next_check_at = Some(next);
                let _ = app.emit(CHECK_EVENT, &report);
                emit_schedule(&app, &runtime);
            }
            Err(error) => {
                tracing::warn!("Automatic file-update check failed: {error}");
                let next = now_ms() + RETRY_AFTER_FAILURE_MS.min(current.interval_ms());
                runtime.set_schedule(runtime.last_check_at.load(Ordering::Relaxed), next);
                next_check_at = Some(next);
                emit_schedule(&app, &runtime);
            }
        }

        // Settings may have been edited while the walk was running.
        settings = read_settings(&app).await;
        settings_read_at = now_ms();
    }

    crate::mobile_keepalive::stop(&app).await;
    tracing::info!("Automatic file-update check service stopped");
}

fn emit_schedule(app: &AppHandle, runtime: &FileAutoCheckRuntime) {
    let _ = app.emit(SCHEDULE_EVENT, &runtime.schedule());
}

/// Walk the server tree and compare every document against the local download
/// root, optionally downloading what is outdated.
async fn perform_check(
    app: &AppHandle,
    settings: &AutoCheckSettings,
) -> Result<FileAutoCheckReport, String> {
    let download_root = {
        let state = app.state::<AppHandleState>();
        crate::commands::resolve_download_root(app, &state).await?
    };

    let mut report = FileAutoCheckReport {
        account: settings.username.clone(),
        auto_download: settings.auto_download,
        ..Default::default()
    };

    let mut pending: Vec<(Option<String>, Vec<String>, usize)> = vec![(None, Vec::new(), 0)];
    let mut listings = 0usize;

    while let Some((folder_id, path_parts, depth)) = pending.pop() {
        if listings > 0 {
            sleep_between_listings().await;
        }
        listings += 1;

        let listing = {
            let state = app.state::<AppHandleState>();
            crate::commands::list_directory_full(&state, folder_id.clone()).await
        };

        let listing = match listing {
            Ok(listing) => listing,
            Err(error) if path_parts.is_empty() => return Err(error),
            Err(error) => {
                tracing::warn!(
                    "Automatic check could not list {}: {error}",
                    make_download_path(&path_parts)
                );
                continue;
            }
        };

        report.docs += listing.documents.len() as u32;
        report.dirs += listing.folders.len() as u32;

        for document in &listing.documents {
            let path = make_download_path_with_title(&path_parts, &document.title);
            let local_hash = local_document_hash(&download_root, &path).await;
            if is_local_copy_current(local_hash.as_deref(), document) {
                continue;
            }

            // A refused document is not an update: report it as denied instead of
            // offering the user a download that will fail. The answer is taken
            // fresh every time, so restored access is picked up on its own.
            if let Err(error) = probe_document_access(app, &document.id).await {
                if is_document_access_denied(&error) {
                    report.denied += 1;
                    continue;
                }
                tracing::debug!("Access probe for {} failed: {error}", document.title);
            }

            report.items.push(FileAutoCheckItem {
                id: document.id.clone(),
                title: document.title.clone(),
                path,
                sha256: document.sha256.clone(),
                existed_locally: local_hash.is_some(),
            });
        }

        for folder in &listing.folders {
            if depth + 1 > MAX_WALK_DEPTH {
                continue;
            }
            let mut child_parts = path_parts.clone();
            child_parts.push(folder.name.clone());
            pending.push((Some(folder.id.clone()), child_parts, depth + 1));
        }
    }

    report.outdated = report.items.len() as u32;

    if settings.auto_download && !report.items.is_empty() {
        apply_downloads(app, &download_root, settings, &mut report).await;
    }

    Ok(report)
}

/// Pacing pause between directory listings.
async fn sleep_between_listings() {
    tokio::time::sleep(Duration::from_millis(DIRECTORY_DELAY_MS)).await;
}

/// Ask the server whether one document is readable, without downloading it.
async fn probe_document_access(app: &AppHandle, document_id: &str) -> Result<(), String> {
    let state = app.state::<AppHandleState>();
    crate::commands::server_action_json(
        &state,
        "get_document_info",
        serde_json::json!({ "document_id": document_id }),
    )
    .await
    .map(|_| ())
}

/// Queue the downloads a check found, honouring the configured overwrite
/// strategy exactly like the interactive sync does.
async fn apply_downloads(
    app: &AppHandle,
    download_root: &Path,
    settings: &AutoCheckSettings,
    report: &mut FileAutoCheckReport,
) {
    let backup_suffix = backup_suffix_for();
    for (index, item) in report.items.iter().enumerate() {
        if index > 0 && index % DOWNLOAD_BATCH_SIZE == 0 {
            tokio::time::sleep(Duration::from_millis(DOWNLOAD_BATCH_DELAY_MS)).await;
        }

        if item.existed_locally {
            match settings.overwrite_strategy.as_str() {
                "skip" => {
                    report.skipped += 1;
                    continue;
                }
                "backup_rename" => {
                    backup_local_file(download_root, &item.path, &backup_suffix).await;
                }
                _ => {}
            }
        }

        let queued = {
            let state = app.state::<AppHandleState>();
            crate::commands::enqueue_document_download(
                app,
                &state,
                &item.id,
                &item.path,
                crate::commands::DownloadBatchMeta::default(),
            )
            .await
        };

        match queued {
            Ok(_) => report.downloaded += 1,
            Err(error) => {
                if is_document_access_denied(&error) {
                    report.denied += 1;
                } else {
                    report.download_failed += 1;
                    tracing::warn!("Background download of {} failed: {error}", item.path);
                }
            }
        }
    }
}

/// Move an outdated local copy aside before the new revision replaces it.
async fn backup_local_file(download_root: &Path, path: &str, suffix: &str) {
    let root = download_root.to_path_buf();
    let relative = path.to_string();
    let backup_relative = format!("{path}{suffix}");
    let backed_up = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let source = crate::commands::resolve_download_subdirectory(root.clone(), &relative)?;
        if !source.exists() {
            return Ok(());
        }
        let target = crate::commands::resolve_download_subdirectory(root, &backup_relative)?;
        if let Some(parent) = target.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::rename(&source, &target)
            .map_err(|error| format!("Failed to back up {relative}: {error}"))
    })
    .await;

    match backed_up {
        Ok(Ok(())) => tracing::debug!("Background update backed up {path}{suffix}"),
        Ok(Err(error)) => tracing::warn!("{error}"),
        Err(error) => tracing::warn!("Backup task for {path} failed: {error}"),
    }
}

/// SHA-256 of the local copy at `path` inside the download root, when readable.
async fn local_document_hash(download_root: &Path, path: &str) -> Option<String> {
    let root = download_root.to_path_buf();
    let relative = path.to_string();
    tokio::task::spawn_blocking(move || {
        let absolute = crate::commands::resolve_download_subdirectory(root, &relative).ok()?;
        crate::commands::file_sha256(&absolute).ok()
    })
    .await
    .ok()?
}

/// Whether the local copy still is the revision the server holds.
///
/// Mirrors the frontend's single comparison rule so both check paths can never
/// disagree about which files need fetching.
fn is_local_copy_current(
    local_hash: Option<&str>,
    document: &cfms_core::ServerDocumentEntry,
) -> bool {
    match document.sha256.as_deref() {
        Some(server_hash) => local_hash == Some(server_hash),
        // Without a digest, size and the empty-file hash are the only proof.
        None => document.size == Some(0) && local_hash == Some(EMPTY_SHA256),
    }
}

/// `Server returned 403: ...` for this document, as opposed to a refused session.
fn is_document_access_denied(message: &str) -> bool {
    let trimmed = message.trim_start();
    let lowered = trimmed.to_ascii_lowercase();
    if lowered.starts_with("access denied") {
        return true;
    }
    // A core-level rejection refuses every request alike and says nothing about
    // this document.
    if lowered.contains("connection rejected") || lowered.contains("server rejected request") {
        return false;
    }
    trimmed.contains("403")
}

/// Download-root-relative path for one document in `path_parts`.
fn make_download_path_with_title(path_parts: &[String], title: &str) -> String {
    let mut parts = path_parts.to_vec();
    parts.push(title.to_string());
    make_download_path(&parts)
}

/// Mirror of the frontend's `makeDownloadPath`.
fn make_download_path(parts: &[String]) -> String {
    let safe: Vec<String> = parts
        .iter()
        .map(|part| sanitize_download_segment(part))
        .filter(|part| !part.is_empty())
        .collect();
    if safe.is_empty() {
        "download".to_string()
    } else {
        safe.join("/")
    }
}

/// Mirror of the frontend's `sanitizeDownloadPathSegment`.
fn sanitize_download_segment(part: &str) -> String {
    let mut out = String::with_capacity(part.len());
    let mut last_was_space = false;
    for ch in part.chars() {
        let replaced = matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            || ch.is_whitespace();
        if replaced {
            if !last_was_space {
                out.push(' ');
                last_was_space = true;
            }
            continue;
        }
        out.push(ch);
        last_was_space = false;
    }
    out.trim().to_string()
}

/// `<name>+YYYYMMDD-HHMMSS.bak`, the snapshot suffix the sync engine recognises.
fn backup_suffix_for() -> String {
    format!("+{}.bak", utc_timestamp())
}

/// Current UTC time as `YYYYMMDD-HHMMSS`.
fn utc_timestamp() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}{month:02}{day:02}-{hour:02}{minute:02}{second:02}")
}

/// Convert days since 1970-01-01 to a civil (year, month, day).
///
/// Howard Hinnant's `civil_from_days`, which needs no calendar dependency.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(sha256: Option<&str>, size: Option<u64>) -> cfms_core::ServerDocumentEntry {
        cfms_core::ServerDocumentEntry {
            id: "doc".to_string(),
            title: "file.txt".to_string(),
            size,
            last_modified: None,
            sha256: sha256.map(ToString::to_string),
        }
    }

    #[test]
    fn civil_dates_match_known_days() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(1), (1970, 1, 2));
        assert_eq!(civil_from_days(19_000), (2022, 1, 8));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
    }

    #[test]
    fn backup_suffix_matches_the_sync_engine_pattern() {
        let suffix = backup_suffix_for();
        let trimmed = suffix.trim_start_matches('+').trim_end_matches(".bak");
        assert_eq!(trimmed.len(), 15, "expected YYYYMMDD-HHMMSS, got {trimmed}");
        let (date, time) = trimmed.split_once('-').expect("date and time halves");
        assert_eq!(date.len(), 8);
        assert_eq!(time.len(), 6);
        assert!(suffix.ends_with(".bak"));
    }

    #[test]
    fn download_paths_sanitize_like_the_frontend() {
        assert_eq!(make_download_path(&[]), "download");
        assert_eq!(
            make_download_path(&["a/b".to_string(), "c:d".to_string()]),
            "a b/c d"
        );
        assert_eq!(
            make_download_path(&["  spaced  ".to_string(), String::new()]),
            "spaced"
        );
        assert_eq!(
            make_download_path_with_title(&["folder".to_string()], "x*y.txt"),
            "folder/x y.txt"
        );
    }

    #[test]
    fn local_copy_is_current_only_on_a_matching_digest() {
        let current = document(Some("abc"), Some(3));
        assert!(is_local_copy_current(Some("abc"), &current));
        assert!(!is_local_copy_current(Some("def"), &current));
        assert!(!is_local_copy_current(None, &current));

        // Without a server digest, only an empty file proves currency.
        let empty = document(None, Some(0));
        assert!(is_local_copy_current(Some(EMPTY_SHA256), &empty));
        assert!(!is_local_copy_current(Some("abc"), &empty));
        let unknown_size = document(None, None);
        assert!(!is_local_copy_current(Some(EMPTY_SHA256), &unknown_size));
    }

    #[test]
    fn denied_documents_are_told_apart_from_rejected_sessions() {
        assert!(is_document_access_denied("Server returned 403: no access"));
        assert!(is_document_access_denied("Access denied: document"));
        assert!(!is_document_access_denied(
            "connection rejected (403): banned subnet"
        ));
        assert!(!is_document_access_denied("Server returned 429: slow down"));
    }

    #[test]
    fn interval_is_clamped_to_the_settings_bounds() {
        let settings = |minutes| AutoCheckSettings {
            username: "alice".to_string(),
            enabled: true,
            interval_minutes: minutes,
            auto_download: false,
            detect_on_startup: false,
            overwrite_strategy: "backup_rename".to_string(),
        };
        assert_eq!(settings(0).interval_ms(), 5 * 60_000);
        assert_eq!(settings(1).interval_ms(), 5 * 60_000);
        assert_eq!(settings(60).interval_ms(), 60 * 60_000);
        assert_eq!(settings(10_000).interval_ms(), 24 * 60 * 60_000);
    }
}
