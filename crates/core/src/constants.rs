//! Protocol-level constants shared across all crates.
//!
//! These values MUST match the CFMS server protocol specification.
//! Changing any of them without a protocol version bump will break
//! compatibility with the server.

// ---------------------------------------------------------------------------
// Protocol version
// ---------------------------------------------------------------------------
/// Exact wire-protocol version required by this client.
pub const PROTOCOL_VERSION: u32 = 27;

/// Oldest wire-protocol version supported by this client.
///
/// This is the compiled-in floor.  The protocol compatibility picker on the
/// about page may relax it down to
/// [`LEGACY_MIN_SUPPORTED_PROTOCOL_VERSION`] for testing.
pub const MIN_SUPPORTED_PROTOCOL_VERSION: u32 = PROTOCOL_VERSION;

/// Newest wire-protocol version supported by this client.
pub const MAX_SUPPORTED_PROTOCOL_VERSION: u32 = PROTOCOL_VERSION;

/// Oldest wire-protocol version this client can still interoperate with when a
/// compatibility override relaxes [`MIN_SUPPORTED_PROTOCOL_VERSION`].
///
/// Every server response is parsed through the same code paths regardless of
/// the advertised protocol version, so lowering the accepted floor down to this
/// value only relaxes the handshake gate.  It exists for interoperability
/// testing against older servers and never changes the build default.
pub const LEGACY_MIN_SUPPORTED_PROTOCOL_VERSION: u32 = 20;

/// Wire-protocol versions offered by the protocol compatibility picker,
/// newest first.
pub const SELECTABLE_PROTOCOL_VERSIONS: &[u32] = &[
    PROTOCOL_VERSION,
    26,
    25,
    24,
    22,
    LEGACY_MIN_SUPPORTED_PROTOCOL_VERSION,
];

/// Return whether a server wire-protocol version is compatible with this client.
pub const fn is_supported_protocol_version(version: u32) -> bool {
    is_supported_protocol_version_within(version, MIN_SUPPORTED_PROTOCOL_VERSION)
}

/// Return whether `version` is compatible with this client when the oldest
/// accepted wire-protocol version is relaxed to `min_accepted`.
///
/// Versions newer than [`MAX_SUPPORTED_PROTOCOL_VERSION`] are never accepted,
/// so an override can only widen compatibility towards older servers.
pub const fn is_supported_protocol_version_within(version: u32, min_accepted: u32) -> bool {
    version >= min_accepted && version <= MAX_SUPPORTED_PROTOCOL_VERSION
}

/// Normalize a stored compatibility override into an effective oldest-accepted
/// wire-protocol version.
///
/// Returns `None` when `raw` is absent or is neither one of
/// [`SELECTABLE_PROTOCOL_VERSIONS`] nor actually below the build default, so a
/// corrupted or tampered setting can never widen compatibility unintentionally.
pub fn normalize_min_protocol_version_override(raw: Option<u32>) -> Option<u32> {
    let raw = raw?;
    if raw < MIN_SUPPORTED_PROTOCOL_VERSION && SELECTABLE_PROTOCOL_VERSIONS.contains(&raw) {
        Some(raw)
    } else {
        None
    }
}

/// Protocol 25 conclusion codes returned when a file task cannot be claimed.
pub mod file_task_claim_code {
    pub const INVALID: u32 = 46_000;
    pub const IN_PROGRESS: u32 = 46_001;
    pub const COMPLETED: u32 = 46_002;
    pub const CANCELLED: u32 = 46_003;
    pub const EXPIRED: u32 = 46_004;
    pub const CONFLICT: u32 = 46_005;
}

// ---------------------------------------------------------------------------
// Cryptographic parameters
// ---------------------------------------------------------------------------

/// PBKDF2-HMAC-SHA256 iteration count.
///
/// NIST SP 800-132 recommends *at minimum* 1 000 000 iterations for PBKDF2
/// when used with SHA-256.  This value MUST NOT be lowered.
pub const KDF_ITERATIONS: u32 = 1_000_000;

/// Salt length for PBKDF2 (128 bits).
pub const SALT_LEN: usize = 16;

/// Symmetric key length for AES-256 (256 bits / 32 bytes).
pub const KEY_LEN: usize = 32;

/// GCM nonce length (96 bits / 12 bytes) — the recommended size per NIST.
pub const NONCE_LEN: usize = 12;

/// GCM authentication tag length (128 bits / 16 bytes).
pub const TAG_LEN: usize = 16;

// ---------------------------------------------------------------------------
// Encrypted config file format
// ---------------------------------------------------------------------------

/// Magic bytes that identify a config file encrypted by this library.
///
/// Starts with non-ASCII bytes that are extremely unlikely to appear at the
/// beginning of a plain JSON (UTF-8) file.
pub const ENCRYPTED_MAGIC: [u8; 4] = [0xcf, 0xe5, 0xce, 0x01];

