// File scanning
// ---------------------------------------------------------------------------

/// Scan a local directory recursively with parallel traversal.
#[tauri::command]
pub async fn scan_directory(
    path: String,
    pattern: Option<String>,
) -> Result<Vec<FileEntry>, String> {
    let p = std::path::Path::new(&path);
    cfms_service::scan::scan_directory(p, pattern.as_deref())
        .map_err(|e| format!("Scan failed: {e}"))
}

// ---------------------------------------------------------------------------
// Server-side file browsing (mirrors reference/src/include/ui/util/path.py)
// ---------------------------------------------------------------------------

/// List a directory on the CFMS server.
///
/// Sends the `list_directory` action over the active WSS connection.
/// Pass `folder_id = None` to list the root directory.
///
/// Returns a [`ListDirectoryResponse`] containing sub-folders, documents,
/// and the parent folder ID.
#[tauri::command]
pub async fn list_directory(
    state: tauri::State<'_, AppHandleState>,
    folder_id: Option<String>,
) -> Result<ListDirectoryResponse, String> {
    fetch_all_listing_pages(
        &state,
        "list_directory",
        serde_json::json!({"folder_id": folder_id}),
    )
    .await
}

/// Fetch a single cursor page from a server-side directory listing.
///
/// The existing `list_directory` command remains available for callers that
/// require a complete response. Interactive file browsing uses this command so
/// the Webview can display the first page while later pages are still loading.
#[tauri::command]
pub async fn list_directory_page(
    state: tauri::State<'_, AppHandleState>,
    folder_id: Option<String>,
    cursor: Option<String>,
    page_size: Option<u32>,
) -> Result<ListDirectoryPageDto, String> {
    let raw = server_action_json(
        &state,
        "list_directory",
        serde_json::json!({
            "folder_id": folder_id,
            "cursor": cursor,
            "page_size": directory_page_size(page_size),
        }),
    )
    .await?;
    parse_listing_page_dto(raw)
}

fn directory_page_size(page_size: Option<u32>) -> u32 {
    page_size
        .unwrap_or(SERVER_CURSOR_PAGE_SIZE)
        .clamp(1, SERVER_CURSOR_PAGE_SIZE)
}

fn parse_listing_page_dto(raw: serde_json::Value) -> Result<ListDirectoryPageDto, String> {
    let page: ListingCursorPage = serde_json::from_value(raw)
        .map_err(|e| format!("Invalid list_directory page response: {e}"))?;
    if !(1..=SERVER_CURSOR_PAGE_SIZE).contains(&page.page_size) {
        return Err(format!(
            "Invalid list_directory page response: page_size must be between 1 and {SERVER_CURSOR_PAGE_SIZE}"
        ));
    }
    if page.has_more && page.next_cursor.is_none() {
        return Err(
            "Invalid list_directory page response: has_more requires next_cursor".to_string(),
        );
    }
    Ok(split_listing_page_dto(page))
}

