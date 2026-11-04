// Signed declarative extension management and host API broker.

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionAccountStateDto {
    enabled: bool,
    install_epoch: String,
    granted_capabilities: Vec<String>,
    settings: serde_json::Value,
    stale_installation: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionOverviewDto {
    installed: Vec<cfms_service::injection::extensions_system::ExtensionInstallation>,
    account_states: std::collections::BTreeMap<String, ExtensionAccountStateDto>,
    schedules: std::collections::BTreeMap<
        String,
        Vec<cfms_service::injection::extension_schedules::ScheduleTask>,
    >,
    catalog: Option<cfms_service::injection::extensions_system::CatalogDocument>,
    trusted_keys_configured: bool,
    host_api_version: &'static str,
    supported_host_api_versions: [&'static str; 2],
}

#[tauri::command]
pub async fn get_extension_overview(
    state: tauri::State<'_, AppHandleState>,
) -> Result<ExtensionOverviewDto, String> {
    let store = state.custom.extensions.clone();
    let installed = tokio::task::spawn_blocking(move || store.list_installed())
        .await
        .map_err(|e| format!("Extension list task failed: {e}"))??;
    let (schedule_scope, account_preferences) = load_current_extension_preferences(&state).await?;
    let account_states = installed
        .iter()
        .map(|installation| {
            let preference = account_preferences
                .as_ref()
                .and_then(|preferences| preferences.get(&installation.manifest.id));
            let revoked = state
                .custom
                .extensions
                .revocation_reason(&installation.manifest.id, &installation.manifest.version)
                .ok()
                .flatten()
                .is_some();
            let stale = preference
                .is_some_and(|preference| preference.install_epoch != installation.install_epoch);
            let grants_current = preference.is_some_and(|preference| {
                installation
                    .manifest
                    .requested_capabilities
                    .iter()
                    .all(|capability| preference.granted_capabilities.contains(capability))
            });
            let dto = preference.map_or_else(
                || ExtensionAccountStateDto {
                    enabled: false,
                    install_epoch: String::new(),
                    granted_capabilities: Vec::new(),
                    settings: serde_json::Value::Null,
                    stale_installation: false,
                },
                |preference| ExtensionAccountStateDto {
                    enabled: preference.enabled && !stale && !revoked && grants_current,
                    install_epoch: preference.install_epoch.clone(),
                    granted_capabilities: preference.granted_capabilities.clone(),
                    settings: preference.settings.clone(),
                    stale_installation: stale,
                },
            );
            (installation.manifest.id.clone(), dto)
        })
        .collect();
    let catalog = state
        .custom
        .extensions
        .cached_catalog(cfms_service::injection::extensions_system::DEFAULT_CATALOG_URL)
        .unwrap_or(None);
    let schedules = if let Some(scope) = schedule_scope {
        let schedule_store =
            cfms_service::injection::extension_schedules::ExtensionScheduleStore::new(
                &state.app_data_dir,
            );
        let extension_ids = installed
            .iter()
            .map(|installation| installation.manifest.id.clone())
            .collect::<Vec<_>>();
        let server_hash = scope.server_hash;
        let username = scope.username;
        tokio::task::spawn_blocking(move || {
            extension_ids
                .into_iter()
                .map(|extension_id| {
                    schedule_store
                        .list(&server_hash, &username, &extension_id)
                        .map(|tasks| (extension_id, tasks))
                })
                .collect::<Result<std::collections::BTreeMap<_, _>, String>>()
        })
        .await
        .map_err(|error| format!("Extension schedule list task failed: {error}"))??
    } else {
        std::collections::BTreeMap::new()
    };

    Ok(ExtensionOverviewDto {
        installed,
        account_states,
        schedules,
        catalog,
        trusted_keys_configured: state.custom.extensions.has_trusted_keys(),
        host_api_version: cfms_service::injection::extensions_system::HOST_API_VERSION,
        supported_host_api_versions: [
            cfms_service::injection::extensions_system::HOST_API_VERSION,
            cfms_service::injection::extensions_system::WASM_HOST_API_VERSION,
        ],
    })
}

#[tauri::command]
pub async fn import_extension_package(
    state: tauri::State<'_, AppHandleState>,
    path: String,
) -> Result<cfms_service::injection::extensions_system::ExtensionInstallation, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = state;
        let _ = path;
        return Err("Installable extension packages are not available on mobile".into());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let package_path = std::path::PathBuf::from(path);
        let metadata = tokio::fs::metadata(&package_path)
            .await
            .map_err(|e| format!("Failed to inspect extension package: {e}"))?;
        if !metadata.is_file() || metadata.len() > 20 * 1024 * 1024 {
            return Err("Extension package must be a file no larger than 20 MiB".into());
        }
        let package = tokio::fs::read(&package_path)
            .await
            .map_err(|e| format!("Failed to read extension package: {e}"))?;
        let store = state.custom.extensions.clone();
        tokio::task::spawn_blocking(move || store.install_package(&package))
            .await
            .map_err(|e| format!("Extension installation task failed: {e}"))?
    }
}

