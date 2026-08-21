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

/// Resolve one absolute, human-readable path through the optional
/// `node_lookup` server extension.
#[tauri::command]
pub async fn resolve_node_path(
    state: tauri::State<'_, AppHandleState>,
    path: String,
) -> Result<NodeLookupResponse, String> {
    let has_node_lookup = {
        let extension_flags = state.inner.server_extension_flags.read().await;
        supports_node_lookup(&extension_flags)
    };
    if !has_node_lookup {
        return Err("The connected server does not advertise node_lookup support".to_string());
    }

    let raw = server_action_json(
        &state,
        "node_lookup",
        serde_json::json!({ "path": path }),
    )
    .await?;
    let response: NodeLookupResponse = serde_json::from_value(raw)
        .map_err(|error| format!("Invalid node_lookup response: {error}"))?;
    validate_node_lookup_response(response)
}

fn supports_node_lookup(extension_flags: &[String]) -> bool {
    extension_flags.iter().any(|flag| flag == "node_lookup")
}

fn validate_node_lookup_response(
    response: NodeLookupResponse,
) -> Result<NodeLookupResponse, String> {
    if response.node_ids.first().map(String::as_str) != Some("/") {
        return Err("Invalid node_lookup response: node_ids must start with the root ID".to_string());
    }
    if response.node_ids.iter().any(|node_id| node_id.is_empty()) {
        return Err("Invalid node_lookup response: node_ids must not contain empty IDs".to_string());
    }
    Ok(response)
}

#[cfg(test)]
mod node_lookup_response_tests {
    use super::{supports_node_lookup, validate_node_lookup_response};
    use cfms_core::NodeLookupResponse;

    #[test]
    fn accepts_rooted_non_empty_node_id_chains() {
        let response = NodeLookupResponse {
            node_ids: vec!["/".into(), "projects".into()],
        };
        assert_eq!(
            validate_node_lookup_response(response).unwrap().node_ids,
            ["/", "projects"]
        );
    }

    #[test]
    fn requires_the_exact_node_lookup_extension_flag() {
        assert!(supports_node_lookup(&["node_lookup".into()]));
        assert!(!supports_node_lookup(&["node-lookup".into(), "documents".into()]));
    }

    #[test]
    fn rejects_missing_root_and_empty_ids() {
        let missing_root = NodeLookupResponse {
            node_ids: vec!["projects".into()],
        };
        assert!(validate_node_lookup_response(missing_root).is_err());

        let empty_id = NodeLookupResponse {
            node_ids: vec!["/".into(), "".into()],
        };
        assert!(validate_node_lookup_response(empty_id).is_err());
    }
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
/// Mirrors [`get_document`] from the Python reference (`path.py`).
#[tauri::command]
pub async fn get_document(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    filename: String,
    batch_id: Option<String>,
    batch_name: Option<String>,
    batch_root_id: Option<String>,
    batch_created_at: Option<i64>,
    batch_estimated_total: Option<u32>,
) -> Result<serde_json::Value, String> {
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
        return Err(format!("Access denied: {}", resp.message));
    }

    // Handle 404 (Not Found)
    if resp.code == 404 {
        return Err("Document not found on server".to_string());
    }

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
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

    // Build a local download path, respecting the user's external storage
    // preference when configured.
    let download_root = resolve_download_root(&app_handle, &state).await?;

    // Ensure the download directory exists.
    let _ = std::fs::create_dir_all(&download_root);

