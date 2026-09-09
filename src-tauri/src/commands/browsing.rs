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
        failure_kind: None,
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
        server_task_recreate_count: 0,
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

/// Create an empty placeholder file inside the local download root at the
/// given relative path.
///
/// Parent directories are created first, so nested relative paths never fail
/// with "path not found" (os error 3) — a placeholder at `a/b.txt` still works
/// when `a/` does not exist yet.
///
/// The sync flow uses this to mirror server items that exist but are
/// inaccessible (permission denied): a same-named empty file occupies the
/// item's relative path so the local tree reflects the server instead of
/// silently dropping the folder/file.
#[tauri::command]
pub async fn create_download_placeholder(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    relative_path: String,
) -> Result<bool, String> {
    let download_root = resolve_download_root(&app_handle, &state).await?;
    let file_path = resolve_download_subdirectory(download_root, &relative_path)?;
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create placeholder directory: {e}"))?;
    }
    match std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(&file_path)
    {
        Ok(_) => Ok(true),
        Err(e) => Err(format!("Failed to create placeholder file: {e}")),
    }
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
            // Never descend into git metadata — its object files must not be
            // treated as ordinary download files, or the sync deletion pass
            // would wipe the repository's object store.
            if path.file_name().map(|n| n == ".git").unwrap_or(false) {
                continue;
            }
            collect_relative_files(root, &path, out)?;
        } else {
            // Git bookkeeping at the repo root (`.gitignore` keeps large
            // downloads out of the repo) is not server content and must never
            // surface as a download file or deletion candidate.
            if path.file_name().map(|n| n == ".gitignore").unwrap_or(false) {
                continue;
            }
            if let Ok(rel) = path.strip_prefix(root) {
                // Normalize to forward slashes so paths match the frontend's
                // serverPaths (which uses '/'), regardless of platform separator.
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    Ok(())
}

/// Check whether a git repository exists in the download root.
/// Used by the sync flow to decide between git-tracked forced overwrite and
/// timestamped backup renaming.
#[tauri::command]
pub async fn download_git_present(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
) -> Result<bool, String> {
    let download_root = resolve_download_root(&app_handle, &state).await?;
    Ok(download_root.join(".git").exists())
}

/// Initialize a git repository in the download root (no-op if already initialized).
#[tauri::command]
pub async fn download_git_init(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
) -> Result<bool, String> {
    let download_root = resolve_download_root(&app_handle, &state).await?;
    // The download root may not exist yet (e.g. external storage was just
    // configured or never written to). Spawning git with a non-existent
    // current directory fails on Windows with ERROR_DIRECTORY
    // ("os error 267: the directory name is invalid"), so create it first.
    std::fs::create_dir_all(&download_root)
        .map_err(|e| format!("Failed to create download directory: {e}"))?;
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
///
/// Files at or above [`LARGE_FILE_THRESHOLD_BYTES`] are never committed with
/// their real content: the real file stays on disk (git-ignored, marked
/// `skip-worktree`) while the same-named path in the repo holds a placeholder
/// text describing the file and its SHA-256 — see
/// [`stage_large_file_placeholders`].
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

    // Replace every large file with a same-named placeholder in the index
    // (this also appends them to `.gitignore`, so the `git add .` below never
    // stages their real bytes).
    stage_large_file_placeholders(&download_root)?;

    // Stage all remaining changes (small files, renames, deletions, and the
    // `.gitignore` rules for large files).
    run_git(&download_root, &["add", "."])?;

    // Commit.
    let commit_msg = message.trim();
    let commit_output = std::process::Command::new("git")
        .args(["commit", "-m", commit_msg])
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
    match run_git(&download_root, &["rev-parse", "HEAD"]) {
        Ok(hash) => Ok(hash),
        Err(_) => Ok(String::new()),
    }
}

// ---------------------------------------------------------------------------
// Large-file placeholders in the download-root git repo
// ---------------------------------------------------------------------------

/// Files at or above this size are not committed to the download-root git
/// repository. GitHub refuses per-file pushes over 100 MB, so the real file
/// stays on disk while the repo records a same-named placeholder (description
/// + SHA-256) in its place.
const LARGE_FILE_THRESHOLD_BYTES: u64 = 100 * 1024 * 1024; // 100 MiB

/// Recursively collect every regular file under `root` whose size is at or
/// above `threshold`, returning its absolute path and byte size. Git
/// bookkeeping (the `.git` directory) is skipped.
fn collect_large_files(
    root: &std::path::Path,
    current: &std::path::Path,
    threshold: u64,
    out: &mut Vec<(std::path::PathBuf, u64)>,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name == ".git" {
                continue;
            }
            collect_large_files(root, &path, threshold, out)?;
        } else if let Ok(meta) = entry.metadata()
            && meta.len() >= threshold
            && path.strip_prefix(root).is_ok()
        {
            out.push((path, meta.len()));
        }
    }
    Ok(())
}