#[tauri::command]
pub async fn refresh_extension_catalog(
    state: tauri::State<'_, AppHandleState>,
) -> Result<cfms_service::injection::extensions_system::CatalogDocument, String> {
    fetch_and_cache_extension_catalog(&state).await
}

#[tauri::command]
pub async fn install_extension_from_catalog(
    state: tauri::State<'_, AppHandleState>,
    extension_id: String,
    allow_third_party: bool,
) -> Result<cfms_service::injection::extensions_system::ExtensionInstallation, String> {
    #[cfg(target_os = "ios")]
    {
        let _ = state;
        let _ = extension_id;
        let _ = allow_third_party;
        return Err("Installable extension packages are not available on iOS".into());
    }
    #[cfg(not(target_os = "ios"))]
    {
        let catalog = match state
            .custom
            .extensions
            .cached_catalog(cfms_service::injection::extensions_system::DEFAULT_CATALOG_URL)?
        {
            Some(catalog) => catalog,
            None => fetch_and_cache_extension_catalog(&state).await?,
        };
        let entry = catalog
            .extensions
            .into_iter()
            .find(|entry| entry.manifest.id == extension_id)
            .ok_or_else(|| "Extension is not available in the official catalog".to_string())?;
        if entry.revoked {
            return Err(entry
                .revocation_reason
                .unwrap_or_else(|| "This extension version has been revoked".into()));
        }
        if entry.key_id != cfms_service::injection::extensions_system::MAINTAINER_EXTENSION_KEY_ID
            && !allow_third_party
        {
            return Err(format!(
                "Extension is signed by trusted third-party key {}; explicit confirmation is required",
                entry.key_id
            ));
        }
        let client = update_http_client(updater_proxy_url(&state)?.as_ref())?;
        let response = client
            .get(&entry.download_url)
            .send()
            .await
            .map_err(|e| format!("Failed to download extension package: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Extension package download failed: {e}"))?;
        if response
            .content_length()
            .is_some_and(|length| length > 20 * 1024 * 1024)
        {
            return Err("Extension package exceeds the 20 MiB download limit".into());
        }
        let package = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to receive extension package: {e}"))?;
        let store = state.custom.extensions.clone();
        tokio::task::spawn_blocking(move || store.install_catalog_package(&package, &entry))
            .await
            .map_err(|e| format!("Extension installation task failed: {e}"))?
    }
}

#[tauri::command]
pub async fn rollback_extension(
    state: tauri::State<'_, AppHandleState>,
    extension_id: String,
) -> Result<cfms_service::injection::extensions_system::ExtensionInstallation, String> {
    let store = state.custom.extensions.clone();
    tokio::task::spawn_blocking(move || store.rollback(&extension_id))
        .await
        .map_err(|e| format!("Extension rollback task failed: {e}"))?
}

