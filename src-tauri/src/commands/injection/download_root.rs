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
    if let Some(prefs) = load_fork_account_preferences(&state.inner, &state.app_data_dir).await? {
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

pub(crate) async fn load_fork_account_preferences(
    state: &cfms_service::state::AppState,
    app_data: &std::path::Path,
) -> Result<Option<cfms_core::UserPreference>, String> {
    if let (Some(server_addr), Some(user_id), Some(dek)) = (
        state.server_address.read().await.clone(),
        state.user_id.read().await.clone(),
        state.dek.read().await.clone(),
    ) {
        let server_hash = cfms_core::get_server_hash(&server_addr);
        let app_data = app_data.to_path_buf();
        let prefs = tokio::task::spawn_blocking(move || {
            cfms_service::user_preferences::load(&app_data, &server_hash, &user_id, Some(&*dek))
        })
        .await
        .map_err(|e| format!("Failed to load account preferences: {e}"))?
        .map_err(|e| format!("Failed to load account preferences: {e}"))?;
        return Ok(Some(prefs));
    }
    Ok(None)
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

pub(crate) fn resolve_download_subdirectory(
    mut root: std::path::PathBuf,
    relative_path: &str,
) -> Result<std::path::PathBuf, String> {
    for raw_part in relative_path.split(['/', '\\']) {
        let part = raw_part.trim();
        if part.is_empty() || part == "." {
            continue;
        }

        if part == ".." || part.contains(':') || part.contains('\0') {
            return Err("Invalid download directory path".to_string());
        }

        root.push(part);
    }

    Ok(root)
}

#[cfg(test)]
mod fork_account_preferences_tests {
    use super::*;

    #[tokio::test]
    async fn uses_account_id_for_external_storage_and_auto_check_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let state = cfms_service::state::AppState::new();
        let server = "example.invalid";
        let user_id = "account-id";
        let key = [42; cfms_core::constants::KEY_LEN];
        let mut prefs = cfms_core::UserPreference::default();
        prefs.use_external_storage = true;
        prefs.external_storage_path = dir.path().to_string_lossy().into_owned();
        prefs.file_auto_update_enabled = true;
        cfms_service::user_preferences::save(
            dir.path(), &cfms_core::get_server_hash(server), user_id, Some(&key), &prefs,
        ).unwrap();
        *state.server_address.write().await = Some(server.into());
        *state.user_id.write().await = Some(user_id.into());
        *state.username.write().await = Some("different-name".into());
        *state.dek.write().await = Some(zeroize::Zeroizing::new(key));

        let loaded = load_fork_account_preferences(&state, dir.path()).await.unwrap().unwrap();
        assert!(loaded.use_external_storage);
        assert_eq!(loaded.external_storage_path, prefs.external_storage_path);
        assert!(loaded.file_auto_update_enabled);
    }
}
