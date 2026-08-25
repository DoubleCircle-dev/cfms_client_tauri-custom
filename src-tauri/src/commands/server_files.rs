// Server-side file reading commands.
//
// Reads document content directly from the CFMS server over the encrypted
// transfer protocol, using the same flow as the avatar download cache. The
// chat viewer uses this to fetch `.runtime/chatbox/*.txt` records from the
// server file tree without depending on the local download directory.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use tauri_plugin_opener::OpenerExt;

const MAX_READ_BYTES: u64 = 8 * 1024 * 1024;
const MAX_LOCAL_TEXT_BYTES: u64 = 4 * 1024 * 1024;
const MAX_PREVIEW_TEXT_BYTES: u64 = 4 * 1024 * 1024;
const PREVIEW_CACHE_DIR: &str = "preview_cache";
const PREVIEW_CACHE_MAX_AGE_SECS: u64 = 7 * 24 * 60 * 60;

#[derive(serde::Serialize)]
pub struct ServerTextFile {
    pub content: String,
    pub size: u64,
    pub truncated: bool,
}

#[derive(serde::Serialize)]
pub struct PreparedFilePreview {
    pub path: String,
    pub size: u64,
    pub cached: bool,
}

#[derive(serde::Serialize)]
pub struct ServerTextBytes {
    pub base64: String,
    pub size: u64,
    pub truncated: bool,
}

#[derive(serde::Serialize)]
pub struct LocalChatboxFile {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: u64,
    pub content: Option<String>,
    pub truncated: bool,
}

#[derive(serde::Serialize)]
pub struct LocalChatboxRoom {
    pub id: String,
    pub files: Vec<LocalChatboxFile>,
}

fn local_attachment_kind(name: &str) -> &'static str {
    let ext = Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp"
    ) {
        "image"
    } else if matches!(
        ext.as_str(),
        "mp3" | "wav" | "ogg" | "m4a" | "flac" | "aac"
    ) {
        "audio"
    } else {
        "other"
    }
}

/// Open a local file with the system default application.
///
/// The opener plugin's IPC `open_path` is additionally restricted by an ACL
/// path scope, so this command invokes the plugin's Rust-side opener directly.
/// The path always comes from the user's own local chatbox scan.
#[tauri::command]
pub fn open_local_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let trimmed = path.trim();
    let file_path = Path::new(trimmed);
    if trimmed.is_empty() || !file_path.is_absolute() || file_path.file_name().is_none() {
        return Err("Invalid local file path".to_string());
    }
    if !file_path.exists() {
        return Err(format!("File not found: {trimmed}"));
    }
    app.opener()
        .open_path(trimmed, None::<&str>)
        .map_err(|e| format!("Failed to open file: {e}"))
}

fn read_text_capped(path: &Path) -> (String, bool) {
    let Ok(file) = std::fs::File::open(path) else {
        return (String::new(), false);
    };
    let mut buf = Vec::new();
    if file
        .take(MAX_LOCAL_TEXT_BYTES + 1)
        .read_to_end(&mut buf)
        .is_err()
    {
        return (String::new(), false);
    }
    let truncated = buf.len() as u64 > MAX_LOCAL_TEXT_BYTES;
    buf.truncate(MAX_LOCAL_TEXT_BYTES as usize);
    (String::from_utf8_lossy(&buf).into_owned(), truncated)
}

fn sorted_dir_entries(dir: &Path) -> Vec<PathBuf> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|reader| reader.filter_map(|entry| entry.ok().map(|e| e.path())).collect())
        .unwrap_or_default();
    entries.sort();
    entries
}