// ---------------------------------------------------------------------------
// Frame protocol
// ---------------------------------------------------------------------------

/// Frame header size on the wire: 4 bytes `frame_id` (BE) + 1 byte `frame_type`.
pub const FRAME_HEADER_LEN: usize = 5;

/// Prefix length used when constructing chunk nonces (8 bytes + 4 bytes index = 12).
pub const CHUNK_NONCE_PREFIX_LEN: usize = 8;

// ---------------------------------------------------------------------------
// Transfer limits
// ---------------------------------------------------------------------------

pub const MIN_DOWNLOAD_CHUNK_SIZE: u32 = 16 * 1024;
pub const DEFAULT_DOWNLOAD_CHUNK_SIZE: u32 = 64 * 1024;
pub const MAX_DOWNLOAD_CHUNK_SIZE: u32 = 2 * 1024 * 1024;
pub const DOWNLOAD_CHUNK_SIZE_OPTIONS: [u32; 8] = [
    16 * 1024,
    32 * 1024,
    64 * 1024,
    128 * 1024,
    256 * 1024,
    512 * 1024,
    1024 * 1024,
    2 * 1024 * 1024,
];

#[cfg(test)]
mod tests {
    use super::{
        LEGACY_MIN_SUPPORTED_PROTOCOL_VERSION, MAX_SUPPORTED_PROTOCOL_VERSION,
        MIN_SUPPORTED_PROTOCOL_VERSION, PROTOCOL_VERSION, SELECTABLE_PROTOCOL_VERSIONS,
        is_supported_protocol_version, is_supported_protocol_version_within,
        normalize_min_protocol_version_override,
    };

    #[test]
    fn accepts_every_supported_protocol_version() {
        assert!(is_supported_protocol_version(
            MIN_SUPPORTED_PROTOCOL_VERSION
        ));
        assert!(is_supported_protocol_version(
            MAX_SUPPORTED_PROTOCOL_VERSION
        ));
    }

    #[test]
    fn rejects_protocol_versions_outside_the_supported_range() {
        assert!(!is_supported_protocol_version(
            MIN_SUPPORTED_PROTOCOL_VERSION - 1
        ));
        assert!(!is_supported_protocol_version(
            MAX_SUPPORTED_PROTOCOL_VERSION + 1
        ));
    }

    #[test]
    fn supports_only_protocol_twenty_seven() {
        assert!(is_supported_protocol_version(27));
        assert!(!is_supported_protocol_version(26));
        assert!(!is_supported_protocol_version(28));
    }

    #[test]
    fn relaxing_the_floor_accepts_older_protocol_versions() {
        for version in LEGACY_MIN_SUPPORTED_PROTOCOL_VERSION..=MAX_SUPPORTED_PROTOCOL_VERSION {
            assert!(is_supported_protocol_version_within(
                version,
                LEGACY_MIN_SUPPORTED_PROTOCOL_VERSION
            ));
        }

        assert!(!is_supported_protocol_version_within(
            LEGACY_MIN_SUPPORTED_PROTOCOL_VERSION - 1,
            LEGACY_MIN_SUPPORTED_PROTOCOL_VERSION
        ));
    }

    #[test]
    fn relaxing_the_floor_never_accepts_newer_protocol_versions() {
        assert!(!is_supported_protocol_version_within(
            MAX_SUPPORTED_PROTOCOL_VERSION + 1,
            LEGACY_MIN_SUPPORTED_PROTOCOL_VERSION
        ));
    }

    #[test]
    fn selectable_versions_are_unique_and_start_at_the_build_target() {
        assert_eq!(SELECTABLE_PROTOCOL_VERSIONS[0], PROTOCOL_VERSION);

        let mut sorted = SELECTABLE_PROTOCOL_VERSIONS.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), SELECTABLE_PROTOCOL_VERSIONS.len());

        assert!(SELECTABLE_PROTOCOL_VERSIONS.contains(&LEGACY_MIN_SUPPORTED_PROTOCOL_VERSION));
    }

    #[test]
    fn override_accepts_only_selectable_versions_below_the_build_target() {
        assert_eq!(
            normalize_min_protocol_version_override(Some(25)),
            Some(25)
        );
        assert_eq!(
            normalize_min_protocol_version_override(Some(PROTOCOL_VERSION)),
            None
        );
        // Not selectable, so it must not widen compatibility.
        assert_eq!(normalize_min_protocol_version_override(Some(21)), None);
        assert_eq!(normalize_min_protocol_version_override(Some(19)), None);
        assert_eq!(normalize_min_protocol_version_override(None), None);
    }
}