#[tauri::command]
pub async fn uninstall_extension(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    extension_id: String,
) -> Result<(), String> {
    let store = state.custom.extensions.clone();
    let schedules = cfms_service::injection::extension_schedules::ExtensionScheduleStore::new(
        &state.app_data_dir,
    );
    let uninstall_id = extension_id.clone();
    tokio::task::spawn_blocking(move || {
        store.uninstall(&uninstall_id)?;
        schedules.delete_extension(&uninstall_id)
    })
    .await
    .map_err(|e| format!("Extension uninstall task failed: {e}"))??;
    let _ = app_handle.emit(
        "cfms:extension-schedules-changed",
        serde_json::json!({ "extensionId": extension_id }),
    );
    Ok(())
}

#[tauri::command]
pub async fn set_extension_enabled(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    extension_id: String,
    enabled: bool,
    granted_capabilities: Vec<String>,
) -> Result<(), String> {
    let installation = state
        .custom
        .extensions
        .get_installed(&extension_id)?
        .ok_or_else(|| "Extension is not installed".to_string())?;
    if enabled
        && let Some(reason) = state
            .custom
            .extensions
            .revocation_reason(&installation.manifest.id, &installation.manifest.version)?
    {
        return Err(reason);
    }
    let requested = installation
        .manifest
        .requested_capabilities
        .iter()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    let granted = granted_capabilities
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
    if !granted.is_subset(&requested) {
        return Err("Cannot grant capabilities that the extension did not request".into());
    }
    if enabled && granted != requested {
        return Err(
            "All requested capabilities must be approved before enabling the extension".into(),
        );
    }

    let (scope, mut preferences) = load_current_user_preferences(&state).await?;
    let existing_settings = preferences
        .extensions
        .get(&extension_id)
        .map(|preference| preference.settings.clone())
        .unwrap_or(serde_json::Value::Null);
    preferences.extensions.insert(
        extension_id.clone(),
        cfms_core::ExtensionPreference {
            enabled,
            install_epoch: installation.install_epoch,
            granted_capabilities: granted.into_iter().collect(),
            settings: existing_settings,
        },
    );
    save_current_user_preferences(&state, scope, preferences).await?;
    tracing::info!(
        extension_id,
        enabled,
        "Extension account activation changed"
    );
    let _ = app_handle.emit(
        "cfms:extension-schedules-changed",
        serde_json::json!({ "extensionId": extension_id }),
    );
    Ok(())
}

#[tauri::command]
pub async fn read_extension_page(
    state: tauri::State<'_, AppHandleState>,
    extension_id: String,
    page: String,
) -> Result<serde_json::Value, String> {
    ensure_extension_enabled(&state, &extension_id, None).await?;
    let store = state.custom.extensions.clone();
    tokio::task::spawn_blocking(move || store.read_page(&extension_id, &page))
        .await
        .map_err(|e| format!("Extension page task failed: {e}"))?
}

#[tauri::command]
pub async fn read_extension_workflow(
    state: tauri::State<'_, AppHandleState>,
    extension_id: String,
    workflow: String,
) -> Result<serde_json::Value, String> {
    ensure_extension_enabled(&state, &extension_id, None).await?;
    let store = state.custom.extensions.clone();
    tokio::task::spawn_blocking(move || store.read_workflow(&extension_id, &workflow))
        .await
        .map_err(|e| format!("Extension workflow task failed: {e}"))?
}

#[tauri::command]
pub async fn execute_extension_module(
    state: tauri::State<'_, AppHandleState>,
    extension_id: String,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    ensure_extension_enabled(&state, &extension_id, None).await?;
    let store = state.custom.extensions.clone();
    tokio::task::spawn_blocking(move || store.execute_module(&extension_id, input))
        .await
        .map_err(|e| format!("Extension module task failed: {e}"))?
}

