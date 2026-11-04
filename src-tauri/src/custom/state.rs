//! Fork-owned managed state.
//!
//! `AppHandleState` carries one `custom: CustomState` field instead of one field
//! per fork feature, so adding fork state never edits the upstream struct (or
//! its initializer) again.

use std::path::Path;
use std::sync::Arc;

use cfms_service::db::settings::SettingsStore;
use cfms_service::injection::extensions_system::ExtensionStore;

use super::file_auto_check::FileAutoCheckRuntime;

/// State owned by the fork's feature modules.
pub struct CustomState {
    /// Device-global signed extension packages and catalog metadata.
    pub extensions: ExtensionStore,

    /// Automatic file-update check scheduler shared with its service.
    pub file_auto_check: Arc<FileAutoCheckRuntime>,
}

impl CustomState {
    /// Creates the fork state that lives for the lifetime of the process.
    pub fn new(settings: SettingsStore, app_data_dir: &Path) -> Self {
        Self {
            extensions: ExtensionStore::new(settings, app_data_dir, env!("CARGO_PKG_VERSION")),
            file_auto_check: Arc::new(FileAutoCheckRuntime::new()),
        }
    }
}
