// Fork-owned download-root resolution.
//
// Honours the per-user external storage preference and leaves an unencrypted
// hint so the local-data-reset path can clean the directory before the DEK is
// available. Included into the `commands` module so the helpers share the
// command-layer imports.

/// Resolve the download root directory, respecting the user's external storage
/// preference when configured.
pub(crate) async fn resolve_download_root(
    app_handle: &tauri::AppHandle,
    state: &AppHandleState,
) -> Result<std::path::PathBuf, String> {
    // Try to load user preferences to check for external storage setting.
    if let (Some(server_addr), Some(username), Some(dek)) = (
        state.inner.server_address.read().await.clone(),
        state.inner.username.read().await.clone(),
        state.inner.dek.read().await.clone(),
    ) {
        let server_hash = cfms_core::get_server_hash(&server_addr);
        let app_data = state.app_data_dir.clone();
        let load_task = tokio::task::spawn_blocking(move || {
            cfms_service::user_preferences::load(&app_data, &server_hash, &username, Some(&*dek))
        });
        let prefs = match load_task.await {
            Ok(Ok(p)) => p,
            _ => return download_root(app_handle),
        };
        if prefs.use_external_storage && !prefs.external_storage_path.trim().is_empty() {
            let path = std::path::PathBuf::from(&prefs.external_storage_path);
            if path.is_absolute() {
                let root = path.join("downloads");
                // Persist the resolved path as an unencrypted hint so that
                // the local-data-reset codepath (which runs before the DEK is
                // available) can locate and clean the download directory.
                let _ = write_download_root_hint(&state.app_data_dir, &root);
                return Ok(root);
            }
        }
    }

    // Clear any stale external-storage hint when falling back to the default.
    let _ = clear_download_root_hint(&state.app_data_dir);
    download_root(app_handle)
}

const DOWNLOAD_ROOT_HINT_NAME: &str = ".cfms-download-root";

fn download_root_hint_path(app_data: &std::path::Path) -> std::path::PathBuf {
    app_data.join(DOWNLOAD_ROOT_HINT_NAME)
}

fn write_download_root_hint(app_data: &std::path::Path, root: &std::path::Path) -> Result<(), String> {
    let path = download_root_hint_path(app_data);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&path, root.to_string_lossy().as_bytes())
        .map_err(|e| format!("Failed to write download-root hint: {e}"))
}

fn clear_download_root_hint(app_data: &std::path::Path) -> Result<(), String> {
    let path = download_root_hint_path(app_data);
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to remove download-root hint: {e}"))?;
    }
    Ok(())
}