#[tauri::command]
pub async fn execute_extension_host_call(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    extension_id: String,
    capability: String,
    arguments: serde_json::Value,
    user_confirmed: Option<bool>,
) -> Result<serde_json::Value, String> {
    ensure_extension_enabled(&state, &extension_id, Some(&capability)).await?;
    match capability.as_str() {
        "account.summary.read" => Ok(serde_json::json!({
            "username": state.inner.username.read().await.clone(),
            "nickname": state.inner.nickname.read().await.clone(),
            "server": state.inner.server_name.read().await.clone(),
            "permissions": state.inner.permissions.read().await.clone(),
            "groups": state.inner.groups.read().await.clone(),
        })),
        "tasks.read" => serde_json::to_value(state.tasks.list(None))
            .map_err(|e| format!("Failed to serialize tasks: {e}")),
        "files.list" => {
            let folder_id = arguments
                .get("folderId")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string);
            let listing = fetch_all_listing_pages(
                &state,
                "core.directory.list",
                serde_json::json!({ "folder_id": folder_id }),
            )
            .await?;
            serde_json::to_value(listing)
                .map_err(|e| format!("Failed to serialize directory listing: {e}"))
        }
        "files.search" => {
            let query = arguments
                .get("query")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| "files.search requires a query".to_string())?;
            if query.trim().is_empty() {
                return Err("Search query cannot be empty".into());
            }
            server_action_json(
                &state,
                "core.search.query",
                serde_json::json!({
                    "query": query.trim(), "page_size": 128, "sort_by": "name", "sort_order": "asc",
                    "search_documents": true, "search_directories": true
                }),
            )
            .await
        }
        "files.metadata.read" => {
            let document_id = arguments
                .get("documentId")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| "files.metadata.read requires documentId".to_string())?;
            server_action_json(
                &state,
                "core.document.info.get",
                serde_json::json!({ "document_id": document_id }),
            )
            .await
        }
        "files.updates.check" => {
            let folder_path = match arguments.get("folderPath") {
                None | Some(serde_json::Value::Null) => None,
                Some(serde_json::Value::String(path)) => Some(path.as_str()),
                Some(_) => return Err("files.updates.check folderPath must be a string".into()),
            };
            let scope = match folder_path {
                Some(path) => Some(resolve_extension_folder_scope(&state, path).await?),
                None => None,
            };
            let quiet = match arguments.get("quiet") {
                None => false,
                Some(serde_json::Value::Bool(quiet)) => *quiet,
                Some(_) => return Err("files.updates.check quiet must be a boolean".into()),
            };
            let task_id = match arguments.get("taskId") {
                None | Some(serde_json::Value::Null) => None,
                Some(serde_json::Value::String(id)) => Some(id.clone()),
                Some(_) => return Err("files.updates.check taskId must be a string".into()),
            };
            let report = crate::custom::file_auto_check::check_for_extension(
                &app_handle,
                false,
                scope,
                quiet,
                false,
                crate::custom::file_auto_check::ExtensionCheckSource {
                    extension_id: extension_id.clone(),
                    task_id,
                },
            )
            .await?;
            serde_json::to_value(report)
                .map_err(|e| format!("Failed to serialize file update check: {e}"))
        }
        "files.sync.full" => {
            if user_confirmed != Some(true) {
                return Err("User confirmation is required before synchronizing files".into());
            }
            let report = crate::custom::file_auto_check::check_for_extension(
                &app_handle,
                true,
                None,
                false,
                true,
                crate::custom::file_auto_check::ExtensionCheckSource {
                    extension_id: extension_id.clone(),
                    task_id: None,
                },
            )
            .await?;
            serde_json::to_value(report)
                .map_err(|e| format!("Failed to serialize file synchronization: {e}"))
        }
        "schedules.manage" => {
            execute_schedule_host_call(
                &app_handle,
                &state,
                &extension_id,
                arguments,
                user_confirmed,
            )
            .await
        }
        "files.sync.task" => {
            execute_scheduled_file_sync(&app_handle, &state, &extension_id, arguments).await
        }
        "preferences.read" => {
            let (_, preferences) = load_current_user_preferences(&state).await?;
            Ok(preferences
                .extensions
                .get(&extension_id)
                .map(|preference| preference.settings.clone())
                .unwrap_or(serde_json::Value::Null))
        }
        "preferences.write" => {
            let value = arguments
                .get("value")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            if serde_json::to_vec(&value).map_err(|e| e.to_string())?.len() > 64 * 1024 {
                return Err("Extension preferences cannot exceed 64 KiB".into());
            }
            let (scope, mut preferences) = load_current_user_preferences(&state).await?;
            let preference = preferences
                .extensions
                .get_mut(&extension_id)
                .ok_or_else(|| "Extension account state is missing".to_string())?;
            preference.settings = value;
            save_current_user_preferences(&state, scope, preferences).await?;
            Ok(serde_json::json!({ "saved": true }))
        }
        "ui.confirm" => {
            Ok(serde_json::json!({ "requiresUserConfirmation": true, "request": arguments }))
        }
        "ui.notify" => Ok(serde_json::json!({ "notification": arguments })),
        "transfers.download.enqueue" => {
            if user_confirmed != Some(true) {
                return Err("A user confirmation is required before enqueueing a download".into());
            }
            let document_id = arguments
                .get("documentId")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| "transfers.download.enqueue requires documentId".to_string())?;
            let filename = arguments
                .get("filename")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| "transfers.download.enqueue requires filename".to_string())?;
            get_document(
                app_handle,
                state,
                document_id.to_string(),
                filename.to_string(),
                None,
                None,
                None,
                None,
                None,
            )
            .await
        }
        "events.subscribe" => {
            Ok(serde_json::json!({ "supportedEvents": ["connection.changed", "tasks.changed"] }))
        }
        _ => Err("Unsupported extension host capability".into()),
    }
}

