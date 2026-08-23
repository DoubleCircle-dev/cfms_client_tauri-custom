//! Sensitive in-memory values owned by the client service layer.
//!
//! These aliases make the intended lifecycle visible at type boundaries and
//! ensure application-controlled buffers are overwritten when they are
//! dropped. They cannot erase copies retained by the WebView, the operating
//! system, or third-party networking libraries.

use serde::Serialize;
use zeroize::{Zeroize, Zeroizing};

use cfms_core::constants::KEY_LEN;

pub type SecretKey = Zeroizing<[u8; KEY_LEN]>;

/// Zeroizing UTF-8 secret with redacted debug output.
pub struct SecretString(Zeroizing<String>);

impl SecretString {
    pub fn new(value: String) -> Self {
        Self(Zeroizing::new(value))
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl Clone for SecretString {
    fn clone(&self) -> Self {
        Self::new(self.0.to_string())
    }
}

impl std::ops::Deref for SecretString {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        self.as_str()
    }
}

impl std::fmt::Debug for SecretString {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SecretString([REDACTED])")
    }
}

/// Zeroizing byte storage with redacted debug output.
pub struct SecretBytes(Zeroizing<Vec<u8>>);

impl SecretBytes {
    pub fn new(value: Vec<u8>) -> Self {
        Self(Zeroizing::new(value))
    }

    pub fn into_zeroizing(self) -> Zeroizing<Vec<u8>> {
        self.0
    }
}

impl std::ops::Deref for SecretBytes {
    type Target = [u8];

    fn deref(&self) -> &Self::Target {
        self.0.as_slice()
    }
}

impl std::fmt::Debug for SecretBytes {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SecretBytes([REDACTED])")
    }
}

/// JSON value whose owned strings and byte-like number arrays are cleared on
/// drop. This is used for outbound request data that may contain credentials.
pub struct SensitiveJson(serde_json::Value);

impl SensitiveJson {
    pub fn new(value: serde_json::Value) -> Self {
        Self(value)
    }

    pub fn as_value(&self) -> &serde_json::Value {
        &self.0
    }
}

impl Drop for SensitiveJson {
    fn drop(&mut self) {
        zeroize_json_value(&mut self.0);
    }
}

#[derive(Serialize)]
struct ActionRequest<'a> {
    action: &'a str,
    data: &'a serde_json::Value,
    username: &'a str,
    token: &'a str,
    timestamp: i64,
    nonce: &'a str,
}

/// Serialize an authenticated action without first duplicating the token into
/// a `serde_json::Value`. The returned byte buffer is zeroized on drop.
pub fn encode_action_request(
    action: &str,
    data: serde_json::Value,
    username: &str,
    token: &str,
    timestamp: i64,
    nonce: &str,
) -> serde_json::Result<SecretBytes> {
    let data = SensitiveJson::new(data);
    let request = ActionRequest {
        action,
        data: data.as_value(),
        username,
        token,
        timestamp,
        nonce,
    };
    serde_json::to_vec(&request).map(SecretBytes::new)
}

fn zeroize_json_value(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::String(value) => value.zeroize(),
        serde_json::Value::Array(values) => {
            for value in values.iter_mut() {
                zeroize_json_value(value);
            }
            values.clear();
        }
        serde_json::Value::Object(values) => {
            for value in values.values_mut() {
                zeroize_json_value(value);
            }
            values.clear();
        }
        serde_json::Value::Null | serde_json::Value::Bool(_) | serde_json::Value::Number(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_encoding_does_not_expose_secrets_through_debug_output() {
        let encoded = encode_action_request(
            "login-adjacent-action",
            serde_json::json!({"password": "test-only-password"}),
            "alice",
            "test-only-token",
            1,
            "nonce",
        )
        .unwrap();

        assert!(
            std::str::from_utf8(&encoded)
                .unwrap()
                .contains("test-only-token")
        );
        assert_eq!(format!("{encoded:?}"), "SecretBytes([REDACTED])");
    }

    #[test]
    fn secret_string_debug_output_is_redacted() {
        let secret = SecretString::new("test-only-token".into());
        assert_eq!(format!("{secret:?}"), "SecretString([REDACTED])");
    }
}