/// Scan a local chatbox folder (the `.runtime/chatbox` directory or the
/// download root containing it) without contacting the server.
///
/// Each room subfolder yields its `.txt` record files (content decoded as
/// UTF-8, lossy, capped at 4 MiB) plus attachment entries. Parsing happens on
/// the frontend so local and online modes share the same message parser.
#[tauri::command]
pub fn scan_local_chatbox(dir: String) -> Result<Vec<LocalChatboxRoom>, String> {
    let picked = PathBuf::from(&dir);
    let root = if picked.join(".runtime").join("chatbox").is_dir() {
        picked.join(".runtime").join("chatbox")
    } else {
        picked
    };
    if !root.is_dir() {
        return Err(format!("Folder not found: {}", root.to_string_lossy()));
    }

    let mut rooms = Vec::new();
    for room_dir in sorted_dir_entries(&root) {
        if !room_dir.is_dir() {
            continue;
        }
        let room_id = room_dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if room_id.is_empty() || room_id.starts_with('.') {
            continue;
        }

        let mut files = Vec::new();
        for path in sorted_dir_entries(&room_dir) {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if name.is_empty() || name.starts_with('.') {
                continue;
            }
            let size = path.metadata().map(|m| m.len()).unwrap_or(0);
            let is_txt = path
                .extension()
                .map(|ext| ext.eq_ignore_ascii_case("txt"))
                .unwrap_or(false);
            let kind = if is_txt {
                "text".to_string()
            } else {
                local_attachment_kind(&name).to_string()
            };
            if is_txt {
                let (content, truncated) = read_text_capped(&path);
                files.push(LocalChatboxFile {
                    name,
                    path: path.to_string_lossy().into_owned(),
                    kind,
                    size,
                    content: Some(content),
                    truncated,
                });
            } else {
                files.push(LocalChatboxFile {
                    name,
                    path: path.to_string_lossy().into_owned(),
                    kind,
                    size,
                    content: None,
                    truncated: false,
                });
            }
        }

        rooms.push(LocalChatboxRoom {
            id: room_id,
            files,
        });
    }

    Ok(rooms)
}

/// Download a server document into a temporary file and return its text.
///
/// Sends the `get_document` action to obtain a download task, transfers the
/// file through the encrypted transfer protocol, then reads the decrypted
/// bytes as UTF-8 (lossy). The temporary file is removed before returning.
#[tauri::command]
pub async fn read_server_document(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
) -> Result<ServerTextFile, String> {
    let temp_dir = tempfile::tempdir()
        .map_err(|e| format!("Failed to create temporary directory: {e}"))?;
    let dest = temp_dir.path().join("chat.txt");
    download_document_to(&state, &document_id, &dest).await?;

    let size = std::fs::metadata(&dest)
        .map_err(|e| format!("Failed to stat downloaded file: {e}"))?
        .len();
    let file = std::fs::File::open(&dest)
        .map_err(|e| format!("Failed to open downloaded file: {e}"))?;
    let mut buf = Vec::new();
    file.take(MAX_READ_BYTES + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("Failed to read downloaded file: {e}"))?;

    let truncated = buf.len() as u64 > MAX_READ_BYTES;
    buf.truncate(MAX_READ_BYTES as usize);
    let content = String::from_utf8_lossy(&buf).into_owned();

    Ok(ServerTextFile {
        content,
        size,
        truncated,
    })
}

/// Download a server document into `dest` through the encrypted transfer
/// protocol. Shared by the text reader and the file preview commands.
async fn download_document_to(
    state: &AppHandleState,
    document_id: &str,
    dest: &Path,
) -> Result<(), String> {
    let (conn, username, token) = get_connection_auth(state).await?;

    let resp = send_action_request(
        &conn,
        "get_document",
        serde_json::json!({"document_id": document_id}),
        &username,
        &token,
    )
    .await?;

    if resp.code == 403 {
        return Err(format!("Access denied: {}", resp.message));
    }
    if resp.code == 404 {
        return Err("Document not found on server".to_string());
    }
    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    let task_id = resp.data["task_data"]["task_id"]
        .as_str()
        .ok_or_else(|| "Server response missing task_id".to_string())?
        .to_string();

    let transfer_conn = create_transfer_connection(&state.inner).await?;
    let progress = |_phase: cfms_core::DownloadPhase,
                    _progress: f64,
                    _message: &str,
                    _current: u64,
                    _total: u64| {};
    let max_chunk_size = state
        .inner
        .download_max_chunk_size
        .load(std::sync::atomic::Ordering::Relaxed) as u32;

    let result = cfms_transfer::download::receive(
        &transfer_conn,
        &task_id,
        dest,
        max_chunk_size,
        &progress,
    )
    .await;
    transfer_conn.close().await;
    result.map_err(|e| format!("Document download failed: {e}"))?;
    Ok(())
}