#[tauri::command]
pub async fn record_extension_schedule_run(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    extension_id: String,
    task_id: String,
    status: String,
    summary: Option<String>,
) -> Result<cfms_service::injection::extension_schedules::ScheduleTask, String> {
    ensure_extension_enabled(&state, &extension_id, Some("schedules.manage")).await?;
    let (scope, _) = load_current_user_preferences(&state).await?;
    let store = cfms_service::injection::extension_schedules::ExtensionScheduleStore::new(
        &state.app_data_dir,
    );
    let record_extension_id = extension_id.clone();
    let task = tokio::task::spawn_blocking(move || {
        store.record_run(
            &scope.server_hash,
            &scope.username,
            &record_extension_id,
            &task_id,
            &status,
            summary,
        )
    })
    .await
    .map_err(|error| format!("Extension schedule record task failed: {error}"))??;
    let _ = app_handle.emit(
        "cfms:extension-schedules-changed",
        serde_json::json!({ "extensionId": extension_id }),
    );
    Ok(task)
}

async fn execute_schedule_host_call(
    app_handle: &tauri::AppHandle,
    state: &AppHandleState,
    extension_id: &str,
    arguments: serde_json::Value,
    user_confirmed: Option<bool>,
) -> Result<serde_json::Value, String> {
    let operation = arguments
        .get("operation")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "schedules.manage requires an operation".to_string())?;
    let (scope, _) = load_current_user_preferences(state).await?;
    let schedule_store = cfms_service::injection::extension_schedules::ExtensionScheduleStore::new(
        &state.app_data_dir,
    );
    let server_hash = scope.server_hash;
    let username = scope.username;
    let mut changed = false;
    let result = match operation {
        "list" => {
            let store = schedule_store.clone();
            let extension_id = extension_id.to_string();
            let tasks = tokio::task::spawn_blocking(move || {
                store.list(&server_hash, &username, &extension_id)
            })
            .await
            .map_err(|error| format!("Extension schedule list task failed: {error}"))??;
            serde_json::json!({ "tasks": tasks })
        }
        "get" => {
            let task_id = required_string(&arguments, "taskId", "schedules.manage get")?;
            let store = schedule_store.clone();
            let extension_id = extension_id.to_string();
            let tasks = tokio::task::spawn_blocking(move || {
                store.list(&server_hash, &username, &extension_id)
            })
            .await
            .map_err(|error| format!("Extension schedule get task failed: {error}"))??;
            let task = tasks
                .into_iter()
                .find(|task| task.id == task_id)
                .ok_or_else(|| "Schedule task was not found".to_string())?;
            serde_json::json!({ "task": task })
        }
        "create" => {
            let input = parse_schedule_task_input(
                arguments
                    .get("task")
                    .cloned()
                    .ok_or_else(|| "schedules.manage create requires task".to_string())?,
            )?;
            validate_schedule_workflow(state, extension_id, &input)?;
            if input.action == cfms_service::injection::extension_schedules::ScheduleAction::Update
            {
                if user_confirmed != Some(true) {
                    return Err(
                        "User confirmation is required before creating an update schedule".into(),
                    );
                }
                ensure_extension_enabled(state, extension_id, Some("files.sync.task")).await?;
            }
            let store = schedule_store.clone();
            let extension_id = extension_id.to_string();
            let task = tokio::task::spawn_blocking(move || {
                store.create(&server_hash, &username, &extension_id, input)
            })
            .await
            .map_err(|error| format!("Extension schedule create task failed: {error}"))??;
            changed = true;
            serde_json::json!({ "task": task })
        }
        "update" => {
            let task_id = required_string(&arguments, "taskId", "schedules.manage update")?;
            let input = parse_schedule_task_input(
                arguments
                    .get("task")
                    .cloned()
                    .ok_or_else(|| "schedules.manage update requires task".to_string())?,
            )?;
            validate_schedule_workflow(state, extension_id, &input)?;
            if input.action == cfms_service::injection::extension_schedules::ScheduleAction::Update
            {
                if user_confirmed != Some(true) {
                    return Err(
                        "User confirmation is required before updating an update schedule".into(),
                    );
                }
                ensure_extension_enabled(state, extension_id, Some("files.sync.task")).await?;
            }
            let store = schedule_store.clone();
            let extension_id = extension_id.to_string();
            let task = tokio::task::spawn_blocking(move || {
                store.update(&server_hash, &username, &extension_id, &task_id, input)
            })
            .await
            .map_err(|error| format!("Extension schedule update task failed: {error}"))??;
            changed = true;
            serde_json::json!({ "task": task })
        }
        "delete" => {
            let task_id = required_string(&arguments, "taskId", "schedules.manage delete")?;
            let store = schedule_store.clone();
            let extension_id = extension_id.to_string();
            let deleted = tokio::task::spawn_blocking(move || {
                store.delete(&server_hash, &username, &extension_id, &task_id)
            })
            .await
            .map_err(|error| format!("Extension schedule delete task failed: {error}"))??;
            changed = deleted;
            serde_json::json!({ "deleted": deleted })
        }
        _ => {
            return Err(format!(
                "Unsupported schedules.manage operation: {operation}"
            ));
        }
    };
    if changed {
        let _ = app_handle.emit(
            "cfms:extension-schedules-changed",
            serde_json::json!({ "extensionId": extension_id }),
        );
    }
    Ok(result)
}

