// Server-side file reading commands.
//
// Reads document content directly from the CFMS server over the encrypted
// transfer protocol, using the same flow as the avatar download cache. The
// chat viewer uses this to fetch `.runtime/chatbox/*.txt` records from the
// server file tree without depending on the local download directory.

use std::io::Read;
use std::path::{Path, PathBuf};

use tauri_plugin_opener::OpenerExt;

const MAX_READ_BYTES: u64 = 8 * 1024 * 1024;
const MAX_LOCAL_TEXT_BYTES: u64 = 4 * 1024 * 1024;

#[derive(serde::Serialize)]
pub struct ServerTextFile {
    pub content: String,
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
    let (conn, username, token) = get_connection_auth(&state).await?;

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

    let temp_dir = tempfile::tempdir()
        .map_err(|e| format!("Failed to create temporary directory: {e}"))?;
    let dest = temp_dir.path().join("chat.txt");

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
        &dest,
        max_chunk_size,
        &progress,
    )
    .await;
    transfer_conn.close().await;
    result.map_err(|e| format!("Document download failed: {e}"))?;

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
