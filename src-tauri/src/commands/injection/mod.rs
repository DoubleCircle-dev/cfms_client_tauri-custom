// Fork-owned IPC command adapters.
//
// `commands.rs` includes this file once, after the upstream command modules.
// The adapters are spliced into the upstream `commands` module, so they keep
// sharing its helpers (`server_action_json`, `update_http_client`,
// `load_current_user_preferences`, …) and their `#[tauri::command]` wrappers
// live next to the ones upstream declares.
//
// Register the resulting commands in `custom::invoke_handler!` (see
// `src-tauri/src/custom/mod.rs`) rather than in the upstream `lib.rs` list.

use crate::AppHandleState;
use crate::commands::browsing::{fetch_all_listing_pages, get_document};
use crate::commands::shared_helpers::format_transport_error;
use crate::commands::transfer_helpers::{create_transfer_connection, download_root, unix_now};
use crate::commands::updates::{update_http_client, updater_proxy_url};
use cfms_service::transfers::download_queue;
use rand::RngExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, Runtime};

include!("credentials.rs");
include!("custom_extensions.rs");
include!("desktop_shell.rs");
include!("dev_raw.rs");
include!("diagnostics.rs");
include!("download_root.rs");
include!("file_auto_check.rs");
include!("server_files.rs");