async fn execute_scheduled_file_sync(
    app_handle: &tauri::AppHandle,
    state: &AppHandleState,
    extension_id: &str,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let task_id = required_string(&arguments, "taskId", "files.sync.task")?;
    let delete_stale_requested = match arguments.get("deleteStale") {
        None => false,
        Some(serde_json::Value::Bool(value)) => *value,
        Some(_) => return Err("files.sync.task deleteStale must be a boolean".into()),
    };
    let (scope, _) = load_current_user_preferences(state).await?;
    let schedule_store = cfms_service::injection::extension_schedules::ExtensionScheduleStore::new(
        &state.app_data_dir,
    );
    let store = schedule_store.clone();
    let extension_id_owned = extension_id.to_string();
    let tasks = tokio::task::spawn_blocking(move || {
        store.list(&scope.server_hash, &scope.username, &extension_id_owned)
    })
    .await
    .map_err(|error| format!("Extension schedule lookup task failed: {error}"))??;
    let task = tasks
        .into_iter()
        .find(|task| task.id == task_id)
        .ok_or_else(|| "Schedule task was not found".to_string())?;
    if !task.enabled
        || task.action != cfms_service::injection::extension_schedules::ScheduleAction::Update
    {
        return Err("files.sync.task requires an enabled update schedule".into());
    }
    let scope = match task.scope {
        cfms_service::injection::extension_schedules::ScheduleScope::All => None,
        cfms_service::injection::extension_schedules::ScheduleScope::Folder => {
            let path = task
                .folder_path
                .as_deref()
                .ok_or_else(|| "Folder schedule is missing folder_path".to_string())?;
            Some(resolve_extension_folder_scope(state, path).await?)
        }
    };
    let delete_stale = delete_stale_requested
        && task.update_policy
            == cfms_service::injection::extension_schedules::ScheduleUpdatePolicy::Mirror;
    let report = crate::custom::file_auto_check::check_for_extension(
        app_handle,
        true,
        scope,
        true,
        delete_stale,
        crate::custom::file_auto_check::ExtensionCheckSource {
            extension_id: extension_id.to_string(),
            task_id: Some(task.id.clone()),
        },
    )
    .await?;
    serde_json::to_value(report)
        .map_err(|error| format!("Failed to serialize scheduled file synchronization: {error}"))
}