/// Prepare a server document for inline preview.
///
/// Downloads the file into the persistent preview cache
/// `{app_data}/preview_cache/{document_id}.{ext}` (unless already cached) and
/// returns the local path, which the frontend serves through the asset
/// protocol. Stale cache entries are cleaned at startup.
#[tauri::command]
pub async fn prepare_file_preview(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    filename: String,
) -> Result<PreparedFilePreview, String> {
    let safe_id = sanitize_cache_id(&document_id)?;
    let ext = Path::new(&filename)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if ext.is_empty() || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Unsupported file name for preview".to_string());
    }

    let cache_dir = state.app_data_dir.join(PREVIEW_CACHE_DIR);
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create preview cache: {e}"))?;
    let cache_path = cache_dir.join(format!("{safe_id}.{ext}"));

    if cache_path.exists() {
        let size = std::fs::metadata(&cache_path)
            .map_err(|e| format!("Failed to stat cached preview: {e}"))?
            .len();
        return Ok(PreparedFilePreview {
            path: cache_path.to_string_lossy().into_owned(),
            size,
            cached: true,
        });
    }

    download_document_to(&state, &document_id, &cache_path).await?;
    let size = std::fs::metadata(&cache_path)
        .map_err(|e| format!("Failed to stat downloaded preview: {e}"))?
        .len();
    Ok(PreparedFilePreview {
        path: cache_path.to_string_lossy().into_owned(),
        size,
        cached: false,
    })
}

/// Download a server document and return its raw bytes as base64.
///
/// The frontend detects the encoding (UTF-8 / UTF-16 / GBK) from the raw
/// bytes, so text files saved in legacy encodings preview correctly.
#[tauri::command]
pub async fn read_file_preview_text(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
) -> Result<ServerTextBytes, String> {
    let temp_dir = tempfile::tempdir()
        .map_err(|e| format!("Failed to create temporary directory: {e}"))?;
    let dest = temp_dir.path().join("preview.txt");
    download_document_to(&state, &document_id, &dest).await?;

    let size = std::fs::metadata(&dest)
        .map_err(|e| format!("Failed to stat downloaded file: {e}"))?
        .len();
    let file = std::fs::File::open(&dest)
        .map_err(|e| format!("Failed to open downloaded file: {e}"))?;
    let mut buf = Vec::new();
    file.take(MAX_PREVIEW_TEXT_BYTES + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("Failed to read downloaded file: {e}"))?;
    let truncated = buf.len() as u64 > MAX_PREVIEW_TEXT_BYTES;
    buf.truncate(MAX_PREVIEW_TEXT_BYTES as usize);

    Ok(ServerTextBytes {
        base64: base64ct::Base64::encode_string(&buf),
        size,
        truncated,
    })
}

fn sanitize_cache_id(document_id: &str) -> Result<String, String> {
    if document_id.is_empty()
        || !document_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid document id".to_string());
    }
    Ok(document_id.to_string())
}

/// Remove preview cache entries older than 7 days. Called once at startup.
pub fn cleanup_preview_cache(app_data_dir: &Path) {
    let cache_dir = app_data_dir.join(PREVIEW_CACHE_DIR);
    let Ok(entries) = std::fs::read_dir(&cache_dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .map(|age| age.as_secs() > PREVIEW_CACHE_MAX_AGE_SECS)
            .unwrap_or(false);
        if stale {
            let _ = std::fs::remove_file(&path);
        }
    }
}
