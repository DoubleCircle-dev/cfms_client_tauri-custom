fn local_encrypted_paths(
    state: &AppHandleState,
    server_hash: &str,
    username: &str,
) -> Vec<std::path::PathBuf> {
    vec![
        cfms_service::user_preferences::file_path(&state.app_data_dir, server_hash, username),
        cfms_service::services::task_persistence::file_path(
            &state.app_data_dir,
            server_hash,
            username,
        ),
        cfms_service::services::upload_task_persistence::file_path(
            &state.app_data_dir,
            server_hash,
            username,
        ),
    ]
}

fn verify_local_preference_key(
    paths: &[std::path::PathBuf],
    key: &cfms_service::sensitive::SecretKey,
) -> Result<(), String> {
    for path in paths.iter().filter(|path| path.exists()) {
        let bytes = std::fs::read(path).map_err(|_| "publicKey.migrationFailed")?;
        let plaintext = zeroize::Zeroizing::new(
            cfms_crypto::decrypt_config(&bytes, key).map_err(|_| "publicKey.migrationFailed")?,
        );
        let _verified = cfms_service::sensitive::SensitiveJson::new(
            serde_json::from_slice(&plaintext).map_err(|_| "publicKey.migrationFailed")?,
        );
    }
    Ok(())
}

/// Read or create the device DEK only after GENERAL authentication succeeded.
#[tauri::command]
pub async fn prepare_preference_unlock<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
) -> Result<String, String> {
    let _update = state.inner.auth_update.lock().await;
    let (_, username, _) = get_connection_auth(&state).await?;
    let user_id = state
        .inner
        .user_id
        .read()
        .await
        .clone()
        .ok_or("Not logged in")?;
    let server = state
        .inner
        .server_address
        .read()
        .await
        .clone()
        .ok_or("Not connected")?;
    let account = crate::preference_keys::account(&server, &user_id);
    let paths = local_encrypted_paths(&state, &cfms_core::get_server_hash(&server), &username);
    let stored = tokio::task::spawn_blocking(move || {
        let vault = app.state::<crate::preference_keys::PreferenceKeys>();
        let _guard = vault.operation.lock().unwrap();
        if app
            .state::<crate::local_data_reset::LocalDataResetRuntime>()
            .in_progress
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err("publicKey.storageUnavailable".into());
        }
        if let Some((key, local_only)) = crate::preference_keys::read(&app, &account)? {
            verify_local_preference_key(&paths, &key)?;
            return Ok(Some((key, local_only)));
        }
        if paths.iter().any(|path| path.exists()) {
            return Ok(None);
        }
        let key = cfms_crypto::generate_dek();
        crate::preference_keys::save(&app, &account, &key, true)?;
        Ok::<_, String>(Some((key, true)))
    })
    .await
    .map_err(|_| "publicKey.storageUnavailable")??;
    if let Some((key, local_only)) = stored {
        *state.inner.dek.write().await = Some(key);
        state
            .inner
            .preference_dek_local_only
            .store(local_only, std::sync::atomic::Ordering::SeqCst);
        Ok("ready".into())
    } else {
        Ok("password_required".into())
    }
}

