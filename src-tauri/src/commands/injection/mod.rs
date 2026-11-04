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

include!("credentials.rs");
include!("custom_extensions.rs");
include!("desktop_shell.rs");
include!("dev_raw.rs");
include!("diagnostics.rs");
include!("download_root.rs");
include!("file_auto_check.rs");
include!("server_files.rs");
