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
            $crate::commands::get_close_behavior,
            $crate::commands::set_close_behavior,
            $crate::commands::resolve_close_request,
            $crate::commands::sync_desktop_shell_labels,
            $crate::commands::local_ip_addresses,
            $crate::commands::browsing::check_downloads_exist,
            $crate::commands::browsing::compute_local_sha256,
            $crate::commands::browsing::delete_download_file,
            $crate::commands::browsing::delete_download_directory_if_empty,
            $crate::commands::browsing::move_download_file,
            $crate::commands::browsing::create_download_placeholder,
            $crate::commands::browsing::list_download_files,
            $crate::commands::browsing::download_git_present,
            $crate::commands::browsing::download_git_init,
            $crate::commands::browsing::download_git_commit,
            $crate::commands::get_file_auto_check_state,
            $crate::commands::rebase_file_auto_check_schedule,
            $crate::commands::get_extension_overview,
            $crate::commands::import_extension_package,
            $crate::commands::refresh_extension_catalog,
            $crate::commands::install_extension_from_catalog,
            $crate::commands::rollback_extension,
            $crate::commands::uninstall_extension,
            $crate::commands::set_extension_enabled,
            $crate::commands::read_extension_page,
            $crate::commands::read_extension_workflow,
            $crate::commands::execute_extension_module,
            $crate::commands::execute_extension_host_call,
            $crate::commands::record_extension_schedule_run,
            $crate::commands::settings::get_protocol_version_settings,
            $crate::commands::settings::set_protocol_version_override,
            $crate::commands::read_server_document,
            $crate::commands::scan_local_chatbox,
            $crate::commands::open_local_path,
            $crate::commands::open_downloaded_document,
            $crate::commands::documents::upload_chat_record,
            $crate::commands::save_credentials,
            $crate::commands::load_credentials,
            $crate::commands::list_credentials,
            $crate::commands::delete_credential,
            $crate::commands::clear_credentials,
            $crate::commands::has_saved_credentials,
            $crate::commands::send_raw_request,
            $crate::commands::fetch_server_page,
            $crate::commands::open_dev_tools_window,
        ]
    };
}

pub(crate) use invoke_handler;
