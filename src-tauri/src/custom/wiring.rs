//! Start-up and window wiring for the fork features.
//!
//! Every function here replaces a block that used to be inlined in the upstream
//! `lib.rs` bootstrap, so the upstream file keeps one call per concern instead of
//! the fork's implementation.

use crate::custom::{desktop_shell, file_auto_check};

/// Applies fork-specific configuration to the main window before it is built.
pub fn prepare_window_config(config: &mut tauri::utils::config::WindowConfig) {
    // Dev builds: make the window obviously non-production by suffixing the
    // title with "-dev".
    #[cfg(debug_assertions)]
    {
        config.title.push_str("-dev");
    }
}

/// Registers the fork's background services, before the manager is activated.
pub fn register_services(
    manager: &mut cfms_service::service::manager::ServiceManager,
    app: &tauri::AppHandle,
) {
    // Automatic file-update checks. Owned by the backend (rather than by the
    // Webview) so the interval keeps running while the app is backgrounded on
    // mobile; see `custom::file_auto_check`.
    let check_app = app.clone();
    manager.register("file_auto_check", move |rx| async move {
        file_auto_check::run(check_app, rx).await;
    });
}

/// Creates the fork's extra windows and desktop integration after the main
/// window has been built.
pub fn after_window_built(app: &tauri::AppHandle) {
    // Desktop shell: keep the app reachable from the tray. Labels are replaced
    // by the Webview's localized strings once it boots.
    #[cfg(desktop)]
    if let Err(error) = desktop_shell::init_tray(app, desktop_shell::TrayLabels::default()) {
        tracing::warn!("Unable to create the system tray icon: {error}");
    }

    // Dev mode: auto-open the vulnerability testing tool in a separate window.
    #[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
    {
        let _ = tauri::WebviewWindowBuilder::new(
            app,
            "dev-tools",
            tauri::WebviewUrl::App("/dev/server-vuln-test".into()),
        )
        .title("CFMS 漏洞测试工具")
        .inner_size(960.0, 720.0)
        .min_inner_size(640.0, 480.0)
        .resizable(true)
        .center()
        .build();
    }
}

/// Routes window events to the fork's desktop shell (close-button policy).
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    #[cfg(desktop)]
    desktop_shell::handle_window_event(window, event);
    #[cfg(not(desktop))]
    let _ = (window, event);
}
