//! Signed client extensions with declarative and sandboxed WebAssembly runtimes.
//!
//! WebAssembly modules have no host imports or ambient network, filesystem, or
//! native access; host operations remain explicit, capability-checked workflows.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use rand::RngExt;
use rusqlite::{OptionalExtension, params};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::db::settings::SettingsStore;

#[path = "extension_wasm.rs"]
mod wasm_runtime;

pub const HOST_API_VERSION: &str = "1.0.0";
pub const WASM_HOST_API_VERSION: &str = "api-custom-v2";
pub const MAINTAINER_EXTENSION_KEY_ID: &str = "cfms-plugin";
pub const DEFAULT_CATALOG_URL: &str =
    "https://github.com/DoubleCircle-dev/cfms-plugin/releases/download/plugins/catalog.json";
const MAX_PACKAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 50 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_JSON_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PAGE_STYLES_BYTES: usize = 16 * 1024;
const MAX_PAGE_STYLE_RULES: usize = 64;
const MAX_PAGE_STYLE_DECLARATIONS: usize = 16;
const MAX_EXTENSION_TABLE_ROWS: usize = 64;
const MAX_EXTENSION_TABLE_COLUMNS: usize = 32;
const MAX_EXTENSION_TABLE_BYTES: usize = 64 * 1024;
const MAX_FILES: usize = 256;

