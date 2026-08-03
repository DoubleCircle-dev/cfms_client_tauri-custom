// Dev-only: raw request command for security testing.
// ---------------------------------------------------------------------------
//
// This command is only compiled in debug builds and provides a low-level
// escape hatch for sending arbitrary JSON frames through the existing
// WebSocket connection.  It is intended exclusively for authorized security
// audits during development.
//
// # Safety
//
// NEVER expose this in release builds.  It is gated behind `#[cfg(debug_assertions)]`.

/// Send a raw JSON payload over the existing WebSocket connection and
/// return the raw JSON response.
///
/// The payload is sent as a Process frame on a fresh client stream.
/// If `authenticated` is true, the current username/token are injected
/// into the payload automatically (adding `username`, `token`, `timestamp`,
/// `nonce` fields).  When false, the payload is sent as-is — this is
/// necessary to reproduce the unauthenticated-access vulnerabilities.
#[tauri::command]
#[allow(unused)]
pub async fn send_raw_request(
    state: tauri::State<'_, AppHandleState>,
    payload: String,
    authenticated: bool,
) -> Result<String, String> {
    // --- Parse the caller-supplied JSON ---
    let mut value: serde_json::Value =
        serde_json::from_str(&payload).map_err(|e| format!("Invalid JSON: {e}"))?;

    // --- Get the active connection (no auth required) ---
    let conn = {
        let c = state.inner.conn.read().await;
        c.clone()
    }
    .ok_or_else(|| "Not connected to a server".to_string())?;

    if authenticated {
        // Inject auth fields
        let username = state
            .inner
            .username
            .read()
            .await
            .clone()
            .ok_or_else(|| "Not logged in — use authenticated=false".to_string())?;
        let token = state
            .inner
            .token
            .read()
            .await
            .clone()
            .ok_or_else(|| "Not logged in — use authenticated=false".to_string())?;

        let random_bytes: [u8; 16] = rand::rng().random();
        let nonce = hex::encode(random_bytes);
        let timestamp = unix_now() as u64;

        if let serde_json::Value::Object(ref mut map) = value {
            map.insert("username".into(), serde_json::Value::String(username));
            map.insert("token".into(), serde_json::Value::String(token));
            map.insert("timestamp".into(), serde_json::Value::Number(timestamp.into()));
            map.insert("nonce".into(), serde_json::Value::String(nonce));
        }
    }

    let request_bytes =
        serde_json::to_vec(&value).map_err(|e| format!("Failed to encode request: {e}"))?;

    // --- Create a short-lived stream ---
    let mut stream = conn
        .create_stream()
        .await
        .map_err(|e| format!("Failed to create stream: {e}"))?;

    // --- Send and read (same pattern as shared_helpers::send_action_request) ---
    stream
        .send(&conn, request_bytes)
        .await
        .map_err(|e| format!("Failed to send: {e}"))?;

    let response_bytes = match stream.recv().await {
        Some(bytes) => bytes,
        None => {
            if let Some(close) = conn.close_info() {
                return Err(format!(
                    "Connection closed (code: {}, reason: {})",
                    close.code, close.reason
                ));
            }
            return Err("Connection closed before response".into());
        }
    };

    String::from_utf8(response_bytes).map_err(|e| format!("Invalid UTF-8 response: {e}"))
}

/// Open the dev tools in a separate window (like DevTools).
///
/// Creates a new webview window that loads the vulnerability testing page.
/// Only available in debug builds.
#[tauri::command]
#[allow(unused)]
pub async fn open_dev_tools_window(
    app: tauri::AppHandle,
) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    // Check if the window is already open
    if let Some(existing) = app.get_webview_window("dev-tools") {
        existing
            .set_focus()
            .map_err(|e| format!("Failed to focus dev-tools window: {e}"))?;
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, "dev-tools", tauri::WebviewUrl::App("/dev/server-vuln-test".into()))
        .title("CFMS 漏洞测试工具")
        .inner_size(960.0, 720.0)
        .min_inner_size(640.0, 480.0)
        .resizable(true)
        .center()
        .build()
        .map_err(|e| format!("Failed to create dev-tools window: {e}"))?;

    Ok(())
}
