// The token is write-only across the IPC boundary. Read operations return
// configuration state, never the credential itself.

#[tauri::command]
pub async fn get_github_auth_status(
    credentials: tauri::State<'_, crate::github_credentials::GithubCredentialState>,
) -> Result<crate::github_credentials::GithubAuthStatus, String> {
    Ok(credentials.status().await)
}

#[tauri::command]
pub async fn save_github_token(
    credentials: tauri::State<'_, crate::github_credentials::GithubCredentialState>,
    token: String,
) -> Result<(), String> {
    credentials.save(token).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_github_token(
    credentials: tauri::State<'_, crate::github_credentials::GithubCredentialState>,
) -> Result<(), String> {
    credentials.delete().await?;
    Ok(())
}
