//! Device preference DEKs live in the OS vault. The reset index contains only opaque account IDs.
use cfms_service::sensitive::SecretKey;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, Runtime};

const SERVICE: &str = "org.crpteam.cfms_client_tauri.preference-keys";
#[derive(Default)]
pub struct PreferenceKeys {
    pub operation: Mutex<()>,
}
#[derive(Serialize, Deserialize)]
pub struct Record {
    pub key: String,
    pub local_only: bool,
}
impl Drop for Record {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.key.zeroize();
    }
}
pub fn account(server: &str, user_id: &str) -> String {
    format!("{}:{user_id}", cfms_core::get_server_hash(server))
}
fn index_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| crate::secure_store::UNAVAILABLE)?
        .join("preference-key-index.json"))
}
fn index<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Vec<String>, String> {
    let path = index_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    serde_json::from_slice(&std::fs::read(path).map_err(|_| crate::secure_store::UNAVAILABLE)?)
        .map_err(|_| crate::secure_store::UNAVAILABLE.into())
}
pub fn read<R: Runtime>(
    app: &tauri::AppHandle<R>,
    account: &str,
) -> Result<Option<(SecretKey, bool)>, String> {
    let Some(raw) = crate::secure_store::SecretStore::new(app, SERVICE, account).read()? else {
        return Ok(None);
    };
    let record: Record =
        serde_json::from_str(&raw).map_err(|_| crate::secure_store::UNAVAILABLE)?;
    let mut key = zeroize::Zeroizing::new([0u8; 32]);
    hex::decode_to_slice(&record.key, &mut *key).map_err(|_| crate::secure_store::UNAVAILABLE)?;
    Ok(Some((key, record.local_only)))
}
pub fn save<R: Runtime>(
    app: &tauri::AppHandle<R>,
    account: &str,
    key: &SecretKey,
    local_only: bool,
) -> Result<(), String> {
    let mut accounts = index(app)?;
    if !accounts.iter().any(|a| a == account) {
        accounts.push(account.into());
        let path = index_path(app)?;
        std::fs::create_dir_all(path.parent().unwrap())
            .map_err(|_| crate::secure_store::UNAVAILABLE)?;
        // Index before saving so reset always knows every possible OS-vault entry.
        std::fs::write(path, serde_json::to_vec(&accounts).unwrap())
            .map_err(|_| crate::secure_store::UNAVAILABLE)?;
    }
    let raw = zeroize::Zeroizing::new(
        serde_json::to_string(&Record {
            key: hex::encode(**key),
            local_only,
        })
        .unwrap(),
    );
    crate::secure_store::SecretStore::new(app, SERVICE, account).save(&raw)
}
pub fn clear<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    for account in index(app)? {
        crate::secure_store::SecretStore::new(app, SERVICE, &account).delete()?;
    }
    let path = index_path(app)?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|_| crate::secure_store::UNAVAILABLE)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn account_scope_separates_servers_and_user_ids() {
        assert_ne!(
            super::account("a:443", "alice"),
            super::account("b:443", "alice")
        );
        assert_ne!(
            super::account("a:443", "alice"),
            super::account("a:443", "bob")
        );
    }
}