    let file_path = download_root.join(&filename);
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
        .filter(|part| !part.is_empty())
        .next_back()
        .unwrap_or(path_or_name)
        .to_string()
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
// Local download file management
// ---------------------------------------------------------------------------

/// Check which files from a list of filenames exist in the local download root.
#[tauri::command]
pub async fn check_downloads_exist(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    filenames: Vec<String>,
) -> Result<Vec<String>, String> {
    let download_root = resolve_download_root(&app_handle, &state).await?;
    let mut existing = Vec::new();
    for name in &filenames {
        if resolve_download_subdirectory(download_root.clone(), name).is_ok_and(|p| p.exists()) {
            existing.push(name.clone());
        }
    }
    Ok(existing)
}

/// Compute SHA-256 hashes of local files in the download root.
/// Returns a map of filename → hex-encoded SHA-256 digest.
#[tauri::command]
pub async fn compute_local_sha256(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    filenames: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let download_root = resolve_download_root(&app_handle, &state).await?;
    let mut results = std::collections::HashMap::new();
    for name in &filenames {
        let path = resolve_download_subdirectory(download_root.clone(), name)?;
        let hash = match std::fs::read(&path) {
            Ok(data) => {
                use sha2::{Digest, Sha256};
                let digest = Sha256::digest(&data);
                hex::encode(digest)
            }
            Err(_) => continue,
        };
        results.insert(name.clone(), hash);
    }
    Ok(results)
}

/// Delete a file from the local download root by relative path.
#[tauri::command]
pub async fn delete_download_file(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    relative_path: String,
) -> Result<bool, String> {
    let download_root = resolve_download_root(&app_handle, &state).await?;
    let file_path = resolve_download_subdirectory(download_root, &relative_path)?;
    if !file_path.exists() {
        return Ok(false);
    }
    std::fs::remove_file(&file_path)
        .map_err(|e| format!("Failed to delete download file: {e}"))?;
    Ok(true)
}

/// Move (rename) a file within the local download root by relative paths.
/// Creates the destination directory if needed.
#[tauri::command]
pub async fn move_download_file(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    from_path: String,
    to_path: String,
) -> Result<bool, String> {
    let download_root = resolve_download_root(&app_handle, &state).await?;
    let src = resolve_download_subdirectory(download_root.clone(), &from_path)?;
    let dst = resolve_download_subdirectory(download_root, &to_path)?;
    if !src.exists() {
        return Ok(false);
    }
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create destination directory: {e}"))?;
    }
    std::fs::rename(&src, &dst)
        .map_err(|e| format!("Failed to move download file: {e}"))?;
    Ok(true)
}

/// Recursively list all file paths (relative to the download root) in the download root.
#[tauri::command]
pub async fn list_download_files(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
) -> Result<Vec<String>, String> {
    let download_root = resolve_download_root(&app_handle, &state).await?;
    let mut files = Vec::new();
    collect_relative_files(&download_root, &download_root, &mut files)
        .map_err(|e| format!("Failed to list download files: {e}"))?;
    Ok(files)
}

fn collect_relative_files(
    root: &std::path::Path,
    current: &std::path::Path,
    out: &mut Vec<String>,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_relative_files(root, &path, out)?;
        } else {
            if let Ok(rel) = path.strip_prefix(root) {
                // Normalize to forward slashes so paths match the frontend's
                // serverPaths (which uses '/'), regardless of platform separator.
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    Ok(())
}

/// Initialize a git repository in the download root (no-op if already initialized).
#[tauri::command]
pub async fn download_git_init(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
) -> Result<bool, String> {
    let download_root = resolve_download_root(&app_handle, &state).await?;
    let git_dir = download_root.join(".git");
    if git_dir.exists() {
        return Ok(false);
    }
    let output = std::process::Command::new("git")
        .arg("init")
        .current_dir(&download_root)
        .output()
        .map_err(|e| format!("Failed to run git init: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git init failed: {stderr}"));
    }
    Ok(true)
}

/// Stage all changes and commit in the download root git repo.
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
        return Err("No git repository in download root. Run download_git_init first.".to_string());
    }

    // Stage all changes.
    let add_output = std::process::Command::new("git")
        .args(["add", "."])
        .current_dir(&download_root)
        .output()
        .map_err(|e| format!("Failed to run git add: {e}"))?;
    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(format!("git add failed: {stderr}"));
    }

    // Commit.
    let commit_output = std::process::Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&download_root)
        .output()
        .map_err(|e| format!("Failed to run git commit: {e}"))?;
    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        // "nothing to commit" is not an error — return empty string.
        if stderr.contains("nothing to commit") {
            return Ok(String::new());
        }
        return Err(format!("git commit failed: {stderr}"));
    }

    // Get the commit hash.
    let hash_output = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&download_root)
        .output()
        .map_err(|e| format!("Failed to get commit hash: {e}"))?;
    if !hash_output.status.success() {
        return Ok(String::new());
    }
    let hash = String::from_utf8_lossy(&hash_output.stdout).trim().to_string();
    Ok(hash)
}
