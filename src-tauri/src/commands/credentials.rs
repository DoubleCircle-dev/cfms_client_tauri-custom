// Credential persistence — multi-account support
// ---------------------------------------------------------------------------
//
// Provides at-rest storage for login credentials (username + optionally
// password) across multiple accounts so the user can switch between them
// without re-typing.
//
// Credentials are stored as a JSON array under the `saved_credentials`
// settings key.  Each entry may optionally hold an encrypted password.
// Passwords are encrypted with AES-256-GCM before being written to the
// SQLite settings store.  The encryption key is randomly generated on first
// use and itself persisted in settings — this provides protection against
// trivial plaintext extraction from the database file.
//
// Migration: the previous single-entry format (`{ username, … }`) is
// auto-migrated to the array format on first read.
//
// Security note: the encryption key is stored alongside the ciphertext, so
// this is NOT a hardware-backed secure enclave.  It raises the bar for
// casual attackers but does not replace full-disk encryption.

use cfms_core::constants::{KEY_LEN, NONCE_LEN, TAG_LEN};
use cfms_crypto::aead;

use base64ct::{Base64, Encoding};
use rand::Rng;

const CREDENTIALS_KEY: &str = "saved_credentials";
const CREDENTIAL_ENCRYPTION_KEY: &str = "credential_encryption_key";

