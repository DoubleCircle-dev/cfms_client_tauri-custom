// Protocol 28 authentication. Continuation and elevated tokens remain native-only.
use cfms_service::authentication::{
    AUTH, ESCALATED, GENERAL, IssuedToken, POST_AUTH, PendingAuthentication,
};

#[tauri::command]
pub async fn login(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    password: String,
) -> Result<serde_json::Value, String> {
    let password = zeroize::Zeroizing::new(password);
    state.inner.clear_auth().await;
    let generation = state
        .inner
        .auth_generation
        .load(std::sync::atomic::Ordering::SeqCst);
    let conn = state
        .inner
        .conn
        .read()
        .await
        .clone()
        .ok_or("Not connected to a server")?;
    let request = cfms_service::sensitive::SensitiveJson::new(serde_json::json!({
        "action": "login",
        "data": {"method": "password", "credential": {"username": &username, "password": password.as_str()}},
    }));
    let response = send_auth_request(&conn, request).await?;
    finish_authentication(&state, &username, response, generation).await
}

async fn send_auth_request(
    conn: &cfms_transport::Connection,
    request: cfms_service::sensitive::SensitiveJson,
) -> Result<cfms_core::Response, String> {
    let mut stream = conn.create_stream().await.map_err(|e| e.to_string())?;
    let bytes =
        zeroize::Zeroizing::new(serde_json::to_vec(request.as_value()).map_err(|e| e.to_string())?);
    stream
        .send_sensitive(conn, bytes)
        .await
        .map_err(|e| e.to_string())?;
    let bytes = stream.recv().await.ok_or_else(|| {
        if let Some(close) = conn.close_info()
            && close.code == 1013
        {
            return format_server_error_parts(
                503,
                &close.reason,
                &serde_json::json!({"close_code":close.code}),
            );
        }
        "Connection closed before authentication response".into()
    })?;
    let bytes = zeroize::Zeroizing::new(bytes);
    serde_json::from_slice(&bytes).map_err(|e| format!("Invalid authentication response: {e}"))
}

async fn finish_authentication(
    state: &AppHandleState,
    username: &str,
    mut response: cfms_core::Response,
    generation: u64,
) -> Result<serde_json::Value, String> {
    let _update = state.inner.auth_update.lock().await;
    if state
        .inner
        .auth_generation
        .load(std::sync::atomic::Ordering::SeqCst)
        != generation
    {
        return Err("Authentication was cancelled".into());
    }
    match response.code {
        200 => {
            apply_successful_login_response(state, username, &mut response.data, true, true)
                .await?;
            let mut status = build_auth_status(&state.inner).await;
            status["needs_preference_dek_setup"] = true.into();
            Ok(status)
        }
        202 | 4001 | 4002 => {
            let purpose = if response.code == 202 {
                AUTH
            } else {
                POST_AUTH
            };
            let issued = IssuedToken::from_response(&mut response.data, purpose)?;
            let methods = response.data["methods"]
                .as_array()
                .map(|methods| {
                    methods
                        .iter()
                        .filter_map(|m| m.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            *state.inner.pending_auth.write().await = Some(PendingAuthentication {
                username: username.to_string(),
                issued,
                methods,
            });
            if response.code == 202 {
                Ok(build_auth_status(&state.inner).await)
            } else {
                Err(format_server_response_error(&response))
            }
        }
        _ => Err(format_server_response_error(&response)),
    }
}

#[tauri::command]
pub async fn complete_login_mfa(
    state: tauri::State<'_, AppHandleState>,
    method: String,
    data: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let data = cfms_service::sensitive::SensitiveJson::new(data);
    let generation = state
        .inner
        .auth_generation
        .load(std::sync::atomic::Ordering::SeqCst);
    let (username, token) = {
        let pending = state.inner.pending_auth.read().await;
        let pending = pending
            .as_ref()
            .ok_or("Restart login to complete authentication")?;
        if pending.issued.claims.purpose != AUTH
            || !pending.methods.contains(&method)
            || pending.issued.claims.exp <= cfms_service::authentication::unix_now()
        {
            return Err("Authentication method unavailable or login expired".into());
        }
        (pending.username.clone(), pending.issued.secret.clone())
    };
    let conn = state
        .inner
        .conn
        .read()
        .await
        .clone()
        .ok_or("Not connected to a server")?;
    let response = send_action_request(
        &conn,
        "exchange_token",
        serde_json::json!({
            "method":method, "data":data.as_value(), "target_purpose":GENERAL,
        }),
        &username,
        &token,
    )
    .await?;
    finish_authentication(&state, &username, response, generation).await
}

#[tauri::command]
pub async fn get_user_authentication(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;
    let response = send_action_request(
        &conn,
        "get_user_authentication",
        serde_json::json!({}),
        &username,
        &token,
    )
    .await?;
    if response.code != 200 {
        return Err(format_server_response_error(&response));
    }
    Ok(response.data)
}

#[tauri::command]
pub async fn request_escalation(
    state: tauri::State<'_, AppHandleState>,
    method: Option<String>,
    data: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let generation = state
        .inner
        .auth_generation
        .load(std::sync::atomic::Ordering::SeqCst);
    let (conn, username, _) = get_connection_auth(&state).await?;
    let source = state
        .inner
        .token
        .read()
        .await
        .clone()
        .ok_or("Not logged in")?;
    let source_claims = cfms_service::authentication::decode_claims(&source)?;
    let mut payload = serde_json::json!({"target_purpose":ESCALATED});
    if let Some(method) = method {
        payload["method"] = method.into();
    }
    if let Some(data) = data {
        payload["data"] = data;
    }
    let mut response =
        send_action_request(&conn, "exchange_token", payload, &username, &source).await?;
    if response.code != 200 {
        return Err(format_server_response_error(&response));
    }
    let issued = IssuedToken::from_response(&mut response.data, ESCALATED)?;
    if issued.claims.sub != source_claims.sub {
        return Err("Escalation account mismatch".into());
    }
    let _update = state.inner.auth_update.lock().await;
    if state
        .inner
        .auth_generation
        .load(std::sync::atomic::Ordering::SeqCst)
        != generation
    {
        return Err("Authentication was cancelled".into());
    }
    *state.inner.escalation.write().await = Some(issued);
    Ok(build_auth_status(&state.inner).await)
}
