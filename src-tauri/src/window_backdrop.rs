//! Native window-base material. CSS becomes transparent only after confirmation.
use serde::{Deserialize, Serialize};
use tauri::{Runtime, WebviewWindow};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackdropTheme {
    Light,
    Dark,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BackdropMode {
    Mica,
    Solid,
}

fn solid_color(theme: BackdropTheme) -> tauri::window::Color {
    match theme {
        BackdropTheme::Light => tauri::window::Color(243, 243, 243, 255),
        BackdropTheme::Dark => tauri::window::Color(32, 32, 32, 255),
    }
}

#[cfg(target_os = "windows")]
fn apply<R: Runtime>(
    window: &WebviewWindow<R>,
    theme: BackdropTheme,
    enabled: bool,
) -> Result<BackdropMode, String> {
    if enabled {
        match window_vibrancy::apply_mica(window, Some(matches!(theme, BackdropTheme::Dark))) {
            Ok(()) => {
                window
                    .set_background_color(Some(tauri::window::Color(0, 0, 0, 0)))
                    .map_err(|error| error.to_string())?;
                return Ok(BackdropMode::Mica);
            }
            Err(error) => tracing::debug!("Mica unavailable; using solid window base: {error}"),
        }
    }
    // Unsupported Windows versions may also reject clearing a never-set effect.
    let _ = window_vibrancy::clear_mica(window);
    window
        .set_background_color(Some(solid_color(theme)))
        .map_err(|error| error.to_string())?;
    Ok(BackdropMode::Solid)
}

#[cfg(not(target_os = "windows"))]
fn apply<R: Runtime>(
    window: &WebviewWindow<R>,
    theme: BackdropTheme,
    _enabled: bool,
) -> Result<BackdropMode, String> {
    window
        .set_background_color(Some(solid_color(theme)))
        .map_err(|error| error.to_string())?;
    Ok(BackdropMode::Solid)
}

#[tauri::command]
pub async fn set_window_backdrop<R: Runtime>(
    window: WebviewWindow<R>,
    theme: BackdropTheme,
    enabled: bool,
) -> Result<BackdropMode, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = sender.send(apply(&target, theme, enabled));
        })
        .map_err(|error| error.to_string())?;
    receiver.await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_values_and_fallbacks_match_the_frontend_contract() {
        assert_eq!(
            serde_json::to_string(&BackdropMode::Mica).unwrap(),
            "\"mica\""
        );
        assert_eq!(
            serde_json::to_string(&BackdropMode::Solid).unwrap(),
            "\"solid\""
        );
        let light: BackdropTheme = serde_json::from_str("\"light\"").unwrap();
        let dark: BackdropTheme = serde_json::from_str("\"dark\"").unwrap();
        assert_eq!(solid_color(light), tauri::window::Color(243, 243, 243, 255));
        assert_eq!(solid_color(dark), tauri::window::Color(32, 32, 32, 255));
        assert!(serde_json::from_str::<BackdropTheme>("\"auto\"").is_err());
    }
}