/// Maximum number of saved credential entries to prevent unbounded growth.
const MAX_CREDENTIAL_ENTRIES: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedCredentialEntry {
    username: String,
    /// If present, the ciphertext of the password (Base64-encoded).
    /// Format: nonce (12 bytes) || tag (16 bytes) || ciphertext
    encrypted_password: Option<String>,
    /// Unix timestamp (seconds) of when this entry was last saved/updated.
    last_used_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialsDto {
    pub username: String,
    pub password: String,
}

/// Lightweight summary returned by list_credentials (no passwords).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialSummary {
    pub username: String,
    pub has_password: bool,
    pub last_used_at: u64,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Persist (or update) login credentials for a given username.
///
/// When `remember_password` is true, the password is encrypted with a
/// randomly-generated device-local key before storage.  When false, only
/// the username is saved.  If an entry for this username already exists it
/// is updated in-place; otherwise a new entry is appended.  Entries are
/// capped at `MAX_CREDENTIAL_ENTRIES` — the oldest entry is evicted when
/// the limit is reached.
#[tauri::command]
pub async fn save_credentials(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    password: String,
    remember_password: bool,
) -> Result<(), String> {
    let encrypted_password = if remember_password {
        let key = get_or_create_credential_key(&state).map_err(|e| e.to_string())?;
        let nonce = aead::generate_nonce();
        let (ciphertext, tag) =
            aead::seal(&key, &nonce, password.as_bytes()).map_err(|e| format!("Encryption failed: {e}"))?;

        let mut packed = Vec::with_capacity(NONCE_LEN + TAG_LEN + ciphertext.len());
        packed.extend_from_slice(&nonce);
        packed.extend_from_slice(&tag);
        packed.extend_from_slice(&ciphertext);

        Some(Base64::encode_string(&packed))
    } else {
        None
    };

    let now = current_timestamp();
    let mut entries = load_all_entries(&state)?;

    // Upsert: replace existing entry for this username or append a new one.
    if let Some(existing) = entries.iter_mut().find(|e| e.username == username) {
        existing.encrypted_password = encrypted_password;
        existing.last_used_at = now;
    } else {
        // Enforce the cap before inserting.
        while entries.len() >= MAX_CREDENTIAL_ENTRIES {
            // Evict the least-recently-used entry.
            if let Some(oldest_idx) = entries
                .iter()
                .enumerate()
                .min_by_key(|(_, e)| e.last_used_at)
                .map(|(i, _)| i)
            {
                entries.remove(oldest_idx);
            } else {
                break;
            }
        }
        entries.push(SavedCredentialEntry {
            username,
            encrypted_password,
            last_used_at: now,
        });
    }

    persist_entries(&state, &entries)
}

/// Load saved credentials.
///
/// When `username` is provided, returns that specific entry.  When omitted,
/// returns the most recently used entry.  Returns `None` if no credentials
/// have been saved.  The `password` field is only populated when it was
/// originally saved with `remember_password: true`.
#[tauri::command]
pub async fn load_credentials(
    state: tauri::State<'_, AppHandleState>,
    username: Option<String>,
) -> Result<Option<CredentialsDto>, String> {
    let entries = load_all_entries(&state)?;
    if entries.is_empty() {
        return Ok(None);
    }

    let entry = if let Some(ref name) = username {
        entries.iter().find(|e| e.username == *name).cloned()
    } else {
        // Return the most recently used entry.
        entries.iter().max_by_key(|e| e.last_used_at).cloned()
    };

    let Some(entry) = entry else {
        return Ok(None);
    };

    let password = decrypt_password(&state, &entry)?;

    Ok(Some(CredentialsDto {
        username: entry.username,
        password: password.unwrap_or_default(),
    }))
}

/// List all saved credential summaries (usernames only, no passwords).
#[tauri::command]
pub async fn list_credentials(
    state: tauri::State<'_, AppHandleState>,
) -> Result<Vec<CredentialSummary>, String> {
    let entries = load_all_entries(&state)?;
    Ok(entries
        .into_iter()
        .map(|e| CredentialSummary {
            username: e.username,
            has_password: e.encrypted_password.is_some(),
            last_used_at: e.last_used_at,
        })
        .collect())
}

/// Delete a single saved credential entry by username.
#[tauri::command]
pub async fn delete_credential(
    state: tauri::State<'_, AppHandleState>,
    username: String,
) -> Result<(), String> {
    let mut entries = load_all_entries(&state)?;
    entries.retain(|e| e.username != username);
    persist_entries(&state, &entries)
}

/// Remove all saved credentials.
#[tauri::command]
pub async fn clear_credentials(
    state: tauri::State<'_, AppHandleState>,
) -> Result<(), String> {
    clear_credentials_inner(&state)
}

/// Check whether any credentials (at minimum a username) are saved.
#[tauri::command]
pub async fn has_saved_credentials(
    state: tauri::State<'_, AppHandleState>,
) -> Result<bool, String> {
    let entries = load_all_entries(&state)?;
    Ok(!entries.is_empty())
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn clear_credentials_inner(state: &AppHandleState) -> Result<(), String> {
    state
        .settings
        .set(CREDENTIALS_KEY, "")
        .map_err(|e| format!("Failed to clear credentials: {e}"))
}

/// Load all credential entries from storage, migrating from the legacy
/// single-entry format if necessary.
fn load_all_entries(
    state: &AppHandleState,
) -> Result<Vec<SavedCredentialEntry>, String> {
    let Some(raw) = state
        .settings
        .get(CREDENTIALS_KEY)
        .map_err(|e| format!("Failed to read credentials: {e}"))?
    else {
        return Ok(Vec::new());
    };

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    // Try the new array format first.
    if let Ok(entries) = serde_json::from_str::<Vec<SavedCredentialEntry>>(trimmed) {
        return Ok(entries);
    }

    // Fall back to legacy single-entry format and migrate.
    if let Ok(legacy) = serde_json::from_str::<LegacySavedCredentials>(trimmed) {
        let migrated = vec![SavedCredentialEntry {
            username: legacy.username,
            encrypted_password: legacy.encrypted_password,
            last_used_at: current_timestamp(),
        }];
        // Persist the migration so future reads use the array format.
        persist_entries(state, &migrated)?;
        return Ok(migrated);
    }

    Err("Invalid saved credentials format".to_string())
}

fn persist_entries(
    state: &AppHandleState,
    entries: &[SavedCredentialEntry],
) -> Result<(), String> {
    let encoded = serde_json::to_string(entries)
        .map_err(|e| format!("Failed to encode credentials: {e}"))?;
    state
        .settings
        .set(CREDENTIALS_KEY, &encoded)
        .map_err(|e| format!("Failed to save credentials: {e}"))
}

/// Decrypt the password for a single entry.  Returns `Ok(None)` if the
/// entry has no encrypted password or if decryption fails gracefully.
fn decrypt_password(
    state: &AppHandleState,
    entry: &SavedCredentialEntry,
) -> Result<Option<String>, String> {
    let Some(ref encrypted) = entry.encrypted_password else {
        return Ok(None);
    };

    let key = get_credential_key(state).map_err(|e| e.to_string())?;
    let Some(key) = key else {
        clear_credentials_inner(state)?;
        return Ok(None);
    };

    let packed = Base64::decode_vec(encrypted)
        .map_err(|_| "Failed to decode encrypted password".to_string())?;

    if packed.len() < NONCE_LEN + TAG_LEN {
        clear_credentials_inner(state)?;
        return Ok(None);
    }

    let nonce: [u8; NONCE_LEN] = packed[..NONCE_LEN]
        .try_into()
        .map_err(|_| "Invalid nonce".to_string())?;
    let tag: [u8; TAG_LEN] = packed[NONCE_LEN..NONCE_LEN + TAG_LEN]
        .try_into()
        .map_err(|_| "Invalid tag".to_string())?;
    let ciphertext = &packed[NONCE_LEN + TAG_LEN..];

    let plaintext = aead::open(&key, &nonce, ciphertext, &tag)
        .map_err(|_| {
            let _ = clear_credentials_inner(state);
            "Failed to decrypt password".to_string()
        })?;

    Ok(Some(String::from_utf8(plaintext).unwrap_or_default()))
}

/// Legacy single-entry format for auto-migration.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct LegacySavedCredentials {
    username: String,
    encrypted_password: Option<String>,
}

fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Retrieve the existing credential encryption key, if one exists.
fn get_credential_key(
    state: &AppHandleState,
) -> Result<Option<[u8; KEY_LEN]>, String> {
    let Some(raw) = state
        .settings
        .get(CREDENTIAL_ENCRYPTION_KEY)
        .map_err(|e| format!("Failed to read encryption key: {e}"))?
    else {
        return Ok(None);
    };

    let bytes = Base64::decode_vec(&raw)
        .map_err(|_| "Invalid credential encryption key encoding".to_string())?;

    let key: [u8; KEY_LEN] = bytes
        .try_into()
        .map_err(|_| "Invalid credential encryption key length".to_string())?;

    Ok(Some(key))
}

/// Get the credential encryption key, creating a new random one if necessary.
fn get_or_create_credential_key(
    state: &AppHandleState,
) -> Result<[u8; KEY_LEN], String> {
    if let Some(key) = get_credential_key(state)? {
        return Ok(key);
    }

    let mut key = [0u8; KEY_LEN];
    rand::rng().fill_bytes(&mut key);

    let encoded = Base64::encode_string(&key);
    state
        .settings
        .set(CREDENTIAL_ENCRYPTION_KEY, &encoded)
        .map_err(|e| format!("Failed to persist credential encryption key: {e}"))?;

    Ok(key)
}
