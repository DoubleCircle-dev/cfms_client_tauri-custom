//! Types that only the Custom build's extension system needs.
//!
//! Upstream removed its unreleased extension framework in v0.58.0, so these
//! live outside `types.rs` to keep that file free of fork lines.

use serde::{Deserialize, Serialize};

/// Account-scoped state for one device-global extension installation.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct ExtensionPreference {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub install_epoch: String,
    #[serde(default)]
    pub granted_capabilities: Vec<String>,
    #[serde(default)]
    pub settings: serde_json::Value,
}
