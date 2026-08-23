// Server-side file reading commands.
//
// Reads document content directly from the CFMS server over the encrypted
// transfer protocol, using the same flow as the avatar download cache. The
// chat viewer uses this to fetch `.runtime/chatbox/*.txt` records from the
// server file tree without depending on the local download directory.

use std::io::Read;

const MAX_READ_BYTES: u64 = 8 * 1024 * 1024;

#[derive(serde::Serialize)]
pub struct ServerTextFile {
    pub content: String,
    pub size: u64,
    pub truncated: bool,
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
