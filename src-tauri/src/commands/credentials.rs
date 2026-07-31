// Credential persistence
// ---------------------------------------------------------------------------
//
// Provides at-rest storage for login credentials (username + optionally
// password) so the user can skip typing them on subsequent launches.
//
// Passwords are encrypted with AES-256-GCM before being written to the
// SQLite settings store.  The encryption key is randomly generated on first
// use and itself persisted in settings — this provides protection against
// trivial plaintext extraction from the database file.
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedCredentials {
    username: String,
    /// If present, the ciphertext of the password (Base64-encoded).
    /// Format: nonce (12 bytes) || tag (16 bytes) || ciphertext
    encrypted_password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialsDto {
    pub username: String,
    pub password: String,
}

/// Persist login credentials.
///
/// When `remember_password` is true, the password is encrypted with a
/// randomly-generated device-local key before storage.  When false, only
/// the username is saved.
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

        // Pack as: nonce (12) || tag (16) || ciphertext
        let mut packed = Vec::with_capacity(NONCE_LEN + TAG_LEN + ciphertext.len());
        packed.extend_from_slice(&nonce);
        packed.extend_from_slice(&tag);
        packed.extend_from_slice(&ciphertext);

        Some(Base64::encode_string(&packed))
    } else {
        None
    };

    let credentials = SavedCredentials {
        username,
        encrypted_password,
    };

    let encoded = serde_json::to_string(&credentials)
        .map_err(|e| format!("Failed to encode credentials: {e}"))?;

    state
        .settings
        .set(CREDENTIALS_KEY, &encoded)
        .map_err(|e| format!("Failed to save credentials: {e}"))?;

    Ok(())
}

/// Load saved credentials.
///
/// Returns `None` if no credentials have been saved.  The password is only
/// returned if it was saved with `remember_password = true`.
#[tauri::command]
pub async fn load_credentials(
    state: tauri::State<'_, AppHandleState>,
) -> Result<Option<CredentialsDto>, String> {
    let Some(raw) = state
        .settings
        .get(CREDENTIALS_KEY)
        .map_err(|e| format!("Failed to read credentials: {e}"))?
    else {
        return Ok(None);
    };

    let credentials: SavedCredentials =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid saved credentials: {e}"))?;

    let password = match credentials.encrypted_password {
        Some(ref encrypted) => {
            let key = get_credential_key(&state).map_err(|e| e.to_string())?;
            let Some(key) = key else {
                // Key was lost or never created — clear stale data.
                clear_credentials_inner(&state)?;
                return Ok(None);
            };
            let packed = Base64::decode_vec(encrypted)
                .map_err(|_| "Failed to decode encrypted password".to_string())?;

            if packed.len() < NONCE_LEN + TAG_LEN {
                clear_credentials_inner(&state)?;
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
                    // Decryption failed — key may have changed, clear stale data.
                    let _ = clear_credentials_inner(&state);
                    "Failed to decrypt password".to_string()
                })?;

            Some(String::from_utf8(plaintext).unwrap_or_default())
        }
        None => None,
    };

    Ok(Some(CredentialsDto {
        username: credentials.username,
        password: password.unwrap_or_default(),
    }))
}

/// Clear saved credentials.
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
    let exists = state
        .settings
        .get(CREDENTIALS_KEY)
        .map_err(|e| format!("Failed to check credentials: {e}"))?
        .is_some();
    Ok(exists)
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

    // Generate a fresh random 256-bit key.
    let mut key = [0u8; KEY_LEN];
    rand::rng().fill_bytes(&mut key);

    let encoded = Base64::encode_string(&key);
    state
        .settings
        .set(CREDENTIAL_ENCRYPTION_KEY, &encoded)
        .map_err(|e| format!("Failed to persist credential encryption key: {e}"))?;

    Ok(key)
}