/// Request a document download from the CFMS server.
///
/// Sends the `get_document` action, receives a download task from the server,
/// and adds it to the persistent download queue.
///
/// If the target file already exists on disk the command returns
/// `already_exists: true` without contacting the server, avoiding a
/// duplicate download.
///
/// Mirrors [`get_document`] from the Python reference (`path.py`).
#[tauri::command]
pub async fn get_document(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    filename: String,
    overwrite: Option<bool>,
    batch_id: Option<String>,
    batch_name: Option<String>,
    batch_root_id: Option<String>,
    batch_created_at: Option<i64>,
    batch_estimated_total: Option<u32>,
) -> Result<serde_json::Value, String> {
    // Build the target path early so we can check whether the file already
    // exists before contacting the server.
    let download_root = resolve_download_root(&app_handle, &state).await?;
    let _ = std::fs::create_dir_all(&download_root);
    let file_path = download_root.join(&filename);

    // Ensure parent directories exist (needed when filename includes a
    // relative path from single-file downloads in nested folders).
    if let Some(parent) = file_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    if file_path.exists() && !overwrite.unwrap_or(false) {
        let display_filename = download_display_filename(&filename);
        return Ok(serde_json::json!({
            "already_exists": true,
            "file_path": file_path.to_string_lossy(),
            "filename": display_filename,
        }));
    }

    // Overwrite: remove the existing file so it can be re-downloaded
    if file_path.exists() && overwrite.unwrap_or(false) {
        let _ = std::fs::remove_file(&file_path);
    }

    // Also skip when a non-terminal task for the same document is already
    // in the queue — unless overwrite is requested, in which case cancel
    // the old task and proceed.
    {
        let tasks = state.tasks.list(None);
        let already_queued = tasks
            .iter()
            .any(|t| t.file_id == document_id && !t.status.is_terminal());
        if already_queued {
            if overwrite.unwrap_or(false) {
                // Cancel existing non-terminal tasks for this document
                for task in tasks.iter().filter(|t| t.file_id == document_id && !t.status.is_terminal()) {
                    let _ = cfms_service::services::download_queue::cancel_task(
                        &state.tasks,
                        &state.active_downloads,
                        &task.task_id,
                    );
                }
            } else {
                let display_filename = download_display_filename(&filename);
                return Ok(serde_json::json!({
                    "already_exists": true,
                    "file_path": file_path.to_string_lossy(),
                    "filename": display_filename,
                }));
            }
        }
    }

    let conn = {
        let c = state.inner.conn.read().await;
        c.clone()
    }
    .ok_or_else(|| "Not connected to a server".to_string())?;

    let username = {
        let u = state.inner.username.read().await;
        u.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let token = {
        let t = state.inner.token.read().await;
        t.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let resp = send_action_request(
        &conn,
        "get_document",
        serde_json::json!({"document_id": document_id}),
        &username,
        &token,
    )
    .await?;

    // Handle 403 (Access Denied)
    if resp.code == 403 {
        return Err(format_server_response_error(&resp));
    }

    // Handle 404 (Not Found)
    if resp.code == 404 {
        return Err(format_server_response_error(&resp));
    }

    if resp.code != 200 {
        return Err(format_server_response_error(&resp));
    }

    // Extract task data from the server response.
    let task_data = &resp.data["task_data"];
    let task_id = task_data["task_id"]
        .as_str()
        .ok_or_else(|| "Server response missing task_id".to_string())?
        .to_string();
    let _start_time = task_data["start_time"].as_f64().unwrap_or(0.0);
    let _end_time = task_data["end_time"].as_f64().unwrap_or(0.0);
    let supports_resume = task_data["supports_resume"].as_bool().unwrap_or(false);

    // Re-resolve download root after the server round-trip in case the user
    // preference changed (unlikely but safe).
    let download_root = resolve_download_root(&app_handle, &state).await?;
    let _ = std::fs::create_dir_all(&download_root);
    let file_path = download_root.join(&filename);
    if let Some(parent) = file_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let display_filename = download_display_filename(&filename);
    let now = unix_now();

    let task = DownloadTaskDto {
        task_id: task_id.clone(),
        file_id: document_id.clone(),
        filename: display_filename.clone(),
        file_path: file_path.to_string_lossy().into_owned(),
        status: DownloadTaskStatus::Pending,
        progress: 0.0,
        current_bytes: 0,
        total_bytes: 0,
        message: None,
        error: None,
        created_at: now,
        started_at: None,
        completed_at: None,
        priority: 0,
        retry_count: 0,
        max_retries: 3,
        scheduled_time: None,
        stage: 0,
        bandwidth_limit: None,
        pause_position: None,
        supports_resume,
        batch_id: non_empty_optional(batch_id),
        batch_name: non_empty_optional(batch_name),
        batch_root_id: non_empty_optional(batch_root_id),
        batch_created_at,
        batch_estimated_total,
    };

    // Persist the download task so the download queue service picks it up.
    state
        .tasks
        .insert(&task)
        .map_err(|e| format!("Failed to add download: {e}"))?;
    let _ = state
        .inner
        .event_tx
        .send(ServiceEvent::DownloadTaskUpdated { task: task.clone() });
    let _ = state.inner.event_tx.send(ServiceEvent::ActiveCountChanged {
        count: state.tasks.active_count(),
    });

    Ok(serde_json::json!({
        "task_id": task_id,
        "file_id": document_id,
        "filename": display_filename,
        "file_path": task.file_path,
    }))
}

fn download_display_filename(path_or_name: &str) -> String {
    path_or_name
        .split(['/', '\\'])
        .rfind(|part| !part.is_empty())
        .unwrap_or(path_or_name)
        .to_string()
}

/// Check which files from a list of filenames exist in the local download root.
/// Returns a list of filenames that exist on disk.
#[tauri::command]
pub async fn check_downloads_exist(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    filenames: Vec<String>,
) -> Result<Vec<String>, String> {
    let download_root = resolve_download_root(&app_handle, &state).await?;
    let mut existing = Vec::new();
    for name in filenames {
        if download_root.join(&name).exists() {
            existing.push(name);
        }
    }
    Ok(existing)
}

/// Compute SHA-256 hex digests of files in the local download root.
/// Returns a map of filename → sha256 hex string (empty if file missing or error).
#[tauri::command]
pub async fn compute_local_sha256(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    filenames: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let download_root = resolve_download_root(&app_handle, &state).await?;
    let mut result = std::collections::HashMap::new();
    for name in filenames {
        let path = download_root.join(&name);
        if path.exists() {
            match cfms_transfer::compute_sha256(&path) {
                Ok(hash) => { result.insert(name, hex::encode(hash)); }
                Err(_) => { /* skip */ }
            }
        }
    }
    Ok(result)
}

/// Delete a file from the local download root by relative path.
#[tauri::command]
pub async fn delete_download_file(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    relative_path: String,
) -> Result<bool, String> {
    let download_root = resolve_download_root(&app_handle, &state).await?;
    let target = download_root.join(&relative_path);
    if !target.starts_with(&download_root) {
        return Err("Path is outside download root".to_string());
    }
    if target.exists() {
        std::fs::remove_file(&target).map_err(|e| format!("Failed to delete: {e}"))?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Recursively list all file paths (relative to download root) under the download directory.
#[tauri::command]
pub async fn list_download_files(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
) -> Result<Vec<String>, String> {
    use std::path::Path;
    let download_root = resolve_download_root(&app_handle, &state).await?;
    let entries = cfms_service::scan::scan_directory(&download_root, None)
        .map_err(|e| format!("Scan failed: {e}"))?;
    let paths: Vec<String> = entries
        .into_iter()
        .filter(|e| !e.is_dir)
        .filter_map(|e| {
            let entry_path = Path::new(&e.path);
            entry_path
                .strip_prefix(&download_root)
                .ok()
                .and_then(|p| p.to_str().map(|s| s.replace('\\', "/")))
        })
        .collect();
    Ok(paths)
}

/// Create a subdirectory under the local download root.
#[tauri::command]
pub async fn ensure_download_subdirectory(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    relative_path: String,
) -> Result<String, String> {
    let download_root = resolve_download_root(&app_handle, &state).await?;
    let directory_path = resolve_download_subdirectory(download_root, &relative_path)?;
    std::fs::create_dir_all(&directory_path)
        .map_err(|e| format!("Failed to create download directory: {e}"))?;

    Ok(directory_path.to_string_lossy().into_owned())
}

fn resolve_download_subdirectory(
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

// ---------------------------------------------------------------------------
// Git version tracking for local download directory
// ---------------------------------------------------------------------------

/// Ensure the download root is a git repository (git init if not already).
/// Also writes a .gitignore to exclude system files.
#[tauri::command]
pub async fn download_git_init(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
) -> Result<bool, String> {
    let download_root = resolve_download_root(&app_handle, &state).await?;
    let git_dir = download_root.join(".git");
    if git_dir.exists() {
        return Ok(false); // already initialized
    }
    // git init
    let output = std::process::Command::new("git")
        .arg("init")
        .arg("-q")
        .current_dir(&download_root)
        .output()
        .map_err(|e| format!("Failed to run git init: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git init failed: {stderr}"));
    }
    // Write a basic .gitignore
    let gitignore = download_root.join(".gitignore");
    if !gitignore.exists() {
        std::fs::write(&gitignore, "# CFMS download gitignore\n.cfms-download-root\nThumbs.db\n.DS_Store\n")
            .ok();
    }
    Ok(true)
}

/// Stage all changes and commit in the download root git repository.
/// Returns the commit hash, or empty string if nothing to commit.
#[tauri::command]
pub async fn download_git_commit(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    message: String,
) -> Result<String, String> {
    let download_root = resolve_download_root(&app_handle, &state).await?;
    let git_dir = download_root.join(".git");
    if !git_dir.exists() {
        return Err("Download directory is not a git repository".to_string());
    }
    // git add -A
    let add_output = std::process::Command::new("git")
        .arg("add")
        .arg("-A")
        .current_dir(&download_root)
        .output()
        .map_err(|e| format!("Failed to run git add: {e}"))?;
    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(format!("git add failed: {stderr}"));
    }
    // git commit --allow-empty
    let commit_output = std::process::Command::new("git")
        .arg("commit")
        .arg("--allow-empty")
        .arg("-m")
        .arg(&message)
        .current_dir(&download_root)
        .output()
        .map_err(|e| format!("Failed to run git commit: {e}"))?;
    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        return Err(format!("git commit failed: {stderr}"));
    }
    // Extract commit hash from stdout
    let stdout = String::from_utf8_lossy(&commit_output.stdout);
    // git commit output format: "[main abc1234] message"
    let hash = stdout
        .lines()
        .find_map(|line| {
            line.split_whitespace()
                .nth(1)
                .filter(|s| s.len() >= 7 && s.chars().all(|c| c.is_ascii_hexdigit()))
        })
        .unwrap_or("");
    Ok(hash.to_string())
}