fn parse_schedule_task_input(
    mut value: serde_json::Value,
) -> Result<cfms_service::injection::extension_schedules::ScheduleTaskInput, String> {
    for key in [
        "id",
        "created_at",
        "last_run_at",
        "last_status",
        "last_summary",
    ] {
        if let Some(object) = value.as_object_mut() {
            object.remove(key);
        }
    }
    serde_json::from_value(value).map_err(|error| format!("Invalid schedule task: {error}"))
}

fn validate_schedule_workflow(
    state: &AppHandleState,
    extension_id: &str,
    task: &cfms_service::injection::extension_schedules::ScheduleTaskInput,
) -> Result<(), String> {
    let installation = state
        .custom
        .extensions
        .get_installed(extension_id)?
        .ok_or_else(|| "Extension is not installed".to_string())?;
    if !installation
        .manifest
        .entrypoints
        .workflows
        .iter()
        .any(|entry| entry.workflow == task.workflow)
    {
        return Err("Schedule workflow is not declared by the extension".into());
    }
    task.validate()
}

fn required_string(
    arguments: &serde_json::Value,
    key: &str,
    operation: &str,
) -> Result<String, String> {
    arguments
        .get(key)
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{operation} requires {key}"))
}

async fn resolve_extension_folder_scope(
    state: &AppHandleState,
    path: &str,
) -> Result<crate::custom::file_auto_check::FileAutoCheckScope, String> {
    let segments = path.split('/').collect::<Vec<_>>();
    if segments.first() != Some(&"root")
        || path.len() > 2048
        || segments.iter().any(|segment| {
            segment.is_empty() || *segment == "." || *segment == ".." || segment.contains('\\')
        })
    {
        return Err("folderPath must be an absolute root-relative path".into());
    }
    let lookup = crate::commands::resolve_node_path_for_state(state, path.to_string()).await?;
    if lookup.node_ids.len() != segments.len() {
        return Err("node_lookup returned a path with an unexpected depth".into());
    }
    Ok(crate::custom::file_auto_check::FileAutoCheckScope {
        folder_id: (segments.len() > 1)
            .then(|| lookup.node_ids.last().cloned())
            .flatten(),
        path_parts: segments[1..]
            .iter()
            .map(|segment| (*segment).to_string())
            .collect(),
    })
}

