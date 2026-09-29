//! Device-local GitHub API credential storage.
//!
//! The webview only sees a status value. The token stays in the native process
//! and is read from the operating system's credential store for each request.

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use serde::Serialize;
use tauri::{AppHandle, Runtime};
use zeroize::Zeroizing;

#[cfg(not(target_os = "android"))]
const SERVICE: &str = "org.crpteam.cfms_client_tauri.github-api";
#[cfg(not(target_os = "android"))]
const ACCOUNT: &str = "personal-access-token";
const MAX_TOKEN_LEN: usize = 4096;
const STORAGE_UNAVAILABLE: &str = "GitHub credential storage is unavailable on this device.";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GithubAuthMode {
    None,
    Configured,
    NeedsAttention,
    Unavailable,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub struct GithubAuthStatus {
    pub mode: GithubAuthMode,
}

enum StoredCredential {
    Missing,
    Present(Zeroizing<String>),
    #[cfg(target_os = "android")]
    NeedsAttention,
}

trait CredentialBackend: Send + Sync {
    fn read(&self) -> Result<StoredCredential, ()>;
    fn save(&self, token: &str) -> Result<(), ()>;
    fn delete(&self) -> Result<(), ()>;
}

pub struct GithubCredentialState {
    backend: Arc<dyn CredentialBackend>,
    operation_lock: Arc<Mutex<()>>,
    control: Arc<Mutex<CredentialControl>>,
    resetting: Arc<AtomicBool>,
}

#[derive(Default)]
struct CredentialControl {
    generation: u64,
    needs_attention: bool,
}

impl GithubCredentialState {
    pub fn new<R: Runtime>(app: &AppHandle<R>) -> Self {
        Self {
            backend: backend_for_app(app),
            operation_lock: Arc::new(Mutex::new(())),
            control: Arc::new(Mutex::new(CredentialControl::default())),
            resetting: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn status(&self) -> GithubAuthStatus {
        let mode = match self.read().await {
            Ok(StoredCredential::Missing) => GithubAuthMode::None,
            Ok(StoredCredential::Present(_)) if self.control.lock().unwrap().needs_attention => {
                GithubAuthMode::NeedsAttention
            }
            Ok(StoredCredential::Present(_)) => GithubAuthMode::Configured,
            #[cfg(target_os = "android")]
            Ok(StoredCredential::NeedsAttention) => GithubAuthMode::NeedsAttention,
            Err(()) => GithubAuthMode::Unavailable,
        };
        GithubAuthStatus { mode }
    }

    /// Only native GitHub API callers may receive the token. A failed
    /// authentication attempt disables it until the user replaces or removes it.
    pub async fn token_for_request(&self) -> Option<(Zeroizing<String>, u64)> {
        if self.resetting.load(Ordering::SeqCst) {
            return None;
        }
        let generation = {
            let control = self.control.lock().unwrap();
            if control.needs_attention {
                return None;
            }
            control.generation
        };
        let read = self.read().await;
        let control = self.control.lock().unwrap();
        if control.generation != generation
            || control.needs_attention
            || self.resetting.load(Ordering::SeqCst)
        {
            return None;
        }
        match read {
            Ok(StoredCredential::Present(token)) => Some((token, generation)),
            _ => None,
        }
    }

    pub fn mark_needs_attention_if_generation(&self, generation: u64) {
        let mut control = self.control.lock().unwrap();
        if control.generation == generation {
            control.needs_attention = true;
        }
    }

    pub fn generation(&self) -> u64 {
        self.control.lock().unwrap().generation
    }

    pub async fn save(&self, token: String) -> Result<(), String> {
        let token = Zeroizing::new(token);
        let token = Zeroizing::new(token.trim().to_owned());
        if token.is_empty() || token.len() > MAX_TOKEN_LEN || token.chars().any(char::is_control) {
            return Err("Enter a valid GitHub personal access token.".into());
        }
        let backend = Arc::clone(&self.backend);
        let operation_lock = Arc::clone(&self.operation_lock);
        let control = Arc::clone(&self.control);
        let resetting = Arc::clone(&self.resetting);
        tokio::task::spawn_blocking(move || {
            let _operation = operation_lock.lock().unwrap();
            if resetting.load(Ordering::SeqCst) {
                return Err("A local data reset is in progress.".to_owned());
            }
            backend
                .save(&token)
                .map_err(|()| STORAGE_UNAVAILABLE.to_string())?;
            let mut control = control.lock().unwrap();
            control.generation = control.generation.wrapping_add(1);
            control.needs_attention = false;
            Ok(())
        })
        .await
        .map_err(|_| STORAGE_UNAVAILABLE.to_string())?
    }

    pub async fn delete(&self) -> Result<(), String> {
        let backend = Arc::clone(&self.backend);
        let operation_lock = Arc::clone(&self.operation_lock);
        let control = Arc::clone(&self.control);
        let resetting = Arc::clone(&self.resetting);
        tokio::task::spawn_blocking(move || {
            let _operation = operation_lock.lock().unwrap();
            if resetting.load(Ordering::SeqCst) {
                return Err("A local data reset is in progress.".to_owned());
            }
            backend
                .delete()
                .map_err(|()| STORAGE_UNAVAILABLE.to_string())?;
            let mut control = control.lock().unwrap();
            control.generation = control.generation.wrapping_add(1);
            control.needs_attention = false;
            Ok(())
        })
        .await
        .map_err(|_| STORAGE_UNAVAILABLE.to_string())?
    }

    async fn read(&self) -> Result<StoredCredential, ()> {
        let backend = Arc::clone(&self.backend);
        let operation_lock = Arc::clone(&self.operation_lock);
        tokio::task::spawn_blocking(move || {
            let _operation = operation_lock.lock().unwrap();
            backend.read()
        })
        .await
        .map_err(|_| ())?
    }

    pub fn begin_reset(&self) {
        self.resetting.store(true, Ordering::SeqCst);
    }

    pub fn cancel_reset(&self) {
        self.resetting.store(false, Ordering::SeqCst);
    }

    pub async fn delete_for_reset(&self) -> Result<(), String> {
        let backend = Arc::clone(&self.backend);
        let operation_lock = Arc::clone(&self.operation_lock);
        let control = Arc::clone(&self.control);
        tokio::task::spawn_blocking(move || {
            let _operation = operation_lock.lock().unwrap();
            clear_backend_for_reset(backend.as_ref())?;
            let mut control = control.lock().unwrap();
            control.generation = control.generation.wrapping_add(1);
            control.needs_attention = false;
            Ok(())
        })
        .await
        .map_err(|_| STORAGE_UNAVAILABLE.to_string())?
    }
}

fn clear_backend_for_reset(backend: &dyn CredentialBackend) -> Result<(), String> {
    backend
        .delete()
        .map_err(|()| STORAGE_UNAVAILABLE.to_string())
}

#[cfg(target_os = "android")]
fn backend_for_app<R: Runtime>(app: &AppHandle<R>) -> Arc<dyn CredentialBackend> {
    use tauri::Manager;
    Arc::new(AndroidBackend {
        handle: app
            .state::<crate::AndroidGithubCredentialPlugin<R>>()
            .handle
            .clone(),
    })
}

#[cfg(not(target_os = "android"))]
fn backend_for_app<R: Runtime>(_app: &AppHandle<R>) -> Arc<dyn CredentialBackend> {
    Arc::new(SystemBackend)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
struct SystemBackend;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl SystemBackend {
    fn entry() -> Result<keyring::Entry, ()> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|_| ())
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl CredentialBackend for SystemBackend {
    fn read(&self) -> Result<StoredCredential, ()> {
        match Self::entry()?.get_password() {
            Ok(value) => Ok(StoredCredential::Present(Zeroizing::new(value))),
            Err(keyring::Error::NoEntry) => Ok(StoredCredential::Missing),
            Err(_) => Err(()),
        }
    }

    fn save(&self, token: &str) -> Result<(), ()> {
        Self::entry()?.set_password(token).map_err(|_| ())
    }

    fn delete(&self) -> Result<(), ()> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(()),
        }
    }
}

#[cfg(target_os = "ios")]
struct SystemBackend;

#[cfg(target_os = "ios")]
impl SystemBackend {
    fn entry() -> Result<keyring_core::Entry, ()> {
        use keyring_core::api::CredentialStoreApi;
        use std::collections::HashMap;
        let modifiers = HashMap::from([("access-policy", "AfterFirstUnlockThisDeviceOnly")]);
        apple_native_keyring_store::protected::Store::new()
            .and_then(|store| store.build(SERVICE, ACCOUNT, Some(&modifiers)))
            .map_err(|_| ())
    }
}

#[cfg(target_os = "ios")]
impl CredentialBackend for SystemBackend {
    fn read(&self) -> Result<StoredCredential, ()> {
        match Self::entry()?.get_password() {
            Ok(value) => Ok(StoredCredential::Present(Zeroizing::new(value))),
            Err(keyring_core::Error::NoEntry) => Ok(StoredCredential::Missing),
            Err(_) => Err(()),
        }
    }

    fn save(&self, token: &str) -> Result<(), ()> {
        Self::entry()?.set_password(token).map_err(|_| ())
    }

    fn delete(&self) -> Result<(), ()> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(_) => Err(()),
        }
    }
}

