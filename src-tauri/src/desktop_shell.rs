//! Desktop shell behaviour: what the close button does, and the system tray.
//!
//! The close policy is device-scoped, so it lives in the local settings store and
//! the native close handler can read it without a round trip through the Webview.
//! Menu labels stay owned by the Webview (the single source of truth for i18n)
//! and are pushed down through the `sync_desktop_shell_labels` command.
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, Runtime};
#[cfg(desktop)]
use tauri::{Emitter, Window};

/// Local settings key holding the close-button policy.
pub const CLOSE_BEHAVIOR_SETTING: &str = "desktop.close_behavior";
/// Emitted to the Webview when the close policy is [`CloseBehavior::Ask`].
pub const CLOSE_REQUESTED_EVENT: &str = "cfms:close-requested";
/// The only window the close policy and tray toggling apply to.
const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "cfms-main-tray";

const MENU_SHOW: &str = "show";
const MENU_HIDE: &str = "hide";
const MENU_QUIT: &str = "quit";

/// What clicking the window's close button does.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloseBehavior {
    /// Ask in the Webview on every close (the default for a fresh profile).
    #[default]
    Ask,
    /// Hide the window and keep running in the tray.
    MinimizeToTray,
    /// Quit the application immediately.
    Quit,
}

impl CloseBehavior {
    fn from_setting(raw: Option<&str>) -> Self {
        match raw {
            Some("minimize_to_tray") => Self::MinimizeToTray,
            Some("quit") => Self::Quit,
            _ => Self::Ask,
        }
    }

    fn as_setting(self) -> &'static str {
        match self {
            Self::Ask => "ask",
            Self::MinimizeToTray => "minimize_to_tray",
            Self::Quit => "quit",
        }
    }
}

/// Localized tray labels, owned by the Webview.
#[derive(Clone, Debug, Deserialize)]
pub struct TrayLabels {
    pub show: String,
    pub hide: String,
    pub quit: String,
    pub tooltip: String,
}

impl Default for TrayLabels {
    fn default() -> Self {
        Self {
            show: "Show window".into(),
            hide: "Hide to tray".into(),
            quit: "Quit".into(),
            tooltip: "CFMS Client".into(),
        }
    }
}

/// One "what should happen?" prompt is open; a second close click means quit.
///
/// Without this a Webview that never answers would leave the window impossible
/// to close, which is worse than the dialog it protects.
static ASK_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

/// Read the stored close policy, falling back to asking.
pub fn read_behavior<R: Runtime>(app: &AppHandle<R>) -> CloseBehavior {
    let Some(state) = app.try_state::<crate::AppHandleState>() else {
        return CloseBehavior::default();
    };
    match state.settings.get(CLOSE_BEHAVIOR_SETTING) {
        Ok(value) => CloseBehavior::from_setting(value.as_deref()),
        Err(error) => {
            tracing::warn!("Unable to read the close behaviour, asking instead: {error}");
            CloseBehavior::default()
        }
    }
}

/// Persist the close policy locally (never synced with the account).
pub fn write_behavior<R: Runtime>(
    app: &AppHandle<R>,
    behavior: CloseBehavior,
) -> Result<(), String> {
    let state = app.state::<crate::AppHandleState>();
    state
        .settings
        .set(CLOSE_BEHAVIOR_SETTING, behavior.as_setting())
        .map_err(|error| format!("Failed to save the close behaviour: {error}"))
}

/// Forget a pending prompt so the next close asks again.
pub fn clear_pending_ask() {
    ASK_IN_FLIGHT.store(false, Ordering::SeqCst);
}

fn main_window<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::WebviewWindow<R>> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
}

/// Bring the main window back from the tray.
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    clear_pending_ask();
    if let Some(window) = main_window(app) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Hide the main window, keeping the process (and its transfers) alive.
pub fn hide_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = main_window(app) {
        let _ = window.hide();
    }
}

/// Terminate the application.
pub fn quit<R: Runtime>(app: &AppHandle<R>) {
    app.exit(0);
}

/// Hide to the tray; quit when no tray is available so the window is never lost.
pub fn minimize_to_tray<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(desktop)]
    {
        if app.tray_by_id(TRAY_ID).is_some() {
            hide_main_window(app);
            return;
        }
    }
    quit(app);
}