async fn fetch_and_cache_extension_catalog(
    state: &tauri::State<'_, AppHandleState>,
) -> Result<cfms_service::injection::extensions_system::CatalogDocument, String> {
    if !state.custom.extensions.has_trusted_keys() {
        return Err("No official extension signing public key is configured for this build".into());
    }
    let catalog_url = cfms_service::injection::extensions_system::DEFAULT_CATALOG_URL;
    let signature_url = format!("{catalog_url}.sig");
    let client = update_http_client(updater_proxy_url(state)?.as_ref())?;
    let catalog_response = client
        .get(catalog_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch extension catalog: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Extension catalog request failed: {e}"))?;
    let etag = catalog_response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let catalog = catalog_response
        .text()
        .await
        .map_err(|e| format!("Failed to read extension catalog: {e}"))?;
    let signature = client
        .get(signature_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch extension catalog signature: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Extension catalog signature request failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Failed to read extension catalog signature: {e}"))?;
    let verified = state
        .custom
        .extensions
        .verify_catalog(catalog.as_bytes(), &signature)?;
    state
        .custom
        .extensions
        .cache_catalog(catalog_url, etag.as_deref(), &catalog, &signature)?;
    Ok(verified)
}

struct CurrentPreferenceScope {
    server_hash: String,
    username: String,
    dek: zeroize::Zeroizing<[u8; cfms_core::constants::KEY_LEN]>,
}

async fn load_current_extension_preferences(
    state: &AppHandleState,
) -> Result<
    (
        Option<CurrentPreferenceScope>,
        Option<std::collections::BTreeMap<String, cfms_core::ExtensionPreference>>,
    ),
    String,
> {
    if state.inner.username.read().await.is_none() || state.inner.dek.read().await.is_none() {
        return Ok((None, None));
    }
    let (scope, preferences) = load_current_user_preferences(state).await?;
    Ok((Some(scope), Some(preferences.extensions)))
}

async fn load_current_user_preferences(
    state: &AppHandleState,
) -> Result<(CurrentPreferenceScope, cfms_core::UserPreference), String> {
    let username = state
        .inner
        .username
        .read()
        .await
        .clone()
        .ok_or_else(|| "Not logged in".to_string())?;
    let server = state
        .inner
        .server_address
        .read()
        .await
        .clone()
        .ok_or_else(|| "No server address".to_string())?;
    let dek = state
        .inner
        .dek
        .read()
        .await
        .clone()
        .ok_or_else(|| "Preference DEK is unavailable".to_string())?;
    let server_hash = cfms_core::get_server_hash(&server);
    let app_data_dir = state.app_data_dir.clone();
    let load_hash = server_hash.clone();
    let load_username = username.clone();
    let load_dek = dek.clone();
    let preferences = tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::load(
            &app_data_dir,
            &load_hash,
            &load_username,
            Some(&*load_dek),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Preference load task failed: {e}"))??;
    Ok((
        CurrentPreferenceScope {
            server_hash,
            username,
            dek,
        },
        preferences,
    ))
}

async fn save_current_user_preferences(
    state: &AppHandleState,
    scope: CurrentPreferenceScope,
    preferences: cfms_core::UserPreference,
) -> Result<(), String> {
    let app_data_dir = state.app_data_dir.clone();
    tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::save(
            &app_data_dir,
            &scope.server_hash,
            &scope.username,
            Some(&*scope.dek),
            &preferences,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Preference save task failed: {e}"))?
}

async fn ensure_extension_enabled(
    state: &AppHandleState,
    extension_id: &str,
    capability: Option<&str>,
) -> Result<(), String> {
    let installation = state
        .custom
        .extensions
        .get_installed(extension_id)?
        .ok_or_else(|| "Extension is not installed".to_string())?;
    if let Some(reason) = state
        .custom
        .extensions
        .revocation_reason(&installation.manifest.id, &installation.manifest.version)?
    {
        return Err(reason);
    }
    let (_, preferences) = load_current_user_preferences(state).await?;
    let preference = preferences
        .extensions
        .get(extension_id)
        .ok_or_else(|| "Extension is not enabled for this account".to_string())?;
    if !preference.enabled || preference.install_epoch != installation.install_epoch {
        return Err("Extension is not enabled for this installation".into());
    }
    if installation
        .manifest
        .requested_capabilities
        .iter()
        .any(|capability| !preference.granted_capabilities.contains(capability))
    {
        return Err("Extension permissions changed and require renewed approval".into());
    }
    if let Some(capability) = capability
        && (!installation
            .manifest
            .requested_capabilities
            .iter()
            .any(|item| item == capability)
            || !preference
                .granted_capabilities
                .iter()
                .any(|item| item == capability))
    {
        return Err(format!(
            "Extension capability {capability} is not authorized"
        ));
    }
    Ok(())
}