#[cfg(target_os = "android")]
struct AndroidBackend<R: Runtime> {
    handle: tauri::plugin::PluginHandle<R>,
}

#[cfg(target_os = "android")]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AndroidCredentialRead {
    token: Option<String>,
    needs_attention: bool,
}

#[cfg(target_os = "android")]
impl<R: Runtime> CredentialBackend for AndroidBackend<R> {
    fn read(&self) -> Result<StoredCredential, ()> {
        let value = self
            .handle
            .run_mobile_plugin::<AndroidCredentialRead>("read", serde_json::json!({}))
            .map_err(|_| ())?;
        if value.needs_attention {
            Ok(StoredCredential::NeedsAttention)
        } else if let Some(token) = value.token {
            Ok(StoredCredential::Present(Zeroizing::new(token)))
        } else {
            Ok(StoredCredential::Missing)
        }
    }

    fn save(&self, token: &str) -> Result<(), ()> {
        self.handle
            .run_mobile_plugin::<()>("save", serde_json::json!({ "token": token }))
            .map_err(|_| ())
    }

    fn delete(&self) -> Result<(), ()> {
        self.handle
            .run_mobile_plugin::<()>("delete", serde_json::json!({}))
            .map_err(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{Receiver, Sender};

    #[derive(Default)]
    struct FakeStore {
        token: Mutex<Option<String>>,
        unavailable: AtomicBool,
        save_gate: Mutex<Option<(Sender<()>, Receiver<()>)>>,
    }

    impl CredentialBackend for FakeStore {
        fn read(&self) -> Result<StoredCredential, ()> {
            if self.unavailable.load(Ordering::SeqCst) {
                return Err(());
            }
            Ok(match self.token.lock().unwrap().clone() {
                Some(token) => StoredCredential::Present(Zeroizing::new(token)),
                None => StoredCredential::Missing,
            })
        }

        fn save(&self, token: &str) -> Result<(), ()> {
            if self.unavailable.load(Ordering::SeqCst) {
                return Err(());
            }
            if let Some((started, release)) = self.save_gate.lock().unwrap().take() {
                let _ = started.send(());
                let _ = release.recv();
            }
            *self.token.lock().unwrap() = Some(token.to_owned());
            Ok(())
        }

        fn delete(&self) -> Result<(), ()> {
            if self.unavailable.load(Ordering::SeqCst) {
                return Err(());
            }
            *self.token.lock().unwrap() = None;
            Ok(())
        }
    }

    fn state(backend: Arc<FakeStore>) -> GithubCredentialState {
        GithubCredentialState {
            backend,
            operation_lock: Arc::new(Mutex::new(())),
            control: Arc::new(Mutex::new(CredentialControl::default())),
            resetting: Arc::new(AtomicBool::new(false)),
        }
    }

    #[tokio::test]
    async fn save_replace_delete_and_fresh_state_read() {
        let store = Arc::new(FakeStore::default());
        let credentials = state(Arc::clone(&store));
        assert_eq!(credentials.status().await.mode, GithubAuthMode::None);

        credentials.save("  first  ".into()).await.unwrap();
        assert_eq!(store.token.lock().unwrap().as_deref(), Some("first"));

        let restarted = state(Arc::clone(&store));
        assert_eq!(restarted.status().await.mode, GithubAuthMode::Configured);
        assert_eq!(
            restarted.token_for_request().await.unwrap().0.as_str(),
            "first"
        );

        restarted.save("second".into()).await.unwrap();
        assert_eq!(
            credentials.token_for_request().await.unwrap().0.as_str(),
            "second"
        );
        restarted.delete().await.unwrap();
        assert_eq!(credentials.status().await.mode, GithubAuthMode::None);
        assert!(credentials.token_for_request().await.is_none());
    }

    #[tokio::test]
    async fn auth_failure_disables_token_until_replaced() {
        let store = Arc::new(FakeStore::default());
        let credentials = state(store);
        credentials.save("first".into()).await.unwrap();
        let (_, generation) = credentials.token_for_request().await.unwrap();
        credentials.mark_needs_attention_if_generation(generation);

        assert_eq!(
            credentials.status().await.mode,
            GithubAuthMode::NeedsAttention
        );
        assert!(credentials.token_for_request().await.is_none());

        credentials.save("replacement".into()).await.unwrap();
        assert_eq!(credentials.status().await.mode, GithubAuthMode::Configured);
        assert_eq!(
            credentials.token_for_request().await.unwrap().0.as_str(),
            "replacement"
        );
    }

    #[tokio::test]
    async fn old_request_cannot_invalidate_replacement() {
        let store = Arc::new(FakeStore::default());
        let credentials = state(store);
        credentials.save("first".into()).await.unwrap();
        let (_, old_generation) = credentials.token_for_request().await.unwrap();

        credentials.save("replacement".into()).await.unwrap();
        credentials.mark_needs_attention_if_generation(old_generation);
        assert_eq!(credentials.status().await.mode, GithubAuthMode::Configured);
        assert_eq!(
            credentials.token_for_request().await.unwrap().0.as_str(),
            "replacement"
        );
    }

    #[tokio::test]
    async fn aborted_in_flight_save_cannot_restore_token_after_reset() {
        let store = Arc::new(FakeStore::default());
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        *store.save_gate.lock().unwrap() = Some((started_tx, release_rx));
        let credentials = Arc::new(state(Arc::clone(&store)));

        let save = tokio::spawn({
            let credentials = Arc::clone(&credentials);
            async move { credentials.save("in-flight".into()).await }
        });
        tokio::task::spawn_blocking(move || {
            started_rx
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap()
        })
        .await
        .unwrap();

        save.abort();
        credentials.begin_reset();
        let reset = tokio::spawn({
            let credentials = Arc::clone(&credentials);
            async move { credentials.delete_for_reset().await }
        });
        let late_save = tokio::spawn({
            let credentials = Arc::clone(&credentials);
            async move { credentials.save("too-late".into()).await }
        });

        release_tx.send(()).unwrap();
        assert!(save.await.unwrap_err().is_cancelled());
        reset.await.unwrap().unwrap();
        assert!(late_save.await.unwrap().is_err());
        assert!(store.token.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn unavailable_store_never_falls_back_to_plaintext() {
        let store = Arc::new(FakeStore::default());
        store.unavailable.store(true, Ordering::SeqCst);
        let credentials = state(Arc::clone(&store));
        assert_eq!(credentials.status().await.mode, GithubAuthMode::Unavailable);
        assert!(credentials.token_for_request().await.is_none());
        assert!(credentials.save("abc".into()).await.is_err());
        assert!(credentials.delete().await.is_err());
        assert!(store.token.lock().unwrap().is_none());
    }

    #[test]
    fn reset_requires_credential_deletion_before_restart() {
        let store = FakeStore::default();
        store.save("secret").unwrap();
        clear_backend_for_reset(&store).unwrap();
        assert!(store.token.lock().unwrap().is_none());

        store.unavailable.store(true, Ordering::SeqCst);
        assert!(clear_backend_for_reset(&store).is_err());
    }
}
