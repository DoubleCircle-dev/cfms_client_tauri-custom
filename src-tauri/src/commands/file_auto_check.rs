// Automatic file-update check commands
// ---------------------------------------------------------------------------
//
// The check itself runs in the Rust `file_auto_check` service so it keeps
// running while the app is in the background. These commands only expose the
// scheduler state and let the UI restart the countdown after a manual check.

/// Return the last background check result and the current timer state.
#[tauri::command]
pub fn get_file_auto_check_state(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    serde_json::to_value(state.file_auto_check.state())
        .map_err(|e| format!("Failed to serialize automatic check state: {e}"))
}

/// Restart the background countdown from now.
///
/// The interactive "check now" button runs the check in the Webview (it has the
/// prompts and the check history). Telling the scheduler keeps the two from
/// firing a second check moments apart.
#[tauri::command]
pub fn rebase_file_auto_check_schedule(
    state: tauri::State<'_, AppHandleState>,
) -> Result<(), String> {
    state.file_auto_check.request_rebase();
    Ok(())
}
