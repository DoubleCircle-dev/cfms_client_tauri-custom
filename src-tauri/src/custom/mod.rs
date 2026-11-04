//! Fork-owned backend surface for the Custom client.
//!
//! Upstream files keep one narrow seam each; everything the fork adds at
//! start-up, to Tauri managed state, or to the IPC command list lives in this
//! directory. Command adapters live in `commands/injection/` instead, because
//! they are included into the upstream `commands` module and share its helpers.
//!
//! The remaining upstream seams are:
//!
//! * `src-tauri/src/lib.rs` — `mod custom`, the `custom: CustomState` field,
//!   one call each for service registration, window configuration, post-build
//!   setup and diagnostics, `custom::invoke_handler![..]`, and the
//!   `custom::on_window_event` delegation.
//! * `src-tauri/src/commands.rs` — one `include!` of
//!   `commands/injection/mod.rs`.
//!
//! Adding a fork feature should therefore touch only files in this directory
//! and in `commands/injection/`: a new command is one line in [`invoke_handler!`],
//! new managed state is one field on [`CustomState`], and new start-up work is
//! one function in `wiring`.

pub(crate) mod desktop_shell;
pub(crate) mod diagnostics;
pub(crate) mod file_auto_check;
pub(crate) mod mobile_keepalive;
pub(crate) mod state;
pub(crate) mod wiring;

pub(crate) use diagnostics::log_local_addresses;
pub(crate) use state::CustomState;
pub(crate) use wiring::{
    after_window_built, on_window_event, prepare_window_config, register_services,
};

/// Builds the Tauri invoke handler from the upstream command list plus the
/// fork's command adapters.
///
/// The upstream call site stays a single list; fork commands are appended here:
///
/// ```ignore
/// .invoke_handler(custom::invoke_handler![
///     window_backdrop::set_window_backdrop,
///     commands::greet,
/// ])
/// ```
///
/// Adding a fork command is one line below instead of an edit inside the
/// upstream `generate_handler!` list. Every path resolves in the upstream
/// `commands` module, whose adapters are included by `commands.rs`.
macro_rules! invoke_handler {
    ($($upstream:path),* $(,)?) => {
        tauri::generate_handler![
            $($upstream,)*
            // --- fork command adapters (see commands/injection/mod.rs) ---
            commands::get_close_behavior,
            commands::set_close_behavior,
            commands::resolve_close_request,
            commands::sync_desktop_shell_labels,
            commands::local_ip_addresses,
            commands::check_downloads_exist,
            commands::compute_local_sha256,
            commands::delete_download_file,
            commands::delete_download_directory_if_empty,
            commands::move_download_file,
            commands::create_download_placeholder,
            commands::list_download_files,
            commands::download_git_present,
            commands::download_git_init,
            commands::download_git_commit,
            commands::get_file_auto_check_state,
            commands::rebase_file_auto_check_schedule,
            commands::get_extension_overview,
            commands::import_extension_package,
            commands::refresh_extension_catalog,
            commands::install_extension_from_catalog,
            commands::rollback_extension,
            commands::uninstall_extension,
            commands::set_extension_enabled,
            commands::read_extension_page,
            commands::read_extension_workflow,
            commands::execute_extension_module,
            commands::execute_extension_host_call,
            commands::get_protocol_version_settings,
            commands::set_protocol_version_override,
            commands::read_server_document,
            commands::scan_local_chatbox,
            commands::open_local_path,
            commands::open_downloaded_document,
            commands::upload_chat_record,
            commands::save_credentials,
            commands::load_credentials,
            commands::list_credentials,
            commands::delete_credential,
            commands::clear_credentials,
            commands::has_saved_credentials,
            commands::send_raw_request,
            commands::fetch_server_page,
            commands::open_dev_tools_window,
        ]
    };
}

pub(crate) use invoke_handler;
