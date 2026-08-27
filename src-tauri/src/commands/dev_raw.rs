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
            map.insert("token".into(), serde_json::Value::String(token.to_string()));
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

/// Fetch a custom page/endpoint from the server via HTTP.
///
/// Derives the base HTTP URL from the stored server address and sends
/// an HTTP request to the given path.  Supports GET and POST methods.
///
/// Returns a JSON string with `status`, `headers`, and `body` fields
/// so the frontend can display the full response.
#[tauri::command]
#[allow(unused)]
pub async fn fetch_server_page(
    state: tauri::State<'_, AppHandleState>,
    path: String,
    method: String,
    headers: Option<String>,
    body: Option<String>,
) -> Result<String, String> {
    // --- Derive the HTTP base URL from the stored server address ---
    let server_addr = {
        let addr = state.inner.server_address.read().await;
        addr.clone()
    }
    .ok_or_else(|| "Not connected to a server — no server address available".to_string())?;

    // The stored address may be:
    //   - "wss://host:port/path" (WebSocket URL — convert to HTTPS)
    //   - "ws://host:port/path"  (plain WebSocket — convert to HTTP)
    //   - "https://host:port"    (already an HTTP URL)
    //   - "host:port"            (bare host:port)
    let base_url = {
        let trimmed = server_addr.trim_end_matches('/');
        if let Some(rest) = trimmed.strip_prefix("wss://") {
            format!("https://{rest}")
        } else if let Some(rest) = trimmed.strip_prefix("ws://") {
            format!("http://{rest}")
        } else if trimmed.starts_with("http") {
            trimmed.to_string()
        } else {
            format!("https://{trimmed}")
        }
    };

    let url = format!("{base_url}/{path}", path = path.trim_start_matches('/'));

    // --- Build the HTTP request ---
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true) // Dev tool: allow self-signed certs
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let mut request = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH" => client.patch(&url),
        "HEAD" => client.head(&url),
        other => return Err(format!("Unsupported HTTP method: {other}")),
    };

    // Add custom headers
    if let Some(ref hdrs) = headers {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(hdrs) {
            if let Some(obj) = parsed.as_object() {
                for (key, val) in obj {
                    if let Some(v) = val.as_str() {
                        request = request.header(key.as_str(), v);
                    }
                }
            }
        }
    }

    // Add body for methods that support it
    if let Some(ref b) = body {
        request = request.body(b.clone());
    }

    // --- Execute the request ---
    let response = request
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    let status = response.status().as_u16();
    let resp_headers: std::collections::HashMap<String, String> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("<binary>").to_string()))
        .collect();

    let resp_body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    let result = serde_json::json!({
        "url": url,
        "method": method.to_uppercase(),
        "status": status,
        "headers": resp_headers,
        "body": resp_body,
    });

    serde_json::to_string(&result).map_err(|e| format!("Failed to encode response: {e}"))
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