/// Intercept the close button for the main window.
#[cfg(desktop)]
pub fn handle_window_event<R: Runtime>(window: &Window<R>, event: &tauri::WindowEvent) {
    let tauri::WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    if window.label() != MAIN_WINDOW_LABEL {
        return;
    }

    let app = window.app_handle();
    match read_behavior(app) {
        // Let the close through; it is the only window, so the app exits.
        CloseBehavior::Quit => {}
        CloseBehavior::MinimizeToTray => {
            api.prevent_close();
            hide_main_window(app);
        }
        CloseBehavior::Ask => {
            if ASK_IN_FLIGHT.swap(true, Ordering::SeqCst) {
                // The Webview never answered the first prompt.
                return;
            }
            api.prevent_close();
            // The prompt lives in the Webview, so make sure it is on screen.
            if let Some(main) = main_window(app) {
                let _ = main.show();
                let _ = main.set_focus();
            }
            if let Err(error) = window.emit(CLOSE_REQUESTED_EVENT, ()) {
                tracing::warn!("Unable to ask about the close request: {error}");
                clear_pending_ask();
            }
        }
    }
}

#[cfg(desktop)]
fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    labels: &TrayLabels,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

    let show = MenuItem::with_id(app, MENU_SHOW, &labels.show, true, None::<&str>)?;
    let hide = MenuItem::with_id(app, MENU_HIDE, &labels.hide, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, &labels.quit, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;

    Menu::with_items(app, &[&show, &hide, &separator, &quit])
}

/// Create the tray icon once the main window exists.
#[cfg(desktop)]
pub fn init_tray<R: Runtime>(app: &AppHandle<R>, labels: TrayLabels) -> tauri::Result<()> {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let menu = build_menu(app, &labels)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip(labels.tooltip.as_str())
        // Left click restores the window; the menu lives on right click.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id: &str = event.id().as_ref();
            match id {
                MENU_SHOW => show_main_window(app),
                MENU_HIDE => hide_main_window(app),
                MENU_QUIT => quit(app),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

/// Show the window when it is hidden, hide it when it is in front.
#[cfg(desktop)]
pub fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = main_window(app) else {
        return;
    };
    match window.is_visible() {
        Ok(true) if !window.is_minimized().unwrap_or(false) => {
            let _ = window.hide();
        }
        _ => show_main_window(app),
    }
}

/// Replace the tray menu labels after a locale change.
#[cfg(desktop)]
pub fn sync_labels<R: Runtime>(app: &AppHandle<R>, labels: TrayLabels) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let menu = build_menu(app, &labels).map_err(|error| error.to_string())?;
    tray.set_menu(Some(menu))
        .map_err(|error| error.to_string())?;
    tray.set_tooltip(Some(labels.tooltip.as_str()))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_values_and_defaults_match_the_frontend_contract() {
        assert_eq!(
            serde_json::to_string(&CloseBehavior::Ask).unwrap(),
            "\"ask\""
        );
        assert_eq!(
            serde_json::to_string(&CloseBehavior::MinimizeToTray).unwrap(),
            "\"minimize_to_tray\""
        );
        assert_eq!(
            serde_json::to_string(&CloseBehavior::Quit).unwrap(),
            "\"quit\""
        );

        let parsed: CloseBehavior = serde_json::from_str("\"minimize_to_tray\"").unwrap();
        assert_eq!(parsed, CloseBehavior::MinimizeToTray);
        assert!(serde_json::from_str::<CloseBehavior>("\"close\"").is_err());

        // Fresh profiles and unknown values must ask, never quit.
        assert_eq!(CloseBehavior::from_setting(None), CloseBehavior::Ask);
        assert_eq!(
            CloseBehavior::from_setting(Some("nonsense")),
            CloseBehavior::Ask
        );
        assert_eq!(CloseBehavior::default(), CloseBehavior::Ask);
        assert_eq!(
            CloseBehavior::MinimizeToTray.as_setting(),
            "minimize_to_tray"
        );
        assert_eq!(
            CloseBehavior::from_setting(Some(CloseBehavior::Quit.as_setting())),
            CloseBehavior::Quit
        );
    }
}
