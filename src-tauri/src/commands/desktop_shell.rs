// Desktop shell IPC — close policy, close answers, and tray label sync.
//
// Included into `commands` by `commands.rs`, so every function here is reached
// as `commands::<name>` from the invoke handler in `lib.rs`.

/// Read the stored close-button policy.
#[tauri::command]
pub fn get_close_behavior<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> crate::desktop_shell::CloseBehavior {
    crate::desktop_shell::read_behavior(&app)
}

/// Persist the close-button policy chosen in the settings page.
#[tauri::command]
pub fn set_close_behavior<R: Runtime>(
    app: tauri::AppHandle<R>,
    behavior: crate::desktop_shell::CloseBehavior,
) -> Result<(), String> {
    crate::desktop_shell::write_behavior(&app, behavior)
}

/// Apply the answer to a pending "quit or minimize?" prompt.
///
/// `remember` persists the answer as the new default, which is what the
/// dialog's "remember my choice" checkbox asks for.
#[tauri::command]
pub fn resolve_close_request<R: Runtime>(
    app: tauri::AppHandle<R>,
    action: crate::desktop_shell::CloseBehavior,
    remember: bool,
) -> Result<(), String> {
    use crate::desktop_shell::{
        CloseBehavior, clear_pending_ask, minimize_to_tray, quit, write_behavior,
    };

    clear_pending_ask();
    if remember {
        write_behavior(&app, action)?;
    }
    match action {
        // Answering "ask" is not a close; the window stays where it is.
        CloseBehavior::Ask => Ok(()),
        CloseBehavior::MinimizeToTray => {
            minimize_to_tray(&app);
            Ok(())
        }
        CloseBehavior::Quit => {
            quit(&app);
            Ok(())
        }
    }
}

/// Push the Webview's localized tray labels into the native menu.
#[tauri::command]
pub fn sync_desktop_shell_labels<R: Runtime>(
    app: tauri::AppHandle<R>,
    labels: crate::desktop_shell::TrayLabels,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        crate::desktop_shell::sync_labels(&app, labels)
    }
    #[cfg(not(desktop))]
    {
        let _ = (&app, labels);
        Ok(())
    }
}