/// One-time migration: decrypt and validate without uploading or rewrapping any server key.
#[tauri::command]
pub async fn unlock_preference_dek<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    password: String,
) -> Result<(), String> {
    let password = zeroize::Zeroizing::new(password);
    let _update = state.inner.auth_update.lock().await;
    let (_, username, _) = get_connection_auth(&state).await?;
    let user_id = state
        .inner
        .user_id
        .read()
        .await
        .clone()
        .ok_or("Not logged in")?;
    let server = state
        .inner
        .server_address
        .read()
        .await
        .clone()
        .ok_or("Not connected")?;
    let encrypted = state
        .inner
        .server_preference_dek
        .read()
        .await
        .clone()
        .ok_or("publicKey.missingRecoveryKey")?;
    let key = decrypt_preference_dek(&encrypted, &password)
        .await
        .map_err(|_| "publicKey.migrationFailed")?;
    let paths = local_encrypted_paths(&state, &cfms_core::get_server_hash(&server), &username);
    let account = crate::preference_keys::account(&server, &user_id);
    let key = tokio::task::spawn_blocking(move || {
        let vault = app.state::<crate::preference_keys::PreferenceKeys>();
        let _guard = vault.operation.lock().unwrap();
        if app
            .state::<crate::local_data_reset::LocalDataResetRuntime>()
            .in_progress
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err("publicKey.storageUnavailable".into());
        }
        verify_local_preference_key(&paths, &key)?;
        crate::preference_keys::save(&app, &account, &key, false)?;
        Ok::<_, String>(key)
    })
    .await
    .map_err(|_| "publicKey.storageUnavailable")??;
    *state.inner.dek.write().await = Some(key);
    state
        .inner
        .preference_dek_local_only
        .store(false, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

async fn cache_current_preference_key<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppHandleState,
) -> Result<(), String> {
    let Some(key) = state.inner.dek.read().await.clone() else {
        return Ok(());
    };
    let user_id = state
        .inner
        .user_id
        .read()
        .await
        .clone()
        .ok_or("Not logged in")?;
    let server = state
        .inner
        .server_address
        .read()
        .await
        .clone()
        .ok_or("Not connected")?;
    let account = crate::preference_keys::account(&server, &user_id);
    let local_only = state
        .inner
        .preference_dek_local_only
        .load(std::sync::atomic::Ordering::SeqCst);
    let app = app.clone();
    tokio::task::spawn_blocking(move || {
        let vault = app.state::<crate::preference_keys::PreferenceKeys>();
        let _guard = vault.operation.lock().unwrap();
        if app
            .state::<crate::local_data_reset::LocalDataResetRuntime>()
            .in_progress
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err("publicKey.storageUnavailable".into());
        }
        crate::preference_keys::save(&app, &account, &key, local_only)
    })
    .await
    .map_err(|_| "publicKey.storageUnavailable")?
}

async fn restore_cached_preference_key<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppHandleState,
) -> Result<bool, String> {
    let (_, username, _) = get_connection_auth(state).await?;
    let user_id = state
        .inner
        .user_id
        .read()
        .await
        .clone()
        .ok_or("Not logged in")?;
    let server = state
        .inner
        .server_address
        .read()
        .await
        .clone()
        .ok_or("Not connected")?;
    let account = crate::preference_keys::account(&server, &user_id);
    let paths = local_encrypted_paths(state, &cfms_core::get_server_hash(&server), &username);
    let app = app.clone();
    let stored = tokio::task::spawn_blocking(move || {
        let vault = app.state::<crate::preference_keys::PreferenceKeys>();
        let _guard = vault.operation.lock().unwrap();
        let record = crate::preference_keys::read(&app, &account)?;
        if let Some((key, _)) = &record {
            verify_local_preference_key(&paths, key)?;
        }
        Ok::<_, String>(record)
    })
    .await
    .map_err(|_| "publicKey.storageUnavailable")??;
    if let Some((key, local_only)) = stored {
        *state.inner.dek.write().await = Some(key);
        state
            .inner
            .preference_dek_local_only
            .store(local_only, std::sync::atomic::Ordering::SeqCst);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod preference_migration_tests {
    use super::*;
    #[test]
    fn validates_all_three_encrypted_files_without_mutating_any_of_them() {
        let root = tempfile::tempdir().unwrap();
        let key = cfms_crypto::generate_dek();
        let other = cfms_crypto::generate_dek();
        let paths: Vec<_> = ["preferences", "downloads", "uploads"]
            .map(|name| root.path().join(name))
            .into();
        for path in &paths {
            std::fs::write(path, cfms_crypto::encrypt_config(b"{}", &key).unwrap()).unwrap();
        }
        assert!(verify_local_preference_key(&paths, &key).is_ok());
        assert!(verify_local_preference_key(&paths, &other).is_err());
        let corrupt = cfms_crypto::encrypt_config(b"{}", &other).unwrap();
        std::fs::write(&paths[2], &corrupt).unwrap();
        assert!(verify_local_preference_key(&paths, &key).is_err());
        assert_eq!(std::fs::read(&paths[2]).unwrap(), corrupt);
    }
}
