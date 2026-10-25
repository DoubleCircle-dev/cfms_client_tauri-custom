//! Small native-only adapter shared by GitHub credentials and preference keys.
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{AppHandle, Runtime};
use zeroize::Zeroizing;

pub const UNAVAILABLE: &str = "publicKey.storageUnavailable";

pub struct SecretStore<R: Runtime> {
    app: AppHandle<R>,
    service: String,
    account: String,
}

impl<R: Runtime> SecretStore<R> {
    pub fn new(app: &AppHandle<R>, service: &str, account: &str) -> Self {
        Self {
            app: app.clone(),
            service: service.into(),
            account: account.into(),
        }
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn entry(&self) -> Result<keyring::Entry, String> {
        let _ = &self.app;
        keyring::Entry::new(&self.service, &self.account).map_err(|_| UNAVAILABLE.into())
    }
    #[cfg(target_os = "ios")]
    fn entry(&self) -> Result<keyring_core::Entry, String> {
        use keyring_core::api::CredentialStoreApi;
        apple_native_keyring_store::protected::Store::new()
            .and_then(|store| {
                store.build(
                    &self.service,
                    &self.account,
                    Some(&std::collections::HashMap::from([(
                        "access-policy",
                        "AfterFirstUnlockThisDeviceOnly",
                    )])),
                )
            })
            .map_err(|_| UNAVAILABLE.into())
    }
    pub fn read(&self) -> Result<Option<Zeroizing<String>>, String> {
        #[cfg(not(target_os = "android"))]
        {
            match self.entry()?.get_password() {
                Ok(value) => Ok(Some(Zeroizing::new(value))),
                #[cfg(not(target_os = "ios"))]
                Err(keyring::Error::NoEntry) => Ok(None),
                #[cfg(target_os = "ios")]
                Err(keyring_core::Error::NoEntry) => Ok(None),
                Err(_) => Err(UNAVAILABLE.into()),
            }
        }
        #[cfg(target_os = "android")]
        {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Read {
                token: Option<String>,
                needs_attention: bool,
            }
            let read = self
                .app
                .state::<crate::AndroidGithubCredentialPlugin<R>>()
                .handle
                .run_mobile_plugin::<Read>("read", self.args(None))
                .map_err(|_| UNAVAILABLE)?;
            if read.needs_attention {
                Err("publicKey.storageInvalidated".into())
            } else {
                Ok(read.token.map(Zeroizing::new))
            }
        }
    }
    pub fn save(&self, value: &str) -> Result<(), String> {
        #[cfg(not(target_os = "android"))]
        {
            self.entry()?
                .set_password(value)
                .map_err(|_| UNAVAILABLE.into())
        }
        #[cfg(target_os = "android")]
        {
            self.app
                .state::<crate::AndroidGithubCredentialPlugin<R>>()
                .handle
                .run_mobile_plugin::<()>("save", self.args(Some(value)))
                .map_err(|_| UNAVAILABLE.into())
        }
    }
    pub fn delete(&self) -> Result<(), String> {
        #[cfg(not(target_os = "android"))]
        {
            match self.entry()?.delete_credential() {
                Ok(()) => Ok(()),
                #[cfg(not(target_os = "ios"))]
                Err(keyring::Error::NoEntry) => Ok(()),
                #[cfg(target_os = "ios")]
                Err(keyring_core::Error::NoEntry) => Ok(()),
                Err(_) => Err(UNAVAILABLE.into()),
            }
        }
        #[cfg(target_os = "android")]
        {
            self.app
                .state::<crate::AndroidGithubCredentialPlugin<R>>()
                .handle
                .run_mobile_plugin::<()>("delete", self.args(None))
                .map_err(|_| UNAVAILABLE.into())
        }
    }
    #[cfg(target_os = "android")]
    fn args(&self, value: Option<&str>) -> serde_json::Value {
        // Preserve the installed GitHub credential's original Android location.
        let legacy = self.service == "org.crpteam.cfms_client_tauri.github-api";
        serde_json::json!({"token":value, "service":if legacy { None } else { Some(&self.service) }, "account":&self.account})
    }
}