/// Compute the SHA-256 hex digest of a file without loading it fully into
/// memory, so very large files hash safely.
fn file_sha256(path: &std::path::Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let file =
        std::fs::File::open(path).map_err(|e| format!("Failed to open file for hashing: {e}"))?;
    let mut reader = std::io::BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 1024 * 1024];
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("Failed to read file for hashing: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Escape a path for use as a single anchored line in `.gitignore` (a leading
/// `#` would become a comment, a leading `!` would negate the rule).
fn gitignore_escape(rel: &str) -> String {
    let mut out = String::with_capacity(rel.len() + 4);
    for (i, ch) in rel.char_indices() {
        if i == 0 && (ch == '#' || ch == '!') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// Ensure `.gitignore` at the repo root contains an anchored rule ignoring
/// `rel`. Returns whether a new rule was appended.
fn ensure_gitignored(root: &std::path::Path, rel: &str) -> Result<bool, String> {
    let ignore_path = root.join(".gitignore");
    let existing = if ignore_path.exists() {
        std::fs::read_to_string(&ignore_path)
            .map_err(|e| format!("Failed to read .gitignore: {e}"))?
    } else {
        String::new()
    };
    let line = format!("/{}", gitignore_escape(rel));
    if existing.lines().any(|l| l == line) {
        return Ok(false);
    }
    let mut updated = existing;
    if !updated.is_empty() && !updated.ends_with('\n') {
        updated.push('\n');
    }
    updated.push_str(&line);
    updated.push('\n');
    std::fs::write(&ignore_path, updated)
        .map_err(|e| format!("Failed to write .gitignore: {e}"))?;
    Ok(true)
}

/// Build the placeholder text recorded in git for a file that is intentionally
/// not committed (it exceeds GitHub's 100 MB per-file limit). The same-named
/// path in the repo holds this text so viewers know the file exists but lives
/// elsewhere (a GitHub Release).
fn large_file_placeholder_text(rel: &str, sha256: &str, size_bytes: u64) -> String {
    format!(
        "该文件大于100MB。如果在github中查看请检查release。\n\
         此文件超过 100 MB（GitHub 单文件大小上限），因此未纳入 Git 仓库；\n\
         仓库中该路径为同名占位文件，请从 GitHub Releases 或原服务器获取真实文件。\n\
         \n\
         文件名: {rel}\n\
         大小: {size_bytes} bytes ({:.1} MB)\n\
         SHA-256: {sha256}\n",
        size_bytes as f64 / (1024.0 * 1024.0)
    )
}

/// Run `git` in `root` and return its trimmed stdout, erroring on failure.
fn run_git(root: &std::path::Path, args: &[&str]) -> Result<String, String> {
    let git = args.first().copied().unwrap_or("");
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| format!("Failed to run git {git}: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git {git} failed: {stderr}"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Run `git` in `root`, writing `stdin` to the process, and return its trimmed
/// stdout. Used for `hash-object --stdin` and `update-index --index-info`.
fn run_git_with_stdin(
    root: &std::path::Path,
    args: &[&str],
    stdin: &[u8],
) -> Result<String, String> {
    use std::io::Write as _;
    let git = args.first().copied().unwrap_or("");
    let mut child = std::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn git {git}: {e}"))?;
    {
        let mut child_stdin = child.stdin.take().expect("git stdin should be piped");
        child_stdin
            .write_all(stdin)
            .map_err(|e| format!("Failed to write to git stdin: {e}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for git {git}: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git {git} failed: {stderr}"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Run `git` in `root` and return raw stdout bytes, erroring on failure.
/// Used when the output must be parsed byte-exactly (e.g. NUL-separated
/// `ls-files -vz` output).
fn run_git_raw(root: &std::path::Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let git = args.first().copied().unwrap_or("");
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| format!("Failed to run git {git}: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git {git} failed: {stderr}"));
    }
    Ok(output.stdout)
}

/// List index paths with the skip-worktree bit set — i.e. paths recorded as
/// large-file placeholders in an earlier commit. Paths are NUL-separated by
/// `git ls-files -vz`, so entries containing spaces parse correctly.
fn list_skip_worktree_paths(root: &std::path::Path) -> Result<Vec<String>, String> {
    let raw = run_git_raw(root, &["ls-files", "-vz"])?;
    let text = String::from_utf8_lossy(&raw);
    let mut out = Vec::new();
    for chunk in text.split('\0') {
        if let Some(path) = chunk.strip_prefix("S ")
            && !path.is_empty()
        {
            out.push(path.to_string());
        }
    }
    Ok(out)
}

/// Remove the anchored `.gitignore` rule for `rel`, if present. Returns
/// whether a line was removed.
fn remove_gitignore_rule(root: &std::path::Path, rel: &str) -> Result<bool, String> {
    let ignore_path = root.join(".gitignore");
    if !ignore_path.exists() {
        return Ok(false);
    }
    let existing = std::fs::read_to_string(&ignore_path)
        .map_err(|e| format!("Failed to read .gitignore: {e}"))?;
    let line = format!("/{}", gitignore_escape(rel));
    let kept: Vec<&str> = existing.lines().filter(|l| *l != line).collect();
    if kept.len() == existing.lines().count() {
        return Ok(false);
    }
    let mut updated = kept.join("\n");
    if !updated.is_empty() {
        updated.push('\n');
    }
    std::fs::write(&ignore_path, updated)
        .map_err(|e| format!("Failed to write .gitignore: {e}"))?;
    Ok(true)
}

/// For every file at or above [`LARGE_FILE_THRESHOLD_BYTES`] under `root`,
/// replace its index entry with a same-named placeholder blob.
///
/// The real file is left untouched on disk:
///  1. its path is appended to `.gitignore` so `git add .` never stages the
///     actual bytes (and future syncs won't re-stage them);
///  2. any previously committed real content is dropped from the index;
///  3. a placeholder blob (description + SHA-256, see
///     [`large_file_placeholder_text`]) is recorded under the file's own path,
///     so the repo contains a same-named placeholder while the real file stays
///     on disk;
///  4. the path is marked `skip-worktree` so git stops reporting the real
///     working file as modified.
fn stage_large_file_placeholders(root: &std::path::Path) -> Result<(), String> {
    // 1. Current large files on disk — every one becomes a same-named
    //    placeholder blob in the index (see [`large_file_placeholder_text`]).
    let mut large: Vec<(std::path::PathBuf, u64)> = Vec::new();
    collect_large_files(root, root, LARGE_FILE_THRESHOLD_BYTES, &mut large)
        .map_err(|e| format!("Failed to scan download root for large files: {e}"))?;
    let mut large_rel: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (path, size) in &large {
        let rel = path
            .strip_prefix(root)
            .map_err(|_| "Large file is outside the download root".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        large_rel.insert(rel.clone());

        // 1a. Ignore the real file so `git add .` never stages its bytes.
        ensure_gitignored(root, &rel)?;

        // 1b. Compute the SHA-256 of the real file (streamed, memory-safe).
        let sha256 = file_sha256(path)?;

        // 1c. Clear a stale skip-worktree flag and drop any previously
        //     committed real content so the index can be rewritten.
        let _ = run_git(root, &["update-index", "--no-skip-worktree", "--", &rel]);
        let _ = run_git(root, &["rm", "--cached", "--ignore-unmatch", "--", &rel]);

        // 1d. Record the placeholder blob under the SAME path in the index —
        //     the on-disk file is deliberately left untouched.
        let placeholder = large_file_placeholder_text(&rel, &sha256, *size);
        let blob = run_git_with_stdin(
            root,
            &["hash-object", "-w", "--stdin"],
            placeholder.as_bytes(),
        )?;
        if blob.is_empty() {
            return Err("git hash-object returned an empty blob hash".to_string());
        }
        let index_line = format!("100644 {blob}\t{rel}\n");
        run_git_with_stdin(
            root,
            &["update-index", "--add", "--index-info"],
            index_line.as_bytes(),
        )?;

        // 1e. Mark skip-worktree so git ignores the real file in the worktree.
        run_git(root, &["update-index", "--skip-worktree", "--", &rel])?;
    }

    // 2. Reconcile placeholder paths that are no longer large (deleted, or
    //    now below the threshold): clear their skip-worktree bit, drop the
    //    placeholder index entry, and remove the ignore rule. This lets the
    //    following `git add .` commit the real state — a re-added small file,
    //    or the deletion of a removed file — instead of leaving a stale
    //    placeholder behind.
    for stale in list_skip_worktree_paths(root)? {
        if large_rel.contains(&stale) {
            continue;
        }
        let _ = run_git(root, &["update-index", "--no-skip-worktree", "--", &stale]);
        let _ = run_git(root, &["rm", "--cached", "--ignore-unmatch", "--", &stale]);
        let _ = remove_gitignore_rule(root, &stale);
    }
    Ok(())
}

#[cfg(test)]
mod large_file_placeholder_tests {
    use super::*;

    #[test]
    fn placeholder_text_contains_required_note_and_sha256() {
        let text = large_file_placeholder_text("a/b.bin", "abc123", 150 * 1024 * 1024);
        assert!(text.contains("该文件大于100MB。如果在github中查看请检查release。"));
        assert!(text.contains("SHA-256: abc123"));
        assert!(text.contains("a/b.bin"));
        assert!(text.contains("150.0 MB"));
    }

    #[test]
    fn gitignore_escape_handles_comment_and_negation_prefixes() {
        assert_eq!(gitignore_escape("#leading"), "\\#leading");
        assert_eq!(gitignore_escape("!negated"), "\\!negated");
        assert_eq!(gitignore_escape("plain file.bin"), "plain file.bin");
    }

    #[test]
    fn ensure_gitignored_is_idempotent() {
        let dir = std::env::temp_dir().join(format!(
            "cfms-gitignore-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        assert!(ensure_gitignored(&dir, "big file.bin").unwrap());
        // Adding the same rule again must be a no-op.
        assert!(!ensure_gitignored(&dir, "big file.bin").unwrap());
        // A second, different rule still gets appended.
        assert!(ensure_gitignored(&dir, "other.bin").unwrap());

        let contents = std::fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert_eq!(contents.lines().count(), 2);
        assert!(contents.lines().any(|l| l == "/big file.bin"));
        assert!(contents.lines().any(|l| l == "/other.bin"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn remove_gitignore_rule_removes_only_the_matching_line() {
        let dir = std::env::temp_dir().join(format!(
            "cfms-gitignore-remove-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(".gitignore"), "/big file.bin\n/other.bin\n").unwrap();

        assert!(remove_gitignore_rule(&dir, "big file.bin").unwrap());
        // Removing the same rule again is a no-op.
        assert!(!remove_gitignore_rule(&dir, "big file.bin").unwrap());
        let contents = std::fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert_eq!(contents, "/other.bin\n");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn collect_large_files_finds_over_threshold_and_skips_git() {
        let dir = std::env::temp_dir().join(format!(
            "cfms-large-scan-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::create_dir_all(dir.join(".git")).unwrap();

        let small = dir.join("small.bin");
        let big = dir.join("sub").join("big.bin");
        let git_obj = dir.join(".git").join("big.bin");
        std::fs::File::create(&small).unwrap().set_len(5).unwrap();
        std::fs::File::create(&big).unwrap().set_len(100).unwrap();
        std::fs::File::create(&git_obj)
            .unwrap()
            .set_len(1000)
            .unwrap();

        let mut found = Vec::new();
        collect_large_files(&dir, &dir, 10, &mut found).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].0, big);
        assert_eq!(found[0].1, 100);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requires git on PATH; run explicitly with: cargo test -- --ignored"]
    fn stage_large_file_placeholders_records_same_named_placeholder() {
        let dir = std::env::temp_dir().join(format!(
            "cfms-git-placeholder-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let init = std::process::Command::new("git")
            .args(["init", "-q"])
            .current_dir(&dir)
            .output()
            .expect("git init should succeed");
        assert!(init.status.success());

        // Create a large file (above the threshold) at a nested, spaced path.
        let big_rel = "sub/big file.bin";
        let big_path = dir.join("sub").join("big file.bin");
        std::fs::create_dir_all(big_path.parent().unwrap()).unwrap();
        std::fs::File::create(&big_path)
            .unwrap()
            .set_len(LARGE_FILE_THRESHOLD_BYTES + 1)
            .unwrap();

        // Realistic flow: replace large files, stage everything, commit.
        stage_large_file_placeholders(&dir).unwrap();
        run_git(&dir, &["add", "."]).unwrap();
        run_git(&dir, &["commit", "-q", "-m", "test"]).unwrap();

        // The committed blob at the same path is the placeholder, not the file.
        let shown = run_git(&dir, &["show", &format!("HEAD:{big_rel}")]).unwrap();
        assert!(shown.contains("该文件大于100MB。如果在github中查看请检查release。"));
        assert!(shown.contains("SHA-256:"));

        // The real file is still on disk and the worktree is clean.
        assert_eq!(
            std::fs::metadata(&big_path).unwrap().len(),
            LARGE_FILE_THRESHOLD_BYTES + 1
        );
        assert_eq!(run_git(&dir, &["status", "--porcelain"]).unwrap(), "");

        // --- Transition: the file shrinks below the threshold. ---
        // The stale placeholder must be dropped and the real (small) content
        // committed on the next sync, leaving a clean worktree.
        std::fs::write(&big_path, b"now small").unwrap();
        stage_large_file_placeholders(&dir).unwrap();
        run_git(&dir, &["add", "."]).unwrap();
        run_git(&dir, &["commit", "-q", "-m", "test-small"]).unwrap();

        let shown = run_git(&dir, &["show", &format!("HEAD:{big_rel}")]).unwrap();
        assert_eq!(shown, "now small");
        assert_eq!(run_git(&dir, &["status", "--porcelain"]).unwrap(), "");
        assert!(
            !std::fs::read_to_string(dir.join(".gitignore"))
                .unwrap()
                .contains("/sub/big file.bin")
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