const ALLOWED_CAPABILITIES: &[&str] = &[
    "files.metadata.read",
    "files.list",
    "files.search",
    "files.updates.check",
    "files.sync.full",
    "files.sync.task",
    "schedules.manage",
    "tasks.read",
    "transfers.download.enqueue",
    "account.summary.read",
    "preferences.read",
    "preferences.write",
    "events.subscribe",
    "ui.confirm",
    "ui.notify",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    pub publisher: String,
    pub version: String,
    pub host_api: String,
    pub min_client_version: String,
    #[serde(default)]
    pub platforms: Vec<String>,
    #[serde(default)]
    pub entrypoints: ExtensionEntrypoints,
    #[serde(default)]
    pub requested_capabilities: Vec<String>,
    #[serde(default)]
    pub background_triggers: Vec<BackgroundTrigger>,
    #[serde(default)]
    pub content_hashes: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime: Option<ExtensionRuntime>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ExtensionRuntime {
    Wasm { module: String },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExtensionEntrypoints {
    #[serde(default)]
    pub navigation: Vec<ExtensionNavigationEntry>,
    #[serde(default)]
    pub settings: Vec<ExtensionPageEntry>,
    #[serde(default)]
    pub workflows: Vec<ExtensionWorkflowEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionNavigationEntry {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub page: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionPageEntry {
    pub id: String,
    pub label: String,
    pub page: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionWorkflowEntry {
    pub id: String,
    pub label: String,
    pub workflow: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BackgroundTrigger {
    OnEnable { workflow: String },
    OnLogin { workflow: String },
    Interval { workflow: String, minutes: u32 },
    Event { workflow: String, event: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionInstallation {
    pub manifest: ExtensionManifest,
    pub package_digest: String,
    #[serde(default)]
    pub signing_key_id: Option<String>,
    pub install_epoch: String,
    pub state: String,
    pub installed_at: i64,
    pub previous_version: Option<String>,
    pub last_error: Option<String>,
    pub disk_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogDocument {
    pub schema_version: u32,
    pub generated_at: i64,
    #[serde(default)]
    pub extensions: Vec<CatalogExtension>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogExtension {
    pub manifest: ExtensionManifest,
    pub download_url: String,
    pub sha256: String,
    pub signature: String,
    pub key_id: String,
    #[serde(default)]
    pub revoked: bool,
    pub revocation_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FileIndex {
    files: Vec<FileIndexEntry>,
}

#[derive(Debug, Deserialize)]
struct FileIndexEntry {
    path: String,
    sha256: String,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct SignatureEnvelope {
    key_id: String,
    signature: String,
}

#[derive(Debug)]
struct ValidatedPackage {
    manifest: ExtensionManifest,
    files: BTreeMap<String, Vec<u8>>,
    package_digest: String,
    signing_key_id: String,
    expanded_bytes: u64,
}

#[derive(Clone)]
pub struct ExtensionStore {
    settings: SettingsStore,
    root: PathBuf,
    client_version: Version,
    trusted_keys: BTreeMap<String, VerifyingKey>,
}

impl ExtensionStore {
    pub fn new(settings: SettingsStore, app_data_dir: &Path, client_version: &str) -> Self {
        Self {
            settings,
            root: app_data_dir.join("extensions"),
            client_version: Version::parse(client_version)
                .unwrap_or_else(|_| Version::new(0, 0, 0)),
            trusted_keys: compiled_trusted_keys(),
        }
    }

    #[cfg(test)]
    fn with_key(
        settings: SettingsStore,
        app_data_dir: &Path,
        client_version: &str,
        key_id: &str,
        key: VerifyingKey,
    ) -> Self {
        let mut store = Self::new(settings, app_data_dir, client_version);
        store.trusted_keys.insert(key_id.to_string(), key);
        store
    }

    pub fn has_trusted_keys(&self) -> bool {
        !self.trusted_keys.is_empty()
    }

    pub fn list_installed(&self) -> Result<Vec<ExtensionInstallation>, String> {
        let db = self
            .settings
            .db
            .lock()
            .map_err(|_| "Extension database lock poisoned")?;
        let mut statement = db
            .prepare(
                "SELECT extension_id, installed_version, package_digest, install_epoch, state, \
                 installed_at, previous_version, last_error FROM extension_installations \
                 ORDER BY extension_id",
            )
            .map_err(|e| format!("Failed to prepare extension query: {e}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            })
            .map_err(|e| format!("Failed to list extensions: {e}"))?;

        let mut result = Vec::new();
        for row in rows {
            let (id, version, digest, epoch, state, installed_at, previous, last_error) =
                row.map_err(|e| format!("Failed to read extension row: {e}"))?;
            let version_dir = self.package_dir(&id, &version)?;
            let (manifest, signing_key_id) = self.validate_installed_dir(&version_dir)?;
            result.push(ExtensionInstallation {
                manifest,
                package_digest: digest,
                signing_key_id: Some(signing_key_id),
                install_epoch: epoch,
                state,
                installed_at,
                previous_version: previous,
                last_error,
                disk_bytes: directory_size(&version_dir),
            });
        }
        result.extend(bundled_installations());
        result.sort_by(|left, right| left.manifest.id.cmp(&right.manifest.id));
        Ok(result)
    }

    pub fn get_installed(
        &self,
        extension_id: &str,
    ) -> Result<Option<ExtensionInstallation>, String> {
        validate_extension_id(extension_id)?;
        Ok(self
            .list_installed()?
            .into_iter()
            .find(|item| item.manifest.id == extension_id))
    }

    pub fn install_package(&self, package: &[u8]) -> Result<ExtensionInstallation, String> {
        let validated = self.validate_package(package)?;
        self.install_validated_package(validated)
    }

    pub fn install_catalog_package(
        &self,
        package: &[u8],
        catalog_entry: &CatalogExtension,
    ) -> Result<ExtensionInstallation, String> {
        if catalog_entry.revoked {
            return Err(catalog_entry
                .revocation_reason
                .clone()
                .unwrap_or_else(|| "This extension version has been revoked".into()));
        }
        let validated = self.validate_package(package)?;
        if validated.package_digest != catalog_entry.sha256.to_ascii_lowercase() {
            return Err("Extension package does not match the catalog SHA-256".into());
        }
        if serde_json::to_value(&validated.manifest).map_err(|e| e.to_string())?
            != serde_json::to_value(&catalog_entry.manifest).map_err(|e| e.to_string())?
        {
            return Err("Extension package manifest does not match the catalog entry".into());
        }
        let signature: SignatureEnvelope = serde_json::from_slice(
            validated
                .files
                .get("META-INF/signature.ed25519")
                .ok_or_else(|| "Extension package is missing its signature".to_string())?,
        )
        .map_err(|e| format!("Invalid extension signature envelope: {e}"))?;
        if signature.key_id != catalog_entry.key_id
            || !signature
                .signature
                .eq_ignore_ascii_case(&catalog_entry.signature)
        {
            return Err("Extension package signature does not match the catalog entry".into());
        }
        self.install_validated_package(validated)
    }

    fn install_validated_package(
        &self,
        validated: ValidatedPackage,
    ) -> Result<ExtensionInstallation, String> {
        let id = validated.manifest.id.clone();
        if bundled_installations()
            .iter()
            .any(|item| item.manifest.id == id)
        {
            return Err("A bundled extension already uses this extension id".into());
        }
        let version = validated.manifest.version.clone();
        if let Some(existing) = self.get_installed(&id)?
            && existing.manifest.version == version
        {
            if existing.package_digest == validated.package_digest {
                return Ok(existing);
            }
            return Err("Extension versions are immutable; publish a new version for changed package contents".into());
        }
        let destination = self.package_dir(&id, &version)?;
        let staging_root = self.root.join("staging");
        fs::create_dir_all(&staging_root)
            .map_err(|e| format!("Failed to create extension staging directory: {e}"))?;
        let staging = staging_root.join(random_hex(16));
        fs::create_dir(&staging).map_err(|e| format!("Failed to create staging directory: {e}"))?;

        let write_result = (|| {
            for (relative, contents) in &validated.files {
                let target = safe_join(&staging, relative)?;
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create extension directory: {e}"))?;
                }
                fs::write(&target, contents)
                    .map_err(|e| format!("Failed to write extension file {relative}: {e}"))?;
            }
            if destination.exists() {
                fs::remove_dir_all(&destination).map_err(|e| {
                    format!("Failed to remove an orphaned extension directory: {e}")
                })?;
            }
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create extension package directory: {e}"))?;
            }
            fs::rename(&staging, &destination)
                .map_err(|e| format!("Failed to activate extension package: {e}"))?;
            Ok::<(), String>(())
        })();
        if let Err(error) = write_result {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        if staging.exists() {
            let _ = fs::remove_dir_all(&staging);
        }

        let now = unix_now();
        let db = self
            .settings
            .db
            .lock()
            .map_err(|_| "Extension database lock poisoned")?;
        let previous = db
            .query_row(
                "SELECT installed_version FROM extension_installations WHERE extension_id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| format!("Failed to inspect prior extension version: {e}"))?;
        let epoch = db
            .query_row(
                "SELECT install_epoch FROM extension_installations WHERE extension_id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| format!("Failed to inspect extension epoch: {e}"))?
            .unwrap_or_else(|| random_hex(16));
        let previous_for_row = previous.filter(|existing| existing != &version);

        db.execute(
            "INSERT INTO extension_installations \
             (extension_id, installed_version, package_digest, install_epoch, state, installed_at, previous_version, last_error) \
             VALUES (?1, ?2, ?3, ?4, 'installed', ?5, ?6, NULL) \
             ON CONFLICT(extension_id) DO UPDATE SET installed_version = excluded.installed_version, \
             package_digest = excluded.package_digest, state = 'installed', installed_at = excluded.installed_at, \
             previous_version = excluded.previous_version, last_error = NULL",
            params![
                id,
                version,
                validated.package_digest,
                epoch,
                now,
                previous_for_row
            ],
        )
        .map_err(|e| format!("Failed to record extension installation: {e}"))?;
        db.execute(
            "INSERT INTO extension_package_versions (extension_id, version, package_digest, installed_at) \
             VALUES (?1, ?2, ?3, ?4) ON CONFLICT(extension_id, version) DO UPDATE SET \
             package_digest = excluded.package_digest, installed_at = excluded.installed_at",
            params![id, version, validated.package_digest, now],
        )
        .map_err(|e| format!("Failed to record extension package version: {e}"))?;
        drop(db);

        tracing::info!(extension_id = %validated.manifest.id, version = %validated.manifest.version, "Extension installed");
        Ok(ExtensionInstallation {
            manifest: validated.manifest,
            package_digest: validated.package_digest,
            signing_key_id: Some(validated.signing_key_id),
            install_epoch: epoch,
            state: "installed".into(),
            installed_at: now,
            previous_version: previous_for_row,
            last_error: None,
            disk_bytes: validated.expanded_bytes,
        })
    }

    pub fn rollback(&self, extension_id: &str) -> Result<ExtensionInstallation, String> {
        validate_extension_id(extension_id)?;
        if bundled_installations()
            .iter()
            .any(|item| item.manifest.id == extension_id)
        {
            return Err("Bundled extensions are updated with the client and cannot be rolled back separately".into());
        }
        let db = self
            .settings
            .db
            .lock()
            .map_err(|_| "Extension database lock poisoned")?;
        let (current, previous): (String, Option<String>) = db
            .query_row(
                "SELECT installed_version, previous_version FROM extension_installations WHERE extension_id = ?1",
                params![extension_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| format!("Extension is not installed: {e}"))?;
        let previous =
            previous.ok_or_else(|| "No previous extension version is available".to_string())?;
        let previous_dir = self.package_dir(extension_id, &previous)?;
        self.validate_installed_dir(&previous_dir)?;
        let previous_digest: String = db
            .query_row(
                "SELECT package_digest FROM extension_package_versions WHERE extension_id = ?1 AND version = ?2",
                params![extension_id, previous],
                |row| row.get(0),
            )
            .map_err(|e| format!("Previous extension package metadata is missing: {e}"))?;
        db.execute(
            "UPDATE extension_installations SET installed_version = ?2, previous_version = ?3, package_digest = ?4, state = 'installed', last_error = NULL WHERE extension_id = ?1",
            params![extension_id, previous, current, previous_digest],
        )
        .map_err(|e| format!("Failed to record extension rollback: {e}"))?;
        drop(db);
        tracing::info!(extension_id, "Extension rolled back");
        self.get_installed(extension_id)?
            .ok_or_else(|| "Rolled back extension disappeared".into())
    }

    pub fn uninstall(&self, extension_id: &str) -> Result<(), String> {
        validate_extension_id(extension_id)?;
        if bundled_installations()
            .iter()
            .any(|item| item.manifest.id == extension_id)
        {
            return Err("Bundled extensions cannot be uninstalled".into());
        }
        let extension_root = self.root.join("packages").join(extension_id);
        ensure_within(&extension_root, &self.root.join("packages"))?;
        if extension_root.exists() {
            fs::remove_dir_all(&extension_root)
                .map_err(|e| format!("Failed to remove extension files: {e}"))?;
        }
        let db = self
            .settings
            .db
            .lock()
            .map_err(|_| "Extension database lock poisoned")?;
        db.execute(
            "DELETE FROM extension_installations WHERE extension_id = ?1",
            params![extension_id],
        )
        .map_err(|e| format!("Failed to remove extension installation record: {e}"))?;
        db.execute(
            "DELETE FROM extension_package_versions WHERE extension_id = ?1",
            params![extension_id],
        )
        .map_err(|e| format!("Failed to remove extension version records: {e}"))?;
        tracing::info!(extension_id, "Extension uninstalled");
        Ok(())
    }

    pub fn read_page(&self, extension_id: &str, page: &str) -> Result<serde_json::Value, String> {
        validate_entry_id(page)?;
        if extension_id == "org.cfms.bundled.file-stats" && page == "overview" {
            return Ok(serde_json::json!({
                "schema_version": 1,
                "title": "File statistics",
                "description": "A bundled optional module demonstrating the same account-scoped extension lifecycle.",
                "blocks": [
                    { "type": "status_card", "title": "Module source", "value": "Bundled", "description": "Updated together with CFMS Client", "tone": "success" },
                    { "type": "status_card", "title": "Host API", "value": HOST_API_VERSION, "description": "Uses the same permission broker as installed extensions" },
                    { "type": "text", "style": "body", "text": "This optional module is compiled into the client but remains disabled until the current account grants its requested capability." },
                    { "type": "actions", "actions": [{ "id": "account", "label": "Check account context", "workflow": "account-check", "tone": "primary" }] }
                ]
            }));
        }
        if let Some(installation) = self.get_installed(extension_id)?
            && let Some(ExtensionRuntime::Wasm { module }) = &installation.manifest.runtime
        {
            let page_is_declared = installation
                .manifest
                .entrypoints
                .navigation
                .iter()
                .any(|entry| entry.page == page)
                || installation
                    .manifest
                    .entrypoints
                    .settings
                    .iter()
                    .any(|entry| entry.page == page);
            if !page_is_declared {
                return Err("Extension page is not declared in the manifest".into());
            }
            let module_path = safe_join(
                &self.package_dir(extension_id, &installation.manifest.version)?,
                module,
            )?;
            let module_bytes = fs::read(&module_path)
                .map_err(|e| format!("Failed to read extension WebAssembly module: {e}"))?;
            let document =
                wasm_runtime::execute(&module_bytes, &serde_json::json!({ "page": page }))?;
            if document
                .get("schema_version")
                .and_then(serde_json::Value::as_u64)
                != Some(1)
                || !document
                    .get("blocks")
                    .is_some_and(serde_json::Value::is_array)
            {
                return Err("WebAssembly extension returned an unsupported page document".into());
            }
            validate_extension_page_controls(&document)?;
            validate_extension_page_styles(&document)?;
            return Ok(document);
        }
        let installation = self
            .get_installed(extension_id)?
            .ok_or_else(|| "Extension is not installed".to_string())?;
        let path = self
            .package_dir(extension_id, &installation.manifest.version)?
            .join("pages")
            .join(format!("{page}.json"));
        let bytes = fs::read(&path).map_err(|e| format!("Failed to read extension page: {e}"))?;
        let document: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|e| format!("Invalid extension page: {e}"))?;
        validate_extension_page_controls(&document)?;
        validate_extension_page_styles(&document)?;
        Ok(document)
    }

    pub fn execute_module(
        &self,
        extension_id: &str,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        validate_extension_id(extension_id)?;
        let installation = self
            .get_installed(extension_id)?
            .ok_or_else(|| "Extension is not installed".to_string())?;
        let Some(ExtensionRuntime::Wasm { module }) = &installation.manifest.runtime else {
            return Err("Extension does not provide a WebAssembly runtime".into());
        };
        let module_path = safe_join(
            &self.package_dir(extension_id, &installation.manifest.version)?,
            module,
        )?;
        let module_bytes = fs::read(&module_path)
            .map_err(|e| format!("Failed to read extension WebAssembly module: {e}"))?;
        wasm_runtime::execute(&module_bytes, &input)
    }

    pub fn read_workflow(
        &self,
        extension_id: &str,
        workflow: &str,
    ) -> Result<serde_json::Value, String> {
        validate_entry_id(workflow)?;
        if extension_id == "org.cfms.bundled.file-stats" && workflow == "account-check" {
            return Ok(serde_json::json!({
                "schema_version": 1,
                "start": "account",
                "nodes": [
                    { "id": "account", "type": "host_call", "capability": "account.summary.read", "arguments": {}, "result": "account", "next": "message" },
                    { "id": "message", "type": "transform", "expression": { "op": "concat", "args": ["Signed in as ", "$results.account.username"] }, "result": "message", "next": "notify" },
                    { "id": "notify", "type": "notify", "tone": "success", "message": "$results.message", "next": "done" },
                    { "id": "done", "type": "result", "value": "$results.account" }
                ]
            }));
        }
        let installation = self
            .get_installed(extension_id)?
            .ok_or_else(|| "Extension is not installed".to_string())?;
        let path = self
            .package_dir(extension_id, &installation.manifest.version)?
            .join("workflows")
            .join(format!("{workflow}.json"));
        let bytes =
            fs::read(&path).map_err(|e| format!("Failed to read extension workflow: {e}"))?;
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid extension workflow: {e}"))
    }

    pub fn verify_catalog(
        &self,
        catalog_bytes: &[u8],
        signature_envelope: &str,
    ) -> Result<CatalogDocument, String> {
        let signature: SignatureEnvelope = serde_json::from_str(signature_envelope)
            .map_err(|e| format!("Invalid catalog signature envelope: {e}"))?;
        self.verify_signature(&signature.key_id, &signature.signature, catalog_bytes)?;
        let catalog: CatalogDocument = serde_json::from_slice(catalog_bytes)
            .map_err(|e| format!("Invalid extension catalog: {e}"))?;
        if catalog.schema_version != 1 {
            return Err(format!(
                "Unsupported extension catalog schema {}",
                catalog.schema_version
            ));
        }
        for entry in &catalog.extensions {
            self.validate_manifest(&entry.manifest)?;
            if !entry.download_url.starts_with("https://") {
                return Err(format!(
                    "Extension {} uses a non-HTTPS URL",
                    entry.manifest.id
                ));
            }
            validate_sha256(&entry.sha256)?;
            validate_hex(&entry.signature, 64, "catalog package signature")?;
            if !self.trusted_keys.contains_key(&entry.key_id) {
                return Err(format!("Unknown catalog package key {}", entry.key_id));
            }
        }
        Ok(catalog)
    }

    pub fn cache_catalog(
        &self,
        catalog_url: &str,
        etag: Option<&str>,
        catalog: &str,
        signature: &str,
    ) -> Result<(), String> {
        let db = self
            .settings
            .db
            .lock()
            .map_err(|_| "Extension database lock poisoned")?;
        db.execute(
            "INSERT INTO extension_catalog_state (catalog_url, etag, last_success_at, signed_catalog, signature) \
             VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(catalog_url) DO UPDATE SET \
             etag = excluded.etag, last_success_at = excluded.last_success_at, \
             signed_catalog = excluded.signed_catalog, signature = excluded.signature",
            params![catalog_url, etag, unix_now(), catalog, signature],
        )
        .map_err(|e| format!("Failed to cache extension catalog: {e}"))?;
        Ok(())
    }

    pub fn cached_catalog(&self, catalog_url: &str) -> Result<Option<CatalogDocument>, String> {
        let db = self
            .settings
            .db
            .lock()
            .map_err(|_| "Extension database lock poisoned")?;
        let row = db
            .query_row(
                "SELECT signed_catalog, signature FROM extension_catalog_state WHERE catalog_url = ?1",
                params![catalog_url],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|e| format!("Failed to read cached extension catalog: {e}"))?;
        drop(db);
        row.map(|(catalog, signature)| self.verify_catalog(catalog.as_bytes(), &signature))
            .transpose()
    }

    pub fn revocation_reason(
        &self,
        extension_id: &str,
        version: &str,
    ) -> Result<Option<String>, String> {
        let Some(catalog) = self.cached_catalog(DEFAULT_CATALOG_URL)? else {
            return Ok(None);
        };
        Ok(catalog
            .extensions
            .into_iter()
            .find(|entry| {
                entry.manifest.id == extension_id
                    && entry.manifest.version == version
                    && entry.revoked
            })
            .map(|entry| {
                entry
                    .revocation_reason
                    .unwrap_or_else(|| "This extension version has been revoked".into())
            }))
    }

    fn validate_package(&self, package: &[u8]) -> Result<ValidatedPackage, String> {
        if package.is_empty() || package.len() > MAX_PACKAGE_BYTES {
            return Err(format!(
                "Extension package must be between 1 byte and {MAX_PACKAGE_BYTES} bytes"
            ));
        }
        let package_digest = hex::encode(Sha256::digest(package));
        let mut archive = zip::ZipArchive::new(Cursor::new(package))
            .map_err(|e| format!("Invalid extension ZIP package: {e}"))?;
        if archive.len() > MAX_FILES {
            return Err(format!(
                "Extension package contains more than {MAX_FILES} files"
            ));
        }

        let mut files = BTreeMap::new();
        let mut expanded_bytes = 0_u64;
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|e| format!("Failed to inspect extension ZIP entry: {e}"))?;
            if entry.is_dir() {
                continue;
            }
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err("Extension packages cannot contain symbolic links".into());
            }
            let enclosed = entry
                .enclosed_name()
                .ok_or_else(|| "Extension package contains an unsafe path".to_string())?;
            let relative = normalized_relative_path(&enclosed)?;
            validate_package_path(&relative)?;
            let max_for_file = if relative.ends_with(".json") {
                MAX_JSON_BYTES
            } else {
                MAX_FILE_BYTES
            };
            if entry.size() > max_for_file {
                return Err(format!("Extension file {relative} exceeds its size limit"));
            }
            expanded_bytes = expanded_bytes
                .checked_add(entry.size())
                .ok_or_else(|| "Extension expanded size overflow".to_string())?;
            if expanded_bytes > MAX_EXPANDED_BYTES {
                return Err(format!(
                    "Extension package expands beyond {MAX_EXPANDED_BYTES} bytes"
                ));
            }
            if files.contains_key(&relative) {
                return Err(format!(
                    "Extension package contains duplicate path {relative}"
                ));
            }
            let mut contents = Vec::with_capacity(entry.size() as usize);
            entry
                .read_to_end(&mut contents)
                .map_err(|e| format!("Failed to read extension file {relative}: {e}"))?;
            files.insert(relative, contents);
        }

        let index_bytes = files
            .get("META-INF/files.json")
            .ok_or_else(|| "Extension package is missing META-INF/files.json".to_string())?;
        let signature_bytes = files
            .get("META-INF/signature.ed25519")
            .ok_or_else(|| "Extension package is missing META-INF/signature.ed25519".to_string())?;
        let signature: SignatureEnvelope = serde_json::from_slice(signature_bytes)
            .map_err(|e| format!("Invalid extension signature envelope: {e}"))?;
        self.verify_signature(&signature.key_id, &signature.signature, index_bytes)?;
        let file_index: FileIndex = serde_json::from_slice(index_bytes)
            .map_err(|e| format!("Invalid extension file index: {e}"))?;
        validate_file_index(&files, &file_index)?;

        let manifest_bytes = files
            .get("manifest.json")
            .ok_or_else(|| "Extension package is missing manifest.json".to_string())?;
        let manifest: ExtensionManifest = serde_json::from_slice(manifest_bytes)
            .map_err(|e| format!("Invalid extension manifest: {e}"))?;
        self.validate_manifest(&manifest)?;
        validate_declarative_documents(&files, &manifest)?;
        let wasm_paths = files
            .keys()
            .filter(|path| path.starts_with("wasm/"))
            .collect::<Vec<_>>();
        if let Some(ExtensionRuntime::Wasm { module }) = &manifest.runtime {
            if wasm_paths.len() != 1 || wasm_paths[0].as_str() != module {
                return Err(
                    "API v2 packages must contain exactly the declared WebAssembly module".into(),
                );
            }
            let module_bytes = files
                .get(module)
                .ok_or_else(|| format!("Extension WebAssembly module {module} is missing"))?;
            wasm_runtime::validate_module(module_bytes)?;
        } else if !wasm_paths.is_empty() {
            return Err("Declarative v1 packages cannot contain WebAssembly modules".into());
        }

        Ok(ValidatedPackage {
            manifest,
            files,
            package_digest,
            signing_key_id: signature.key_id,
            expanded_bytes,
        })
    }

    fn validate_installed_dir(
        &self,
        version_dir: &Path,
    ) -> Result<(ExtensionManifest, String), String> {
        let index_bytes = fs::read(version_dir.join("META-INF/files.json"))
            .map_err(|e| format!("Installed extension is missing its file index: {e}"))?;
        let signature_bytes = fs::read(version_dir.join("META-INF/signature.ed25519"))
            .map_err(|e| format!("Installed extension is missing its signature: {e}"))?;
        let signature: SignatureEnvelope = serde_json::from_slice(&signature_bytes)
            .map_err(|e| format!("Invalid installed extension signature: {e}"))?;
        self.verify_signature(&signature.key_id, &signature.signature, &index_bytes)?;
        let index: FileIndex = serde_json::from_slice(&index_bytes)
            .map_err(|e| format!("Invalid installed extension file index: {e}"))?;
        if index.files.len() > MAX_FILES {
            return Err("Installed extension file index exceeds the file limit".into());
        }
        let mut indexed_paths = BTreeSet::new();
        for entry in &index.files {
            validate_package_path(&entry.path)?;
            if !indexed_paths.insert(entry.path.as_str()) {
                return Err("Installed extension file index contains duplicates".into());
            }
            let path = safe_join(version_dir, &entry.path)?;
            let metadata = fs::symlink_metadata(&path)
                .map_err(|e| format!("Installed extension file {} is missing: {e}", entry.path))?;
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.len() != entry.size
            {
                return Err(format!(
                    "Installed extension file {} has invalid metadata",
                    entry.path
                ));
            }
            let bytes = fs::read(&path).map_err(|e| {
                format!(
                    "Failed to verify installed extension file {}: {e}",
                    entry.path
                )
            })?;
            if hex::encode(Sha256::digest(&bytes)) != entry.sha256.to_ascii_lowercase() {
                return Err(format!(
                    "Installed extension file {} failed integrity verification",
                    entry.path
                ));
            }
        }
        let manifest = read_manifest(version_dir)?;
        self.validate_manifest(&manifest)?;
        Ok((manifest, signature.key_id))
    }

    fn validate_manifest(&self, manifest: &ExtensionManifest) -> Result<(), String> {
        match manifest.schema_version {
            1 if manifest.runtime.is_none() && manifest.host_api.starts_with('1') => {}
            2 if manifest.host_api == WASM_HOST_API_VERSION => {
                match &manifest.runtime {
                    Some(ExtensionRuntime::Wasm { module }) => {
                        validate_package_path(module)?;
                        if !module.starts_with("wasm/") || !module.ends_with(".wasm") {
                            return Err("WebAssembly modules must be stored under wasm/ with a .wasm extension".into());
                        }
                    }
                    None => return Err("API v2 extensions must declare a runtime".into()),
                }
            }
            1 => {
                return Err(
                    "Declarative v1 extensions must use a v1 host API and cannot declare a runtime"
                        .into(),
                );
            }
            2 => {
                return Err(format!(
                    "API v2 extensions must declare host_api {WASM_HOST_API_VERSION}"
                ));
            }
            version => {
                return Err(format!("Unsupported extension manifest schema {version}"));
            }
        }
        validate_extension_id(&manifest.id)?;
        if manifest.name.trim().is_empty() || manifest.publisher.trim().is_empty() {
            return Err("Extension name and publisher are required".into());
        }
        Version::parse(&manifest.version).map_err(|e| format!("Invalid extension version: {e}"))?;
        let minimum = Version::parse(&manifest.min_client_version)
            .map_err(|e| format!("Invalid minimum client version: {e}"))?;
        if self.client_version < minimum {
            return Err(format!(
                "Extension requires client version {minimum} or newer"
            ));
        }
        let current_platform = current_platform();
        if !manifest.platforms.is_empty()
            && !manifest.platforms.iter().any(|p| p == current_platform)
        {
            return Err(format!("Extension does not support {current_platform}"));
        }
        let mut capabilities = BTreeSet::new();
        for capability in &manifest.requested_capabilities {
            if !ALLOWED_CAPABILITIES.contains(&capability.as_str()) {
                return Err(format!("Unsupported extension capability {capability}"));
            }
            if !capabilities.insert(capability) {
                return Err(format!("Duplicate extension capability {capability}"));
            }
        }
        for trigger in &manifest.background_triggers {
            match trigger {
                BackgroundTrigger::Interval { minutes, .. } if *minutes < 15 => {
                    return Err("Extension interval triggers must be at least 15 minutes".into());
                }
                BackgroundTrigger::Event { event, .. }
                    if !matches!(event.as_str(), "connection.changed" | "tasks.changed") =>
                {
                    return Err(format!("Unsupported extension event trigger {event}"));
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn verify_signature(
        &self,
        key_id: &str,
        signature_hex: &str,
        bytes: &[u8],
    ) -> Result<(), String> {
        let key = self
            .trusted_keys
            .get(key_id)
            .ok_or_else(|| format!("Unknown extension signing key {key_id}"))?;
        let signature_bytes = decode_fixed_hex::<64>(signature_hex, "Ed25519 signature")?;
        key.verify(bytes, &Signature::from_bytes(&signature_bytes))
            .map_err(|_| "Extension signature verification failed".to_string())
    }

    fn package_dir(&self, extension_id: &str, version: &str) -> Result<PathBuf, String> {
        validate_extension_id(extension_id)?;
        Version::parse(version).map_err(|e| format!("Invalid extension version path: {e}"))?;
        let base = self.root.join("packages");
        let path = base.join(extension_id).join(version);
        ensure_within(&path, &base)?;
        Ok(path)
    }
}

fn bundled_installations() -> Vec<ExtensionInstallation> {
    vec![ExtensionInstallation {
        manifest: ExtensionManifest {
            schema_version: 1,
            id: "org.cfms.bundled.file-stats".into(),
            name: "File statistics".into(),
            description: "Optional read-only file statistics and account context tools.".into(),
            publisher: "CFMS".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            host_api: "1.x".into(),
            min_client_version: env!("CARGO_PKG_VERSION").into(),
            platforms: vec![current_platform().into()],
            entrypoints: ExtensionEntrypoints {
                navigation: vec![ExtensionNavigationEntry {
                    id: "overview".into(),
                    label: "File statistics".into(),
                    icon: "extensions".into(),
                    page: "overview".into(),
                }],
                settings: Vec::new(),
                workflows: vec![ExtensionWorkflowEntry {
                    id: "account-check".into(),
                    label: "Check account context".into(),
                    workflow: "account-check".into(),
                }],
            },
            requested_capabilities: vec!["account.summary.read".into()],
            background_triggers: Vec::new(),
            content_hashes: BTreeMap::new(),
            runtime: None,
        },
        package_digest: "bundled".into(),
        signing_key_id: None,
        install_epoch: format!("bundled:{}", env!("CARGO_PKG_VERSION")),
        state: "bundled".into(),
        installed_at: 0,
        previous_version: None,
        last_error: None,
        disk_bytes: 0,
    }]
}

fn compiled_trusted_keys() -> BTreeMap<String, VerifyingKey> {
    let mut keys = BTreeMap::new();
    if let Some(raw) = option_env!("CFMS_EXTENSION_TRUSTED_KEYS") {
        for entry in raw.split(',').filter(|entry| !entry.trim().is_empty()) {
            let Some((id, hex_key)) = entry.split_once(':') else {
                continue;
            };
            if let Ok(bytes) = decode_fixed_hex::<32>(hex_key.trim(), "Ed25519 public key")
                && let Ok(key) = VerifyingKey::from_bytes(&bytes)
            {
                keys.insert(id.trim().to_string(), key);
            }
        }
    }
    keys
}

fn validate_extension_page_styles(page: &serde_json::Value) -> Result<(), String> {
    let blocks = page
        .get("blocks")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "Extension page blocks must be an array".to_string())?;
    let mut plugin_classes = BTreeSet::new();
    let mut css_rules = Vec::new();
    let mut css_source_bytes = 0;
    for (index, block) in blocks.iter().enumerate() {
        let label = format!("Extension page blocks[{index}]");
        let is_css_block = block.get("type").and_then(serde_json::Value::as_str) == Some("css");
        if !is_css_block {
            collect_extension_class_names(block.get("class_name"), &label, &mut plugin_classes)?;
        }
        if let Some(fields) = block.get("fields").and_then(serde_json::Value::as_array) {
            for (field_index, field) in fields.iter().enumerate() {
                collect_extension_class_names(
                    field.get("class_name"),
                    &format!("{label}.fields[{field_index}]"),
                    &mut plugin_classes,
                )?;
            }
        }
        if let Some(actions) = block.get("actions").and_then(serde_json::Value::as_array) {
            for (action_index, action) in actions.iter().enumerate() {
                collect_extension_class_names(
                    action.get("class_name"),
                    &format!("{label}.actions[{action_index}]"),
                    &mut plugin_classes,
                )?;
            }
        }
        if is_css_block {
            let css = block
                .get("css")
                .and_then(serde_json::Value::as_str)
                .filter(|css| !css.trim().is_empty())
                .ok_or_else(|| format!("{label}.css must be non-empty CSS text"))?;
            css_source_bytes += css.len();
            if css_source_bytes > MAX_PAGE_STYLES_BYTES {
                return Err("Extension page styles exceed the 16 KiB limit".into());
            }
            css_rules.extend(parse_extension_css_block(css, &label)?);
        }
    }

    let mut rules = match page.get("styles") {
        Some(styles) => styles
            .as_array()
            .cloned()
            .ok_or_else(|| "Extension page styles must be an array".to_string())?,
        None => Vec::new(),
    };
    rules.extend(css_rules);
    if rules.is_empty() && css_source_bytes == 0 {
        return Ok(());
    }
    if rules.len() > MAX_PAGE_STYLE_RULES {
        return Err(format!(
            "Extension page styles exceed the {MAX_PAGE_STYLE_RULES} rule limit"
        ));
    }
    if serde_json::to_vec(&rules)
        .map_err(|error| format!("Failed to encode extension page styles: {error}"))?
        .len()
        + css_source_bytes
        > MAX_PAGE_STYLES_BYTES
    {
        return Err("Extension page styles exceed the 16 KiB limit".into());
    }

    for (index, rule) in rules.iter().enumerate() {
        let label = format!("Extension page styles[{index}]");
        let selector = rule
            .get("selector")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| format!("{label}.selector must be a string"))?;
        if selector.len() > 256 || !validate_extension_style_selector(selector, &plugin_classes) {
            return Err(format!("{label} has an unsupported selector"));
        }
        if let Some(media) = rule.get("media") {
            let media = media
                .as_str()
                .ok_or_else(|| format!("{label}.media must be a string"))?;
            if !validate_extension_style_media(media) {
                return Err(format!("{label} has an unsupported media condition"));
            }
        }
        let declarations = rule
            .get("declarations")
            .and_then(serde_json::Value::as_object)
            .ok_or_else(|| format!("{label}.declarations must be an object"))?;
        if declarations.is_empty() || declarations.len() > MAX_PAGE_STYLE_DECLARATIONS {
            return Err(format!(
                "{label} must contain between 1 and {MAX_PAGE_STYLE_DECLARATIONS} declarations"
            ));
        }
        for (property, value) in declarations {
            let value = value
                .as_str()
                .ok_or_else(|| format!("{label}.{property} must be a string"))?;
            if !validate_extension_style_declaration(property, value) {
                return Err(format!(
                    "{label}.{property} contains a disallowed CSS property or value"
                ));
            }
        }
    }
    Ok(())
}

fn parse_extension_css_block(css: &str, label: &str) -> Result<Vec<serde_json::Value>, String> {
    if css.len() > MAX_PAGE_STYLES_BYTES {
        return Err(format!("{label}.css exceeds the 16 KiB limit"));
    }
    if css.contains("/*") || css.contains("*/") {
        return Err(format!("{label}.css does not allow comments"));
    }

    fn parse_rules(
        css: &str,
        cursor: &mut usize,
        media: Option<&str>,
        rules: &mut Vec<serde_json::Value>,
        label: &str,
    ) -> Result<(), String> {
        let bytes = css.as_bytes();
        while *cursor < bytes.len() {
            while bytes
                .get(*cursor)
                .is_some_and(|byte| byte.is_ascii_whitespace())
            {
                *cursor += 1;
            }
            if bytes.get(*cursor) == Some(&b'}') {
                if media.is_none() {
                    return Err(format!("{label}.css contains an unexpected closing brace"));
                }
                *cursor += 1;
                return Ok(());
            }
            if *cursor >= bytes.len() {
                break;
            }

            let open = css[*cursor..]
                .find('{')
                .map(|offset| *cursor + offset)
                .ok_or_else(|| format!("{label}.css contains an incomplete rule"))?;
            let header = css[*cursor..open].trim();
            *cursor = open + 1;
            if let Some(condition) = header.strip_prefix("@media") {
                let condition = condition.trim();
                if media.is_some() || !validate_extension_style_media(condition) {
                    return Err(format!("{label}.css has an unsupported media rule"));
                }
                parse_rules(css, cursor, Some(condition), rules, label)?;
                continue;
            }

            let close = css[*cursor..]
                .find('}')
                .map(|offset| *cursor + offset)
                .ok_or_else(|| format!("{label}.css contains an invalid declaration block"))?;
            if css[*cursor..close].contains('{') {
                return Err(format!("{label}.css contains an invalid declaration block"));
            }

            let mut declarations = serde_json::Map::new();
            for declaration in css[*cursor..close].split(';') {
                let declaration = declaration.trim();
                if declaration.is_empty() {
                    continue;
                }
                let (property, value) = declaration
                    .split_once(':')
                    .ok_or_else(|| format!("{label}.css contains an invalid declaration"))?;
                let property = property.trim();
                if declarations.contains_key(property) {
                    return Err(format!("{label}.css contains a duplicate CSS property"));
                }
                declarations.insert(
                    property.to_string(),
                    serde_json::Value::String(value.trim().to_string()),
                );
            }
            let mut rule = serde_json::Map::new();
            rule.insert(
                "selector".into(),
                serde_json::Value::String(header.to_string()),
            );
            if let Some(media) = media {
                rule.insert("media".into(), serde_json::Value::String(media.to_string()));
            }
            rule.insert(
                "declarations".into(),
                serde_json::Value::Object(declarations),
            );
            rules.push(serde_json::Value::Object(rule));
            if rules.len() > MAX_PAGE_STYLE_RULES {
                return Err(format!(
                    "{label}.css exceeds the {MAX_PAGE_STYLE_RULES} rule limit"
                ));
            }
            *cursor = close + 1;
        }
        if media.is_some() {
            return Err(format!("{label}.css contains an unclosed media rule"));
        }
        Ok(())
    }

    let mut rules = Vec::new();
    let mut cursor = 0;
    parse_rules(css, &mut cursor, None, &mut rules, label)?;
    if rules.is_empty() {
        return Err(format!("{label}.css must contain at least one style rule"));
    }
    Ok(rules)
}

fn validate_extension_page_controls(page: &serde_json::Value) -> Result<(), String> {
    let blocks = page
        .get("blocks")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "Extension page blocks must be an array".to_string())?;
    let mut tab_groups = BTreeMap::<String, BTreeSet<String>>::new();
    let mut forms = BTreeMap::<String, BTreeSet<String>>::new();
    let mut tables = BTreeSet::<String>::new();
    let mut results = BTreeSet::new();

    for (index, block) in blocks.iter().enumerate() {
        let label = format!("Extension page blocks[{index}]");
        match block.get("type").and_then(serde_json::Value::as_str) {
            Some("tabs") => {
                if tab_groups.len() > 0 {
                    return Err("Extension pages support at most one tabs group".into());
                }
                let id = block
                    .get("id")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| format!("{label}.id must be a string"))?;
                validate_entry_id(id)?;
                if block
                    .get("label")
                    .and_then(serde_json::Value::as_str)
                    .is_none_or(str::is_empty)
                {
                    return Err(format!("{label}.label must be a non-empty string"));
                }
                let tabs = block
                    .get("tabs")
                    .and_then(serde_json::Value::as_array)
                    .filter(|tabs| !tabs.is_empty())
                    .ok_or_else(|| format!("{label}.tabs must be a non-empty array"))?;
                let mut tab_ids = BTreeSet::new();
                for (tab_index, tab) in tabs.iter().enumerate() {
                    let tab_label = format!("{label}.tabs[{tab_index}]");
                    let tab_id = tab
                        .get("id")
                        .and_then(serde_json::Value::as_str)
                        .ok_or_else(|| format!("{tab_label}.id must be a string"))?;
                    validate_entry_id(tab_id)?;
                    if tab
                        .get("label")
                        .and_then(serde_json::Value::as_str)
                        .is_none_or(str::is_empty)
                    {
                        return Err(format!("{tab_label}.label must be a non-empty string"));
                    }
                    if !tab_ids.insert(tab_id.to_string()) {
                        return Err(format!("{tab_label}.id is duplicated"));
                    }
                }
                if block
                    .get("default_tab")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|default_tab| !tab_ids.contains(default_tab))
                {
                    return Err(format!("{label}.default_tab is not a declared tab"));
                }
                tab_groups.insert(id.to_string(), tab_ids);
            }
            Some("table") => validate_extension_page_table(block, &label, &mut tables)?,
            Some("form") => {
                let id = block
                    .get("id")
                    .and_then(serde_json::Value::as_str)
                    .filter(|id| !id.is_empty())
                    .ok_or_else(|| format!("{label}.id must be a non-empty string"))?;
                let fields = block
                    .get("fields")
                    .and_then(serde_json::Value::as_array)
                    .ok_or_else(|| format!("{label}.fields must be an array"))?;
                let mut field_ids = BTreeSet::new();
                for (field_index, field) in fields.iter().enumerate() {
                    let field_label = format!("{label}.fields[{field_index}]");
                    let field_id = field
                        .get("id")
                        .and_then(serde_json::Value::as_str)
                        .filter(|field_id| !field_id.is_empty())
                        .ok_or_else(|| format!("{field_label}.id must be a non-empty string"))?;
                    let field_type = field
                        .get("type")
                        .and_then(serde_json::Value::as_str)
                        .ok_or_else(|| format!("{field_label}.type must be a string"))?;
                    if !matches!(
                        field_type,
                        "text" | "textarea" | "digit" | "number" | "toggle" | "select"
                    ) {
                        return Err(format!("{field_label}.type is unsupported"));
                    }
                    if !field_ids.insert(field_id.to_string()) {
                        return Err(format!("{field_label}.id is duplicated"));
                    }
                }
                if forms.insert(id.to_string(), field_ids).is_some() {
                    return Err(format!("{label}.id is duplicated"));
                }
            }
            Some("result") => {
                let id = block
                    .get("id")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| format!("{label}.id must be a string"))?;
                validate_entry_id(id)?;
                if block
                    .get("label")
                    .and_then(serde_json::Value::as_str)
                    .is_none_or(str::is_empty)
                {
                    return Err(format!("{label} requires label"));
                }
                if let Some(copy_label) = block.get("copy_label")
                    && copy_label.as_str().is_none_or(str::is_empty)
                {
                    return Err(format!("{label}.copy_label must be a non-empty string"));
                }
                if let Some(variant) = block.get("variant")
                    && !matches!(variant.as_str(), Some("textarea" | "banner"))
                {
                    return Err(format!("{label}.variant must be textarea or banner"));
                }
                if !results.insert(id.to_string()) {
                    return Err(format!("{label}.id is duplicated"));
                }
            }
            Some("actions") => {
                let actions = block
                    .get("actions")
                    .and_then(serde_json::Value::as_array)
                    .ok_or_else(|| format!("{label}.actions must be an array"))?;
                for (action_index, action) in actions.iter().enumerate() {
                    let action_label = format!("{label}.actions[{action_index}]");
                    let kind = action
                        .get("kind")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("workflow");
                    match kind {
                        "workflow" => {
                            if action
                                .get("workflow")
                                .and_then(serde_json::Value::as_str)
                                .is_none_or(str::is_empty)
                            {
                                return Err(format!("{action_label}.workflow must be a string"));
                            }
                        }
                        "clear" => {
                            if action
                                .get("form_id")
                                .and_then(serde_json::Value::as_str)
                                .is_none_or(str::is_empty)
                                || action
                                    .get("field_ids")
                                    .and_then(serde_json::Value::as_array)
                                    .is_none_or(Vec::is_empty)
                            {
                                return Err(format!(
                                    "{action_label} requires form_id and field_ids"
                                ));
                            }
                        }
                        "copy" => {
                            if action
                                .get("result_id")
                                .and_then(serde_json::Value::as_str)
                                .is_none_or(str::is_empty)
                            {
                                return Err(format!("{action_label} requires result_id"));
                            }
                        }
                        _ => return Err(format!("{action_label}.kind is unsupported")),
                    }
                }
            }
            _ => {}
        }
    }

    for (index, block) in blocks.iter().enumerate() {
        let label = format!("Extension page blocks[{index}]");
        if let Some(tab) = block.get("tab") {
            let group = tab
                .get("group")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| format!("{label}.tab.group must be a string"))?;
            let tab_id = tab
                .get("id")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| format!("{label}.tab.id must be a string"))?;
            if !tab_groups
                .get(group)
                .is_some_and(|declared_tabs| declared_tabs.contains(tab_id))
            {
                return Err(format!("{label}.tab references an undeclared tab"));
            }
        }
        if block.get("type").and_then(serde_json::Value::as_str) != Some("actions") {
            continue;
        }
        if let Some(actions) = block.get("actions").and_then(serde_json::Value::as_array) {
            for (action_index, action) in actions.iter().enumerate() {
                let action_label = format!("{label}.actions[{action_index}]");
                if let Some(result_id) = action.get("result_id") {
                    let result_id = result_id.as_str().ok_or_else(|| {
                        format!("{action_label}.result_id must be a string")
                    })?;
                    if !results.contains(result_id) {
                        return Err(format!(
                            "{action_label}.result_id references an undeclared result"
                        ));
                    }
                }
                if action.get("kind").and_then(serde_json::Value::as_str) == Some("clear") {
                    let form_id = action["form_id"].as_str().unwrap_or_default();
                    let field_ids = action["field_ids"].as_array().ok_or_else(|| {
                        format!("{action_label}.field_ids must be an array")
                    })?;
                    let declared_fields = forms.get(form_id).ok_or_else(|| {
                        format!("{action_label} references an undeclared form")
                    })?;
                    for field_id in field_ids {
                        let field_id = field_id.as_str().ok_or_else(|| {
                            format!("{action_label}.field_ids must contain strings")
                        })?;
                        if !declared_fields.contains(field_id) {
                            return Err(format!(
                                "{action_label} references an undeclared form field"
                            ));
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

fn validate_extension_page_table(
    block: &serde_json::Value,
    label: &str,
    table_ids: &mut BTreeSet<String>,
) -> Result<(), String> {
    if let Some(value) = block.get("horizontal_scroll") {
        if !value.is_boolean() {
            return Err(format!("{label}.horizontal_scroll must be a boolean"));
        }
    }
    let editable = match block.get("editable") {
        Some(value) => value
            .as_bool()
            .ok_or_else(|| format!("{label}.editable must be a boolean"))?,
        None => false,
    };
    let id = block
        .get("id")
        .map(|value| {
            value
                .as_str()
                .filter(|id| !id.is_empty())
                .ok_or_else(|| format!("{label}.id must be a non-empty string"))
        })
        .transpose()?;
    if editable && id.is_none() {
        return Err(format!("{label}.id is required for editable tables"));
    }
    if let Some(id) = id {
        if matches!(id, "__proto__" | "constructor" | "prototype") {
            return Err(format!("{label}.id is a reserved table identifier"));
        }
        if editable {
            validate_entry_id(id)?;
        }
        if !table_ids.insert(id.to_string()) {
            return Err(format!("{label}.id is duplicated"));
        }
    }
    if !editable {
        return Ok(());
    }
    let columns = block
        .get("columns")
        .and_then(serde_json::Value::as_array)
        .filter(|columns| !columns.is_empty() && columns.len() <= MAX_EXTENSION_TABLE_COLUMNS)
        .ok_or_else(|| {
            format!(
                "{label}.columns must contain between 1 and {MAX_EXTENSION_TABLE_COLUMNS} columns"
            )
        })?;
    let rows = block
        .get("rows")
        .and_then(serde_json::Value::as_array)
        .filter(|rows| rows.len() <= MAX_EXTENSION_TABLE_ROWS)
        .ok_or_else(|| {
            format!("{label}.rows must contain at most {MAX_EXTENSION_TABLE_ROWS} rows")
        })?;

    let mut column_types = BTreeMap::<String, (String, BTreeSet<String>)>::new();
    for (column_index, column) in columns.iter().enumerate() {
        let column_label = format!("{label}.columns[{column_index}]");
        let key = column
            .get("key")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| format!("{column_label}.key must be a string"))?;
        validate_entry_id(key)?;
        if column
            .get("label")
            .and_then(serde_json::Value::as_str)
            .is_none_or(str::is_empty)
        {
            return Err(format!("{column_label}.label must be a non-empty string"));
        }
        let column_type = column
            .get("type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("text")
            .to_string();
        if !matches!(
            column_type.as_str(),
            "text" | "number" | "select" | "checkbox"
        ) {
            return Err(format!("{column_label}.type is unsupported"));
        }
        let mut options = BTreeSet::new();
        if column_type == "select" {
            let values = column
                .get("options")
                .and_then(serde_json::Value::as_array)
                .filter(|values| !values.is_empty() && values.len() <= 64)
                .ok_or_else(|| {
                    format!("{column_label}.options must contain between 1 and 64 options")
                })?;
            for option in values {
                let option = option
                    .as_str()
                    .filter(|option| !option.is_empty())
                    .ok_or_else(|| {
                        format!("{column_label}.options must contain non-empty strings")
                    })?;
                if !options.insert(option.to_string()) {
                    return Err(format!("{column_label}.options must be unique"));
                }
            }
        } else if column.get("options").is_some() {
            return Err(format!(
                "{column_label}.options is only supported for select columns"
            ));
        }
        if column_types
            .insert(key.to_string(), (column_type, options))
            .is_some()
        {
            return Err(format!("{column_label}.key is duplicated"));
        }
    }

    for (row_index, row) in rows.iter().enumerate() {
        let row = row
            .as_object()
            .ok_or_else(|| format!("{label}.rows[{row_index}] must be an object"))?;
        for key in row.keys() {
            if !column_types.contains_key(key) {
                return Err(format!(
                    "{label}.rows[{row_index}] has undeclared column {key}"
                ));
            }
        }
        for (key, value) in row {
            let (column_type, options) = &column_types[key];
            let valid = match column_type.as_str() {
                "checkbox" => value.is_boolean(),
                "number" => {
                    value.as_f64().is_some_and(f64::is_finite) || value.as_str() == Some("")
                }
                "select" => value.as_str().is_some_and(|value| options.contains(value)),
                _ => value.is_string(),
            };
            if !valid {
                return Err(format!(
                    "{label}.rows[{row_index}].{key} has an invalid value for {column_type}"
                ));
            }
        }
    }
    if serde_json::to_vec(rows)
        .map_err(|error| format!("{label}.rows could not be serialized: {error}"))?
        .len()
        > MAX_EXTENSION_TABLE_BYTES
    {
        return Err(format!("{label}.rows exceeds the 64 KiB table data limit"));
    }
    Ok(())
}

fn collect_extension_class_names(
    value: Option<&serde_json::Value>,
    label: &str,
    output: &mut BTreeSet<String>,
) -> Result<(), String> {
    let Some(value) = value else {
        return Ok(());
    };
    let value = value
        .as_str()
        .ok_or_else(|| format!("{label}.class_name must be a string"))?;
    if value.len() > 512 {
        return Err(format!("{label}.class_name is too long"));
    }
    let classes = value.split_whitespace().collect::<Vec<_>>();
    if classes.is_empty() || classes.len() > 8 {
        return Err(format!(
            "{label}.class_name must contain up to eight plugin-* class names"
        ));
    }
    let mut unique = BTreeSet::new();
    for class_name in classes {
        if !is_extension_plugin_class_name(class_name) || !unique.insert(class_name) {
            return Err(format!(
                "{label}.class_name must contain unique plugin-* class names"
            ));
        }
        output.insert(class_name.to_string());
    }
    Ok(())
}

fn is_extension_plugin_class_name(value: &str) -> bool {
    let Some(suffix) = value.strip_prefix("plugin-") else {
        return false;
    };
    value.len() <= 62
        && suffix
            .chars()
            .next()
            .is_some_and(|first| first.is_ascii_lowercase())
        && suffix
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(&byte))
}

fn is_extension_host_style_class(value: &str) -> bool {
    matches!(
        value,
        "extension-page"
            | "extension-page-header"
            | "extension-page-title"
            | "extension-page-description"
            | "extension-grid"
            | "extension-block"
            | "extension-block--text"
            | "extension-block--status_card"
            | "extension-block--alert"
            | "extension-block--progress"
            | "extension-block--list"
            | "extension-block--table"
            | "extension-block--empty_state"
            | "extension-block--form"
            | "extension-block--actions"
            | "extension-tab"
            | "extension-tab-list"
            | "extension-tab--active"
            | "extension-card"
            | "extension-wide"
            | "extension-form-field"
            | "extension-form-label"
            | "extension-control"
            | "extension-actions"
            | "extension-button"
            | "extension-heading"
            | "extension-caption"
            | "extension-result-heading"
            | "extension-result-banner"
            | "extension-result-banner--success"
            | "extension-result-banner--danger"
            | "extension-block--result"
            | "tone-default"
            | "tone-info"
            | "tone-success"
            | "tone-warning"
            | "tone-danger"
            | "extension-muted"
            | "extension-error-message"
    )
}

fn validate_extension_style_selector(selector: &str, plugin_classes: &BTreeSet<String>) -> bool {
    let normalized = selector.replace('>', " > ");
    let mut seen_class = false;
    let mut pending_child = false;
    for token in normalized.split_whitespace() {
        if token == ">" {
            if !seen_class || pending_child {
                return false;
            }
            pending_child = true;
            continue;
        }
        let Some(class_selector) = token.strip_prefix('.') else {
            return false;
        };
        let (class_name, pseudo) = match class_selector.split_once(':') {
            Some((class_name, pseudo)) if !pseudo.contains(':') => (class_name, Some(pseudo)),
            Some(_) => return false,
            None => (class_selector, None),
        };
        if !is_extension_plugin_class_name(class_name) && !is_extension_host_style_class(class_name)
        {
            return false;
        }
        if pseudo.is_some_and(|value| {
            !matches!(
                value,
                "hover" | "focus" | "focus-visible" | "active" | "disabled" | "checked"
            )
        }) {
            return false;
        }
        if is_extension_plugin_class_name(class_name) && !plugin_classes.contains(class_name) {
            return false;
        }
        seen_class = true;
        pending_child = false;
    }
    seen_class && !pending_child
}

fn validate_extension_style_media(value: &str) -> bool {
    let Some(value) = value
        .strip_prefix('(')
        .and_then(|value| value.strip_suffix(')'))
    else {
        return false;
    };
    let Some((axis, width)) = value.split_once(':') else {
        return false;
    };
    if !matches!(axis.trim(), "max-width" | "min-width") {
        return false;
    }
    let width = width.trim();
    let Some(number) = ["px", "rem", "em"]
        .iter()
        .find_map(|unit| width.strip_suffix(unit))
    else {
        return false;
    };
    let mut pieces = number.split('.');
    let whole = pieces.next().unwrap_or_default();
    let fraction = pieces.next();
    whole.len() <= 4
        && !whole.is_empty()
        && whole.bytes().all(|byte| byte.is_ascii_digit())
        && fraction.is_none_or(|part| {
            !part.is_empty() && part.len() <= 2 && part.bytes().all(|byte| byte.is_ascii_digit())
        })
        && pieces.next().is_none()
        && number.parse::<f64>().is_ok_and(|value| value <= 4096.0)
}

fn validate_extension_style_declaration(property: &str, value: &str) -> bool {
    const PROPERTIES: &[&str] = &[
        "align-items",
        "background-color",
        "border",
        "border-color",
        "border-radius",
        "border-style",
        "border-width",
        "box-sizing",
        "color",
        "column-gap",
        "display",
        "flex",
        "flex-basis",
        "flex-direction",
        "flex-grow",
        "flex-shrink",
        "flex-wrap",
        "font-family",
        "font-size",
        "font-style",
        "font-weight",
        "gap",
        "grid-column",
        "grid-template-columns",
        "height",
        "justify-content",
        "letter-spacing",
        "line-height",
        "margin",
        "margin-block",
        "margin-inline",
        "max-height",
        "max-width",
        "min-height",
        "min-width",
        "overflow",
        "overflow-x",
        "overflow-y",
        "padding",
        "padding-block",
        "padding-inline",
        "resize",
        "row-gap",
        "text-align",
        "text-decoration",
        "text-overflow",
        "vertical-align",
        "white-space",
        "width",
    ];
    const SAFE_FUNCTIONS: &[&str] = &[
        "calc", "clamp", "hsl", "hsla", "max", "min", "minmax", "repeat", "rgb", "rgba", "var",
    ];
    if !PROPERTIES.contains(&property)
        || value.is_empty()
        || value.len() > 256
        || value.trim() != value
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"#(),.% _-/+".contains(&byte))
        || (property != "grid-column" && value.contains('/'))
    {
        return false;
    }

    let mut depth = 0_i32;
    for byte in value.bytes() {
        if byte == b'(' {
            depth += 1;
        } else if byte == b')' {
            depth -= 1;
            if depth < 0 {
                return false;
            }
        }
    }
    if depth != 0 {
        return false;
    }
    let bytes = value.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        if *byte != b'(' {
            continue;
        }
        let mut start = index;
        while start > 0 && (bytes[start - 1].is_ascii_alphabetic() || bytes[start - 1] == b'-') {
            start -= 1;
        }
        if start == index {
            return false;
        }
        let function = value[start..index].to_ascii_lowercase();
        if !SAFE_FUNCTIONS.contains(&function.as_str()) {
            return false;
        }
    }

    let lower = value.to_ascii_lowercase();
    let enum_values: Option<&[&str]> = match property {
        "align-items" => Some(&[
            "baseline",
            "center",
            "end",
            "flex-end",
            "flex-start",
            "normal",
            "start",
            "stretch",
        ]),
        "box-sizing" => Some(&["border-box", "content-box"]),
        "display" => Some(&[
            "block",
            "flex",
            "grid",
            "inline",
            "inline-flex",
            "inline-grid",
        ]),
        "flex-direction" => Some(&["column", "column-reverse", "row", "row-reverse"]),
        "flex-wrap" => Some(&["nowrap", "wrap", "wrap-reverse"]),
        "font-style" => Some(&["italic", "normal", "oblique"]),
        "font-weight" => Some(&[
            "bold", "normal", "100", "200", "300", "400", "500", "600", "700", "800", "900",
        ]),
        "justify-content" => Some(&[
            "center",
            "end",
            "flex-end",
            "flex-start",
            "left",
            "normal",
            "right",
            "space-around",
            "space-between",
            "space-evenly",
            "start",
            "stretch",
        ]),
        "overflow" | "overflow-x" | "overflow-y" => Some(&["auto", "scroll", "visible"]),
        "resize" => Some(&["both", "horizontal", "none", "vertical"]),
        "text-align" => Some(&["center", "end", "justify", "left", "right", "start"]),
        "text-decoration" => Some(&["line-through", "none", "overline", "underline"]),
        "text-overflow" => Some(&["clip", "ellipsis"]),
        "white-space" => Some(&["break-spaces", "normal", "nowrap", "pre-line", "pre-wrap"]),
        _ => None,
    };
    if enum_values.is_some_and(|allowed| !allowed.contains(&lower.as_str())) {
        return false;
    }
    if property == "grid-column" {
        let mut lines = value.split('/');
        let valid_line = |line: &str| {
            let line = line.trim();
            line == "auto"
                || line.strip_prefix("span ").is_some_and(|digits| {
                    !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
                })
                || {
                    let digits = line.strip_prefix('-').unwrap_or(line);
                    !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
                }
        };
        if !valid_line(lines.next().unwrap_or_default())
            || lines.next().is_some_and(|line| !valid_line(line))
            || lines.next().is_some()
        {
            return false;
        }
    }
    true
}

fn validate_file_index(files: &BTreeMap<String, Vec<u8>>, index: &FileIndex) -> Result<(), String> {
    let indexed_paths = index
        .files
        .iter()
        .map(|entry| entry.path.as_str())
        .collect::<BTreeSet<_>>();
    if indexed_paths.len() != index.files.len() {
        return Err("Extension file index contains duplicate paths".into());
    }
    let actual_paths = files
        .keys()
        .filter(|path| !path.starts_with("META-INF/"))
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if indexed_paths != actual_paths {
        return Err("Extension file index does not exactly match package contents".into());
    }
    for entry in &index.files {
        validate_package_path(&entry.path)?;
        validate_sha256(&entry.sha256)?;
        let contents = files
            .get(&entry.path)
            .ok_or_else(|| format!("Indexed extension file {} is missing", entry.path))?;
        if contents.len() as u64 != entry.size {
            return Err(format!(
                "Extension file {} has an unexpected size",
                entry.path
            ));
        }
        let actual = hex::encode(Sha256::digest(contents));
        if actual != entry.sha256.to_ascii_lowercase() {
            return Err(format!(
                "Extension file {} failed SHA-256 verification",
                entry.path
            ));
        }
    }
    Ok(())
}

fn validate_declarative_documents(
    files: &BTreeMap<String, Vec<u8>>,
    manifest: &ExtensionManifest,
) -> Result<(), String> {
    for entry in &manifest.entrypoints.navigation {
        validate_entry_id(&entry.id)?;
        validate_entry_id(&entry.page)?;
        if manifest.runtime.is_none() {
            ensure_json_object(files, &format!("pages/{}.json", entry.page))?;
        }
    }
    for entry in &manifest.entrypoints.settings {
        validate_entry_id(&entry.id)?;
        validate_entry_id(&entry.page)?;
        if manifest.runtime.is_none() {
            ensure_json_object(files, &format!("pages/{}.json", entry.page))?;
        }
    }
    for entry in &manifest.entrypoints.workflows {
        validate_entry_id(&entry.id)?;
        validate_entry_id(&entry.workflow)?;
        ensure_json_object(files, &format!("workflows/{}.json", entry.workflow))?;
    }
    for trigger in &manifest.background_triggers {
        let workflow = match trigger {
            BackgroundTrigger::OnEnable { workflow }
            | BackgroundTrigger::OnLogin { workflow }
            | BackgroundTrigger::Interval { workflow, .. }
            | BackgroundTrigger::Event { workflow, .. } => workflow,
        };
        validate_entry_id(workflow)?;
        ensure_json_object(files, &format!("workflows/{workflow}.json"))?;
    }
    Ok(())
}

fn ensure_json_object(files: &BTreeMap<String, Vec<u8>>, path: &str) -> Result<(), String> {
    let bytes = files
        .get(path)
        .ok_or_else(|| format!("Extension entrypoint {path} is missing"))?;
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|e| format!("Invalid declarative document {path}: {e}"))?;
    if !value.is_object() {
        return Err(format!("Declarative document {path} must be an object"));
    }
    Ok(())
}

fn validate_package_path(path: &str) -> Result<(), String> {
    let allowed = path == "manifest.json"
        || path == "META-INF/files.json"
        || path == "META-INF/signature.ed25519"
        || (path.starts_with("pages/") && path.ends_with(".json"))
        || (path.starts_with("workflows/") && path.ends_with(".json"))
        || (path.starts_with("wasm/") && path.ends_with(".wasm"))
        || (path.starts_with("i18n/") && path.ends_with(".json"))
        || (path.starts_with("assets/")
            && matches!(
                Path::new(path)
                    .extension()
                    .and_then(|v| v.to_str())
                    .map(str::to_ascii_lowercase)
                    .as_deref(),
                Some("png" | "jpg" | "jpeg" | "webp" | "gif" | "ico")
            ));
    if !allowed {
        return Err(format!("Extension package contains forbidden file {path}"));
    }
    Ok(())
}

fn validate_extension_id(value: &str) -> Result<(), String> {
    if value.len() < 3 || value.len() > 128 || !value.contains('.') {
        return Err("Extension id must be a reverse-domain identifier".into());
    }
    if !value.split('.').all(|part| {
        !part.is_empty()
            && part.len() <= 63
            && part
                .chars()
                .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
            && !part.starts_with('-')
            && !part.ends_with('-')
    }) {
        return Err("Extension id contains invalid characters".into());
    }
    Ok(())
}

fn validate_entry_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 64
        || !value
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' || ch == '_')
    {
        return Err(format!("Invalid extension entrypoint id {value}"));
    }
    Ok(())
}

fn normalized_relative_path(path: &Path) -> Result<String, String> {
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Extension package path must be relative and normalized".into());
    }
    Ok(path
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/"))
}

fn safe_join(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    let normalized = normalized_relative_path(relative_path)?;
    let target = base.join(normalized.replace('/', std::path::MAIN_SEPARATOR_STR));
    ensure_within(&target, base)?;
    Ok(target)
}

fn ensure_within(path: &Path, base: &Path) -> Result<(), String> {
    let path = absolute_lexical(path)?;
    let base = absolute_lexical(base)?;
    if !path.starts_with(&base) || path == base {
        return Err("Extension path escaped its storage root".into());
    }
    Ok(())
}

fn absolute_lexical(path: &Path) -> Result<PathBuf, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("Failed to resolve current directory: {e}"))?
            .join(path)
    };
    let mut result = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                result.push(component.as_os_str())
            }
            Component::CurDir => {}
            Component::ParentDir => {
                result.pop();
            }
        }
    }
    Ok(result)
}

fn read_manifest(version_dir: &Path) -> Result<ExtensionManifest, String> {
    let bytes = fs::read(version_dir.join("manifest.json"))
        .map_err(|e| format!("Failed to read installed extension manifest: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("Invalid installed extension manifest: {e}"))
}

fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            entry.metadata().ok().map_or(0, |metadata| {
                if metadata.is_dir() {
                    directory_size(&entry.path())
                } else {
                    metadata.len()
                }
            })
        })
        .sum()
}

fn validate_sha256(value: &str) -> Result<(), String> {
    validate_hex(value, 32, "SHA-256")
}

fn validate_hex(value: &str, byte_length: usize, label: &str) -> Result<(), String> {
    if value.len() != byte_length * 2 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("Invalid {label}"));
    }
    Ok(())
}

fn decode_fixed_hex<const N: usize>(value: &str, label: &str) -> Result<[u8; N], String> {
    validate_hex(value, N, label)?;
    let decoded = hex::decode(value).map_err(|_| format!("Invalid {label}"))?;
    decoded
        .try_into()
        .map_err(|_| format!("Invalid {label} length"))
}

fn random_hex(bytes: usize) -> String {
    let mut random = vec![0_u8; bytes];
    rand::rng().fill(&mut random[..]);
    hex::encode(random)
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn current_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(target_os = "android")]
    {
        "android"
    }
    #[cfg(target_os = "ios")]
    {
        "ios"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use rusqlite::Connection;
    use std::io::Write;

    #[test]
    fn extension_styles_are_scoped_and_reject_global_or_external_css() {
        let mut page = serde_json::json!({
            "schema_version": 1,
            "title": "Styled",
            "blocks": [{
                "type": "form",
                "class_name": "plugin-tool-form",
                "fields": [{
                    "id": "input",
                    "label": "Input",
                    "type": "text",
                    "class_name": "plugin-input"
                }]
            }],
            "styles": [{
                "selector": ".plugin-tool-form .extension-control",
                "media": "(max-width: 700px)",
                "declarations": {
                    "width": "100%",
                    "color": "var(--colorNeutralForeground1)"
                }
            }]
        });
        validate_extension_page_styles(&page).unwrap();

        page["styles"][0]["selector"] = serde_json::json!("body");
        assert!(validate_extension_page_styles(&page).is_err());
        page["styles"][0]["selector"] = serde_json::json!(".plugin-tool-form");
        page["styles"][0]["declarations"]["background-color"] =
            serde_json::json!("url(https://example.test/image.png)");
        assert!(validate_extension_page_styles(&page).is_err());
    }

    #[test]
    fn extension_css_blocks_are_parsed_and_validated_as_scoped_rules() {
        let mut page = serde_json::json!({
            "schema_version": 1,
            "title": "CSS blocks",
            "blocks": [
                { "type": "text", "text": "Ready", "class_name": "plugin-status" },
                {
                    "type": "css",
                    "css": ".plugin-status { color: red; }\n.extension-page-title { font-size: 28px; }\n.extension-form-label { font-weight: 600; }\n.extension-result-banner--success { color: var(--colorStatusSuccessForeground1); }\n@media (max-width: 700px) { .plugin-status { display: block; } }"
                }
            ]
        });
        validate_extension_page_styles(&page).unwrap();

        page["blocks"][1]["css"] = serde_json::json!("body { color: red; }");
        assert!(validate_extension_page_styles(&page).is_err());
        page["blocks"][1]["css"] =
            serde_json::json!(".plugin-status { background-color: url(https://example.test/a); }");
        assert!(validate_extension_page_styles(&page).is_err());
    }

    #[test]
    fn extension_tabs_results_and_clear_actions_require_declared_targets() {
        let mut page = serde_json::json!({
            "schema_version": 1,
            "title": "Tools",
            "blocks": [
                {
                    "type": "tabs",
                    "id": "tools",
                    "label": "Tools",
                    "default_tab": "matrix",
                    "tabs": [{ "id": "matrix", "label": "Matrix" }]
                },
                {
                    "type": "form",
                    "id": "cells",
                    "tab": { "group": "tools", "id": "matrix" },
                    "fields": [{ "id": "cell-0-0", "label": "Cell", "type": "digit" }]
                },
                {
                    "type": "actions",
                    "tab": { "group": "tools", "id": "matrix" },
                    "actions": [{
                        "id": "clear",
                        "label": "Clear",
                        "kind": "clear",
                        "form_id": "cells",
                        "field_ids": ["cell-0-0"],
                        "result_id": "output"
                    }]
                },
                {
                    "type": "result",
                    "id": "output",
                    "label": "Output",
                    "copy_label": "Copy"
                }
            ]
        });
        validate_extension_page_controls(&page).unwrap();

        page["blocks"][2]["actions"][0]["field_ids"][0] =
            serde_json::json!("undeclared");
        assert!(validate_extension_page_controls(&page).is_err());
        page["blocks"][2]["actions"][0]["field_ids"][0] =
            serde_json::json!("cell-0-0");
        page["blocks"][1]["tab"]["id"] = serde_json::json!("missing");
        assert!(validate_extension_page_controls(&page).is_err());
    }

    #[test]
    fn editable_extension_tables_validate_columns_values_and_limits() {
        let mut page = serde_json::json!({
            "schema_version": 1,
            "title": "Editable records",
            "blocks": [{
                "type": "table",
                "id": "records",
                "editable": true,
                "columns": [
                    { "key": "name", "label": "Name", "type": "text" },
                    { "key": "count", "label": "Count", "type": "number" },
                    { "key": "mode", "label": "Mode", "type": "select", "options": ["fast", "slow"] },
                    { "key": "enabled", "label": "Enabled", "type": "checkbox" }
                ],
                "rows": [{
                    "name": "First",
                    "count": 2,
                    "mode": "fast",
                    "enabled": true
                }]
            }]
        });
        validate_extension_page_controls(&page).unwrap();

        page["blocks"][0]["horizontal_scroll"] = serde_json::json!(false);
        validate_extension_page_controls(&page).unwrap();
        page["blocks"][0]["horizontal_scroll"] = serde_json::json!("false");
        assert!(validate_extension_page_controls(&page).is_err());
        page["blocks"][0]["horizontal_scroll"] = serde_json::json!(true);

        page["blocks"][0]["rows"][0]["enabled"] = serde_json::json!("yes");
        assert!(validate_extension_page_controls(&page).is_err());
        page["blocks"][0]["rows"][0]["enabled"] = serde_json::json!(true);

        page["blocks"][0]["rows"][0]["mode"] = serde_json::json!("unknown");
        assert!(validate_extension_page_controls(&page).is_err());
        page["blocks"][0]["rows"][0]["mode"] = serde_json::json!("fast");

        page["blocks"][0]["columns"][2]["options"] = serde_json::json!([]);
        assert!(validate_extension_page_controls(&page).is_err());
        page["blocks"][0]["columns"][2]["options"] = serde_json::json!(["fast", "slow"]);

        page["blocks"][0]["id"] = serde_json::Value::Null;
        assert!(validate_extension_page_controls(&page).is_err());

        page["blocks"][0]["id"] = serde_json::json!("records");
        page["blocks"].as_array_mut().unwrap().push(serde_json::json!({
            "type": "table",
            "id": "records",
            "columns": [],
            "rows": []
        }));
        assert!(validate_extension_page_controls(&page).is_err());

        page["blocks"].as_array_mut().unwrap().truncate(1);
        page["blocks"][0]["id"] = serde_json::json!("__proto__");
        assert!(validate_extension_page_controls(&page).is_err());

        let legacy_table = serde_json::json!({
            "schema_version": 1,
            "title": "Legacy table",
            "blocks": [{ "type": "table", "columns": [], "rows": [] }]
        });
        validate_extension_page_controls(&legacy_table).unwrap();
    }

    #[test]
    fn extension_result_variants_and_copy_actions_are_optional_and_validated() {
        let mut page = serde_json::json!({
            "schema_version": 1,
            "title": "Tools",
            "blocks": [
                {
                    "type": "actions",
                    "actions": [{
                        "id": "copy",
                        "label": "Copy",
                        "kind": "copy",
                        "result_id": "output"
                    }]
                },
                { "type": "result", "id": "output", "label": "Output", "variant": "banner" }
            ]
        });
        validate_extension_page_controls(&page).unwrap();

        page["blocks"][1]["copy_label"] = serde_json::json!("Copy");
        validate_extension_page_controls(&page).unwrap();
        page["blocks"][1]["copy_label"] = serde_json::json!("");
        assert!(validate_extension_page_controls(&page).is_err());

        page["blocks"][1]["copy_label"] = serde_json::json!("Copy");
        page["blocks"][1]["variant"] = serde_json::json!("textarea");
        validate_extension_page_controls(&page).unwrap();
        page["blocks"][1]["variant"] = serde_json::json!("panel");
        assert!(validate_extension_page_controls(&page).is_err());

        page["blocks"][1]["variant"] = serde_json::json!("banner");
        page["blocks"][0]["actions"][0]
            .as_object_mut()
            .unwrap()
            .remove("result_id");
        assert!(validate_extension_page_controls(&page).is_err());
    }

    fn store(temp: &tempfile::TempDir, signing: &SigningKey) -> ExtensionStore {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(crate::db::schema::SCHEMA_V1).unwrap();
        db.execute_batch(crate::db::schema::SCHEMA_V2).unwrap();
        ExtensionStore::with_key(
            SettingsStore::new(db),
            temp.path(),
            "1.0.0",
            "test",
            signing.verifying_key(),
        )
    }

    fn package(signing: &SigningKey, traversal: bool) -> Vec<u8> {
        package_version(signing, traversal, "1.0.0")
    }

    fn package_version(signing: &SigningKey, traversal: bool, version: &str) -> Vec<u8> {
        let manifest = serde_json::json!({
            "schema_version": 1,
            "id": "org.cfms.file-stats",
            "name": "File statistics",
            "description": "Read-only statistics",
            "publisher": "CFMS",
            "version": version,
            "host_api": "1.x",
            "min_client_version": "0.1.0",
            "platforms": [current_platform()],
            "entrypoints": { "navigation": [{ "id": "stats", "label": "Statistics", "icon": "analytics", "page": "stats" }] },
            "requested_capabilities": ["account.summary.read", "files.updates.check", "files.sync.full"],
            "background_triggers": [],
            "content_hashes": {}
        }).to_string().into_bytes();
        let page = br#"{"schema_version":1,"title":"Statistics","blocks":[]}"#.to_vec();
        let indexed = [("manifest.json", &manifest), ("pages/stats.json", &page)];
        let index =
            serde_json::json!({ "files": indexed.iter().map(|(path, bytes)| serde_json::json!({
            "path": path,
            "sha256": hex::encode(Sha256::digest(bytes)),
            "size": bytes.len()
        })).collect::<Vec<_>>() })
            .to_string()
            .into_bytes();
        let signature = signing.sign(&index);
        let envelope =
            serde_json::json!({ "key_id": "test", "signature": hex::encode(signature.to_bytes()) })
                .to_string()
                .into_bytes();

        let mut output = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut output);
            let options = zip::write::SimpleFileOptions::default();
            for (path, bytes) in indexed {
                zip.start_file(path, options).unwrap();
                zip.write_all(bytes).unwrap();
            }
            zip.start_file("META-INF/files.json", options).unwrap();
            zip.write_all(&index).unwrap();
            zip.start_file("META-INF/signature.ed25519", options)
                .unwrap();
            zip.write_all(&envelope).unwrap();
            if traversal {
                zip.start_file("../evil.json", options).unwrap();
                zip.write_all(b"{}").unwrap();
            }
            zip.finish().unwrap();
        }
        output.into_inner()
    }

    fn wasm_package(signing: &SigningKey) -> Vec<u8> {
        let page = br#"{"schema_version":1,"title":"WASM page","blocks":[]}"#;
        let output = page
            .iter()
            .map(|byte| format!("\\{byte:02x}"))
            .collect::<String>();
        let ptr = 4096_u64;
        let packed = (ptr << 32) | page.len() as u64;
        let module = wat::parse_str(format!(
            r#"(module
                (memory (export "memory") 1 4)
                (data (i32.const {ptr}) "{output}")
                (func (export "cfms_alloc") (param i32) (result i32) i32.const 16)
                (func (export "cfms_invoke") (param i32 i32) (result i64) i64.const {packed})
            )"#
        ))
        .unwrap();
        let manifest = serde_json::json!({
            "schema_version": 2,
            "id": "org.cfms.wasm-page",
            "name": "WASM page",
            "description": "A sandboxed WebAssembly page",
            "publisher": "CFMS",
            "version": "1.0.0",
            "host_api": WASM_HOST_API_VERSION,
            "min_client_version": "0.1.0",
            "platforms": [current_platform()],
            "entrypoints": { "navigation": [{ "id": "page", "label": "WASM page", "icon": "extensions", "page": "overview" }] },
            "requested_capabilities": [],
            "background_triggers": [],
            "content_hashes": {},
            "runtime": { "kind": "wasm", "module": "wasm/main.wasm" }
        })
        .to_string()
        .into_bytes();
        let indexed = [
            ("manifest.json", manifest.as_slice()),
            ("wasm/main.wasm", module.as_slice()),
        ];
        let index = serde_json::json!({
            "files": indexed.iter().map(|(path, bytes)| serde_json::json!({
                "path": path,
                "sha256": hex::encode(Sha256::digest(bytes)),
                "size": bytes.len()
            })).collect::<Vec<_>>()
        })
        .to_string()
        .into_bytes();
        let signature = signing.sign(&index);
        let envelope = serde_json::json!({
            "key_id": "test",
            "signature": hex::encode(signature.to_bytes())
        })
        .to_string()
        .into_bytes();
        let mut output = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut output);
            let options = zip::write::SimpleFileOptions::default();
            for (path, bytes) in indexed {
                zip.start_file(path, options).unwrap();
                zip.write_all(bytes).unwrap();
            }
            zip.start_file("META-INF/files.json", options).unwrap();
            zip.write_all(&index).unwrap();
            zip.start_file("META-INF/signature.ed25519", options)
                .unwrap();
            zip.write_all(&envelope).unwrap();
            zip.finish().unwrap();
        }
        output.into_inner()
    }

    #[test]
    fn signed_package_installs_and_lists() {
        let temp = tempfile::tempdir().unwrap();
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let store = store(&temp, &signing);
        let installed = store.install_package(&package(&signing, false)).unwrap();
        assert_eq!(installed.manifest.id, "org.cfms.file-stats");
        assert_eq!(installed.signing_key_id.as_deref(), Some("test"));
        assert_eq!(
            store
                .list_installed()
                .unwrap()
                .iter()
                .find(|item| item.manifest.id == "org.cfms.file-stats")
                .and_then(|item| item.signing_key_id.as_deref()),
            Some("test")
        );
        assert!(
            store
                .list_installed()
                .unwrap()
                .iter()
                .any(|item| item.manifest.id == "org.cfms.file-stats")
        );
        assert!(
            store
                .read_page("org.cfms.file-stats", "stats")
                .unwrap()
                .is_object()
        );
    }

    #[test]
    fn api_custom_v2_installs_and_renders_in_the_wasm_sandbox() {
        let temp = tempfile::tempdir().unwrap();
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let store = store(&temp, &signing);
        let installed = store.install_package(&wasm_package(&signing)).unwrap();
        assert_eq!(installed.manifest.host_api, WASM_HOST_API_VERSION);
        assert_eq!(
            store.read_page("org.cfms.wasm-page", "overview").unwrap()["title"],
            "WASM page"
        );
        assert_eq!(
            store
                .execute_module("org.cfms.wasm-page", serde_json::json!({ "answer": 42 }))
                .unwrap()["title"],
            "WASM page"
        );
        assert!(
            store
                .read_page("org.cfms.wasm-page", "not-declared")
                .is_err()
        );
    }

    #[test]
    fn api_custom_v2_requires_the_exact_host_api_marker() {
        let temp = tempfile::tempdir().unwrap();
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let store = store(&temp, &signing);
        let mut manifest: ExtensionManifest = serde_json::from_value(serde_json::json!({
            "schema_version": 2,
            "id": "org.cfms.v2",
            "name": "v2",
            "description": "test",
            "publisher": "CFMS",
            "version": "1.0.0",
            "host_api": "api-custom-v3",
            "min_client_version": "0.1.0",
            "runtime": { "kind": "wasm", "module": "wasm/main.wasm" }
        }))
        .unwrap();
        assert!(store.validate_manifest(&manifest).is_err());
        manifest.host_api = WASM_HOST_API_VERSION.into();
        assert!(store.validate_manifest(&manifest).is_ok());
    }

    #[test]
    fn catalog_install_requires_exact_manifest_and_signature_match() {
        let temp = tempfile::tempdir().unwrap();
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let store = store(&temp, &signing);
        let package = package(&signing, false);
        let validated = store.validate_package(&package).unwrap();
        let signature: SignatureEnvelope =
            serde_json::from_slice(validated.files.get("META-INF/signature.ed25519").unwrap())
                .unwrap();
        let mut entry = CatalogExtension {
            manifest: validated.manifest.clone(),
            download_url: "https://example.invalid/file-stats.cfmsext".into(),
            sha256: validated.package_digest.clone(),
            signature: signature.signature,
            key_id: signature.key_id,
            revoked: false,
            revocation_reason: None,
        };

        entry.manifest.name = "A mismatched catalog name".into();
        assert!(store.install_catalog_package(&package, &entry).is_err());
        assert!(
            store
                .get_installed("org.cfms.file-stats")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn wrong_signature_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let trusted = SigningKey::from_bytes(&[7_u8; 32]);
        let untrusted = SigningKey::from_bytes(&[8_u8; 32]);
        let store = store(&temp, &trusted);
        assert!(store.install_package(&package(&untrusted, false)).is_err());
    }

    #[test]
    fn traversal_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let store = store(&temp, &signing);
        assert!(store.install_package(&package(&signing, true)).is_err());
        assert!(!temp.path().join("evil.json").exists());
    }

    #[test]
    fn installed_file_tampering_is_detected() {
        let temp = tempfile::tempdir().unwrap();
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let store = store(&temp, &signing);
        store.install_package(&package(&signing, false)).unwrap();
        fs::write(
            temp.path()
                .join("extensions/packages/org.cfms.file-stats/1.0.0/pages/stats.json"),
            b"{}",
        )
        .unwrap();
        assert!(store.list_installed().is_err());
    }

    #[test]
    fn rollback_restores_previous_version_and_digest() {
        let temp = tempfile::tempdir().unwrap();
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let store = store(&temp, &signing);
        let version_one = package_version(&signing, false, "1.0.0");
        let version_one_digest = hex::encode(Sha256::digest(&version_one));
        store.install_package(&version_one).unwrap();
        store
            .install_package(&package_version(&signing, false, "1.1.0"))
            .unwrap();

        let rolled_back = store.rollback("org.cfms.file-stats").unwrap();
        assert_eq!(rolled_back.manifest.version, "1.0.0");
        assert_eq!(rolled_back.package_digest, version_one_digest);
    }
}
