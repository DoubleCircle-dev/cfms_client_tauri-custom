use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rand::RngExt;
use serde::{Deserialize, Serialize};
use sha2::Digest;

const MAX_SCHEDULES_PER_EXTENSION: usize = 32;
const MAX_NAME_CHARS: usize = 64;
const MAX_SCHEDULE_FILE_BYTES: u64 = 256 * 1024;

static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleKind {
    Interval,
    FixedTime,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleScope {
    All,
    Folder,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleAction {
    Check,
    Update,
    Scan,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleUpdatePolicy {
    DownloadOnly,
    Mirror,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleNotify {
    ProblemsOnly,
    Always,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ScheduleTaskInput {
    pub name: String,
    pub kind: ScheduleKind,
    pub interval_minutes: Option<u32>,
    pub time_of_day: Option<String>,
    #[serde(default = "every_day")]
    pub days: Vec<u8>,
    pub scope: ScheduleScope,
    pub folder_path: Option<String>,
    pub action: ScheduleAction,
    #[serde(default = "download_only")]
    pub update_policy: ScheduleUpdatePolicy,
    pub notify: ScheduleNotify,
    pub catch_up: bool,
    pub enabled: bool,
    pub workflow: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ScheduleTask {
    pub id: String,
    pub name: String,
    pub kind: ScheduleKind,
    pub interval_minutes: Option<u32>,
    pub time_of_day: Option<String>,
    pub days: Vec<u8>,
    pub scope: ScheduleScope,
    pub folder_path: Option<String>,
    pub action: ScheduleAction,
    pub update_policy: ScheduleUpdatePolicy,
    pub notify: ScheduleNotify,
    pub catch_up: bool,
    pub enabled: bool,
    pub workflow: String,
    pub created_at: i64,
    pub last_run_at: Option<i64>,
    pub last_status: String,
    pub last_summary: Option<String>,
}

fn every_day() -> Vec<u8> {
    (1..=7).collect()
}

fn download_only() -> ScheduleUpdatePolicy {
    ScheduleUpdatePolicy::DownloadOnly
}

impl ScheduleTaskInput {
    pub fn validate(&self) -> Result<(), String> {
        let trimmed_name = self.name.trim();
        if trimmed_name.is_empty() || trimmed_name.chars().count() > MAX_NAME_CHARS {
            return Err("Schedule name must contain 1 to 64 characters".into());
        }
        if self.workflow.trim().is_empty() || self.workflow.len() > 128 {
            return Err("Schedule workflow must contain 1 to 128 bytes".into());
        }
        match self.kind {
            ScheduleKind::Interval => {
                if !self
                    .interval_minutes
                    .is_some_and(|minutes| (5..=10_080).contains(&minutes))
                    || self.time_of_day.is_some()
                {
                    return Err(
                        "Interval schedules require interval_minutes from 5 to 10080 and no time_of_day"
                            .into(),
                    );
                }
            }
            ScheduleKind::FixedTime => {
                if self.interval_minutes.is_some()
                    || !self.time_of_day.as_deref().is_some_and(valid_time_of_day)
                    || self.days.is_empty()
                    || self.days.iter().any(|day| !(1..=7).contains(day))
                {
                    return Err(
                        "Fixed-time schedules require HH:MM, no interval_minutes, and ISO weekdays 1 to 7"
                            .into(),
                    );
                }
                let mut unique_days = self.days.clone();
                unique_days.sort_unstable();
                unique_days.dedup();
                if unique_days.len() != self.days.len() {
                    return Err("Schedule days must not contain duplicates".into());
                }
            }
        }
        match self.scope {
            ScheduleScope::All if self.folder_path.is_some() => {
                return Err("All-folder schedules must not include folder_path".into());
            }
            ScheduleScope::Folder
                if !self.folder_path.as_deref().is_some_and(valid_folder_path) =>
            {
                return Err("Folder schedules require a root-relative folder_path".into());
            }
            _ => {}
        }
        if self.action == ScheduleAction::Scan && self.scope != ScheduleScope::Folder {
            return Err("Scan schedules must target a folder".into());
        }
        if self.action != ScheduleAction::Update
            && self.update_policy != ScheduleUpdatePolicy::DownloadOnly
        {
            return Err("update_policy only applies to update schedules".into());
        }
        Ok(())
    }
}

fn valid_time_of_day(value: &str) -> bool {
    let Some((hour, minute)) = value.split_once(':') else {
        return false;
    };
    hour.len() == 2
        && minute.len() == 2
        && hour.bytes().all(|byte| byte.is_ascii_digit())
        && minute.bytes().all(|byte| byte.is_ascii_digit())
        && hour.parse::<u8>().is_ok_and(|value| value <= 23)
        && minute.parse::<u8>().is_ok_and(|value| value <= 59)
}

fn valid_folder_path(value: &str) -> bool {
    let mut parts = value.split('/');
    parts.next() == Some("root")
        && parts.all(|part| !part.is_empty() && part != "." && part != ".." && !part.contains('\\'))
        && value.len() <= 2048
}

#[derive(Debug, Clone)]
pub struct ExtensionScheduleStore {
    root: PathBuf,
}

impl ExtensionScheduleStore {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            root: app_data_dir.join("extensions").join("schedules"),
        }
    }

    pub fn list(
        &self,
        server_hash: &str,
        username: &str,
        extension_id: &str,
    ) -> Result<Vec<ScheduleTask>, String> {
        let _guard = STORE_LOCK
            .lock()
            .map_err(|_| "Extension schedule store lock poisoned")?;
        self.read_tasks(server_hash, username, extension_id)
    }

    pub fn create(
        &self,
        server_hash: &str,
        username: &str,
        extension_id: &str,
        task: ScheduleTaskInput,
    ) -> Result<ScheduleTask, String> {
        task.validate()?;
        let _guard = STORE_LOCK
            .lock()
            .map_err(|_| "Extension schedule store lock poisoned")?;
        let mut tasks = self.read_tasks(server_hash, username, extension_id)?;
        if tasks.len() >= MAX_SCHEDULES_PER_EXTENSION {
            return Err("An extension can have at most 32 schedules".into());
        }
        let task = ScheduleTask {
            id: new_task_id(),
            name: task.name.trim().to_string(),
            kind: task.kind,
            interval_minutes: task.interval_minutes,
            time_of_day: task.time_of_day,
            days: task.days,
            scope: task.scope,
            folder_path: task.folder_path,
            action: task.action,
            update_policy: task.update_policy,
            notify: task.notify,
            catch_up: task.catch_up,
            enabled: task.enabled,
            workflow: task.workflow,
            created_at: now_ms(),
            last_run_at: None,
            last_status: "never".into(),
            last_summary: None,
        };
        tasks.push(task.clone());
        self.write_tasks(server_hash, username, extension_id, &tasks)?;
        Ok(task)
    }

    pub fn update(
        &self,
        server_hash: &str,
        username: &str,
        extension_id: &str,
        task_id: &str,
        input: ScheduleTaskInput,
    ) -> Result<ScheduleTask, String> {
        input.validate()?;
        let _guard = STORE_LOCK
            .lock()
            .map_err(|_| "Extension schedule store lock poisoned")?;
        let mut tasks = self.read_tasks(server_hash, username, extension_id)?;
        let task = tasks
            .iter_mut()
            .find(|task| task.id == task_id)
            .ok_or_else(|| "Schedule task was not found".to_string())?;
        task.name = input.name.trim().to_string();
        task.kind = input.kind;
        task.interval_minutes = input.interval_minutes;
        task.time_of_day = input.time_of_day;
        task.days = input.days;
        task.scope = input.scope;
        task.folder_path = input.folder_path;
        task.action = input.action;
        task.update_policy = input.update_policy;
        task.notify = input.notify;
        task.catch_up = input.catch_up;
        task.enabled = input.enabled;
        task.workflow = input.workflow;
        let result = task.clone();
        self.write_tasks(server_hash, username, extension_id, &tasks)?;
        Ok(result)
    }

    pub fn delete(
        &self,
        server_hash: &str,
        username: &str,
        extension_id: &str,
        task_id: &str,
    ) -> Result<bool, String> {
        let _guard = STORE_LOCK
            .lock()
            .map_err(|_| "Extension schedule store lock poisoned")?;
        let mut tasks = self.read_tasks(server_hash, username, extension_id)?;
        let old_len = tasks.len();
        tasks.retain(|task| task.id != task_id);
        if old_len == tasks.len() {
            return Ok(false);
        }
        self.write_tasks(server_hash, username, extension_id, &tasks)?;
        Ok(true)
    }

    /// Apply multiple schedule changes in one write.
    ///
    /// Existing IDs are updated in place, new entries are created, and only
    /// explicitly listed IDs are deleted.
    pub fn batch(
        &self,
        server_hash: &str,
        username: &str,
        extension_id: &str,
        inputs: Vec<(Option<String>, ScheduleTaskInput)>,
        delete_task_ids: Vec<String>,
    ) -> Result<(Vec<ScheduleTask>, Vec<String>), String> {
        if inputs.len() > MAX_SCHEDULES_PER_EXTENSION
            || delete_task_ids.len() > MAX_SCHEDULES_PER_EXTENSION
        {
            return Err("An extension can have at most 32 schedules".into());
        }
        let mut upsert_ids = BTreeSet::new();
        for (id, input) in &inputs {
            input.validate()?;
            if let Some(id) = id {
                if id.is_empty() || !upsert_ids.insert(id.clone()) {
                    return Err("Schedule upsert IDs must be non-empty and unique".into());
                }
            }
        }
        let mut delete_ids = BTreeSet::new();
        for id in &delete_task_ids {
            if id.is_empty() || !delete_ids.insert(id.clone()) {
                return Err("Schedule delete IDs must be non-empty and unique".into());
            }
            if upsert_ids.contains(id) {
                return Err(format!(
                    "Schedule task {id} cannot be both updated and deleted"
                ));
            }
        }
        let _guard = STORE_LOCK
            .lock()
            .map_err(|_| "Extension schedule store lock poisoned")?;
        let mut tasks = self.read_tasks(server_hash, username, extension_id)?;
        for id in &delete_task_ids {
            let index = tasks
                .iter()
                .position(|task| task.id == *id)
                .ok_or_else(|| format!("Schedule task {id} was not found"))?;
            tasks.remove(index);
        }
        for (id, input) in inputs {
            match id {
                Some(id) => {
                    let task = tasks
                        .iter_mut()
                        .find(|task| task.id == id)
                        .ok_or_else(|| format!("Schedule task {id} was not found"))?;
                    task.name = input.name.trim().to_string();
                    task.kind = input.kind;
                    task.interval_minutes = input.interval_minutes;
                    task.time_of_day = input.time_of_day;
                    task.days = input.days;
                    task.scope = input.scope;
                    task.folder_path = input.folder_path;
                    task.action = input.action;
                    task.update_policy = input.update_policy;
                    task.notify = input.notify;
                    task.catch_up = input.catch_up;
                    task.enabled = input.enabled;
                    task.workflow = input.workflow;
                }
                None => tasks.push(ScheduleTask {
                    id: new_task_id(),
                    name: input.name.trim().to_string(),
                    kind: input.kind,
                    interval_minutes: input.interval_minutes,
                    time_of_day: input.time_of_day,
                    days: input.days,
                    scope: input.scope,
                    folder_path: input.folder_path,
                    action: input.action,
                    update_policy: input.update_policy,
                    notify: input.notify,
                    catch_up: input.catch_up,
                    enabled: input.enabled,
                    workflow: input.workflow,
                    created_at: now_ms(),
                    last_run_at: None,
                    last_status: "never".into(),
                    last_summary: None,
                }),
            }
        }
        if tasks.len() > MAX_SCHEDULES_PER_EXTENSION {
            return Err("An extension can have at most 32 schedules".into());
        }
        self.write_tasks(server_hash, username, extension_id, &tasks)?;
        Ok((tasks, delete_task_ids))
    }

    pub fn delete_extension(&self, extension_id: &str) -> Result<(), String> {
        validate_component(extension_id, "extension id")?;
        let _guard = STORE_LOCK
            .lock()
            .map_err(|_| "Extension schedule store lock poisoned")?;
        let servers = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(format!("Failed to read extension schedules: {error}")),
        };
        for server in servers {
            let server =
                server.map_err(|error| format!("Failed to read schedule directory: {error}"))?;
            if !server
                .file_type()
                .map_err(|error| format!("Failed to inspect schedule directory: {error}"))?
                .is_dir()
            {
                continue;
            }
            for account in fs::read_dir(server.path())
                .map_err(|error| format!("Failed to read schedule account directory: {error}"))?
            {
                let account =
                    account.map_err(|error| format!("Failed to read schedule account: {error}"))?;
                if !account
                    .file_type()
                    .map_err(|error| format!("Failed to inspect schedule account: {error}"))?
                    .is_dir()
                {
                    continue;
                }
                let path = account.path().join(format!("{extension_id}.json"));
                match fs::remove_file(path) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => {
                        return Err(format!("Failed to delete extension schedules: {error}"));
                    }
                }
            }
        }
        Ok(())
    }

    pub fn record_run(
        &self,
        server_hash: &str,
        username: &str,
        extension_id: &str,
        task_id: &str,
        status: &str,
        summary: Option<String>,
    ) -> Result<ScheduleTask, String> {
        if !matches!(status, "success" | "failure" | "skipped") {
            return Err("Schedule status must be success, failure, or skipped".into());
        }
        if summary.as_ref().is_some_and(|value| value.len() > 1024) {
            return Err("Schedule summary cannot exceed 1024 bytes".into());
        }
        let _guard = STORE_LOCK
            .lock()
            .map_err(|_| "Extension schedule store lock poisoned")?;
        let mut tasks = self.read_tasks(server_hash, username, extension_id)?;
        let task = tasks
            .iter_mut()
            .find(|task| task.id == task_id)
            .ok_or_else(|| "Schedule task was not found".to_string())?;
        task.last_run_at = Some(now_ms());
        task.last_status = status.to_string();
        task.last_summary = summary;
        let result = task.clone();
        self.write_tasks(server_hash, username, extension_id, &tasks)?;
        Ok(result)
    }

    fn read_tasks(
        &self,
        server_hash: &str,
        username: &str,
        extension_id: &str,
    ) -> Result<Vec<ScheduleTask>, String> {
        let path = self.file_path(server_hash, username, extension_id)?;
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(format!("Failed to inspect extension schedules: {error}")),
        };
        if metadata.len() > MAX_SCHEDULE_FILE_BYTES {
            return Err("Stored extension schedules exceed the 256 KiB limit".into());
        }
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) => return Err(format!("Failed to read extension schedules: {error}")),
        };
        serde_json::from_slice(&bytes)
            .map_err(|error| format!("Invalid stored extension schedules: {error}"))
    }

    fn write_tasks(
        &self,
        server_hash: &str,
        username: &str,
        extension_id: &str,
        tasks: &[ScheduleTask],
    ) -> Result<(), String> {
        let path = self.file_path(server_hash, username, extension_id)?;
        let parent = path
            .parent()
            .ok_or_else(|| "Invalid extension schedule path".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create extension schedule directory: {error}"))?;
        let bytes = serde_json::to_vec_pretty(tasks)
            .map_err(|error| format!("Failed to serialize extension schedules: {error}"))?;
        let temporary_path = path.with_extension("json.tmp");
        fs::write(&temporary_path, bytes)
            .map_err(|error| format!("Failed to write extension schedules: {error}"))?;
        if cfg!(windows) && path.exists() {
            let backup_path = path.with_extension("json.bak");
            if backup_path.exists() {
                fs::remove_file(&backup_path)
                    .map_err(|error| format!("Failed to replace schedule backup: {error}"))?;
            }
            fs::rename(&path, &backup_path)
                .map_err(|error| format!("Failed to back up extension schedules: {error}"))?;
            match fs::rename(&temporary_path, &path) {
                Ok(()) => fs::remove_file(backup_path)
                    .map_err(|error| format!("Failed to remove schedule backup: {error}")),
                Err(error) => {
                    let _ = fs::rename(&backup_path, &path);
                    Err(format!("Failed to save extension schedules: {error}"))
                }
            }
        } else {
            fs::rename(&temporary_path, &path)
                .map_err(|error| format!("Failed to save extension schedules: {error}"))
        }
    }

    fn file_path(
        &self,
        server_hash: &str,
        username: &str,
        extension_id: &str,
    ) -> Result<PathBuf, String> {
        validate_component(server_hash, "server hash")?;
        validate_component(extension_id, "extension id")?;
        if username.is_empty() {
            return Err("Username cannot be empty".into());
        }
        let account_hash = hex::encode(sha2::Sha256::digest(username.as_bytes()));
        Ok(self
            .root
            .join(server_hash)
            .join(account_hash)
            .join(format!("{extension_id}.json")))
    }
}

fn validate_component(value: &str, description: &str) -> Result<(), String> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(format!("Invalid {description}"));
    }
    Ok(())
}

fn new_task_id() -> String {
    let bytes = rand::rng().random::<[u8; 8]>();
    format!("sched_{}", hex::encode(bytes))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_task() -> ScheduleTaskInput {
        ScheduleTaskInput {
            name: "Check updates".into(),
            kind: ScheduleKind::Interval,
            interval_minutes: Some(5),
            time_of_day: None,
            days: every_day(),
            scope: ScheduleScope::All,
            folder_path: None,
            action: ScheduleAction::Check,
            update_policy: download_only(),
            notify: ScheduleNotify::ProblemsOnly,
            catch_up: true,
            enabled: true,
            workflow: "task-check".into(),
        }
    }

    #[test]
    fn validates_schedule_shapes_and_bounds() {
        let mut task = valid_task();
        task.interval_minutes = Some(4);
        assert!(task.validate().is_err());

        let mut task = valid_task();
        task.kind = ScheduleKind::FixedTime;
        task.interval_minutes = None;
        task.time_of_day = Some("09:00".into());
        task.days = vec![1, 2, 3, 4, 5];
        assert!(task.validate().is_ok());
        task.time_of_day = Some("24:00".into());
        assert!(task.validate().is_err());
    }

    #[test]
    fn rejects_invalid_folder_scopes_and_actions() {
        let mut task = valid_task();
        task.scope = ScheduleScope::Folder;
        task.folder_path = Some("root/projects/../private".into());
        assert!(task.validate().is_err());

        task.scope = ScheduleScope::All;
        task.folder_path = None;
        task.action = ScheduleAction::Scan;
        assert!(task.validate().is_err());

        task.scope = ScheduleScope::Folder;
        task.folder_path = Some("root/projects".into());
        task.action = ScheduleAction::Update;
        task.update_policy = ScheduleUpdatePolicy::Mirror;
        assert!(task.validate().is_ok());
    }

    #[test]
    fn schedule_crud_is_scoped_to_account_and_extension() {
        let directory = tempfile::tempdir().unwrap();
        let store = ExtensionScheduleStore::new(directory.path());
        let created = store
            .create("server", "user/a", "sample-extension", valid_task())
            .unwrap();
        assert_eq!(
            store.list("server", "user/a", "sample-extension").unwrap(),
            vec![created.clone()]
        );
        assert!(
            store
                .list("server", "user/b", "sample-extension")
                .unwrap()
                .is_empty()
        );
        assert!(
            store
                .list("server", "user/a", "another-extension")
                .unwrap()
                .is_empty()
        );

        let updated = store
            .update(
                "server",
                "user/a",
                "sample-extension",
                &created.id,
                valid_task(),
            )
            .unwrap();
        assert_eq!(updated.created_at, created.created_at);
        assert_eq!(updated.last_status, "never");
        assert!(
            store
                .delete("server", "user/a", "sample-extension", &created.id)
                .unwrap()
        );
        assert!(
            store
                .list("server", "user/a", "sample-extension")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn schedule_limit_is_enforced() {
        let directory = tempfile::tempdir().unwrap();
        let store = ExtensionScheduleStore::new(directory.path());
        for _ in 0..MAX_SCHEDULES_PER_EXTENSION {
            store
                .create("server", "user", "sample-extension", valid_task())
                .unwrap();
        }
        assert!(
            store
                .create("server", "user", "sample-extension", valid_task())
                .is_err()
        );
    }

    #[test]
    fn uninstall_removes_schedules_for_all_accounts() {
        let directory = tempfile::tempdir().unwrap();
        let store = ExtensionScheduleStore::new(directory.path());
        store
            .create("server-a", "user-a", "sample-extension", valid_task())
            .unwrap();
        store
            .create("server-b", "user-b", "sample-extension", valid_task())
            .unwrap();

        store.delete_extension("sample-extension").unwrap();

        assert!(
            store
                .list("server-a", "user-a", "sample-extension")
                .unwrap()
                .is_empty()
        );
        assert!(
            store
                .list("server-b", "user-b", "sample-extension")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn batch_updates_preserves_metadata_and_applies_explicit_deletes() {
        let directory = tempfile::tempdir().unwrap();
        let store = ExtensionScheduleStore::new(directory.path());
        let first = store
            .create("server", "user", "sample-extension", valid_task())
            .unwrap();
        let second = store
            .create("server", "user", "sample-extension", valid_task())
            .unwrap();
        let first = store
            .record_run(
                "server",
                "user",
                "sample-extension",
                &first.id,
                "success",
                Some("Completed".into()),
            )
            .unwrap();

        let mut changed = valid_task();
        changed.name = "Renamed".into();
        let (tasks, deleted_ids) = store
            .batch(
                "server",
                "user",
                "sample-extension",
                vec![(Some(first.id.clone()), changed), (None, valid_task())],
                vec![second.id.clone()],
            )
            .unwrap();

        assert_eq!(tasks.len(), 2);
        assert_eq!(deleted_ids, vec![second.id.clone()]);
        assert_eq!(tasks[0].id, first.id);
        assert_eq!(tasks[0].name, "Renamed");
        assert_eq!(tasks[0].created_at, first.created_at);
        assert_eq!(tasks[0].last_run_at, first.last_run_at);
        assert_eq!(tasks[0].last_status, "success");
        assert_eq!(tasks[0].last_summary.as_deref(), Some("Completed"));
        assert_ne!(tasks[1].id, second.id);
        assert_eq!(tasks[1].last_status, "never");
        assert!(
            store
                .list("server", "user", "sample-extension")
                .unwrap()
                .iter()
                .all(|task| task.id != second.id)
        );
    }

    #[test]
    fn batch_validation_failure_does_not_write_partial_changes() {
        let directory = tempfile::tempdir().unwrap();
        let store = ExtensionScheduleStore::new(directory.path());
        let existing = store
            .create("server", "user", "sample-extension", valid_task())
            .unwrap();

        assert!(
            store
                .batch(
                    "server",
                    "user",
                    "sample-extension",
                    vec![(None, valid_task())],
                    vec!["missing-task".into()],
                )
                .is_err()
        );

        assert_eq!(
            store.list("server", "user", "sample-extension").unwrap(),
            vec![existing]
        );
    }

    #[test]
    fn batch_rejects_duplicate_and_overlapping_ids() {
        let directory = tempfile::tempdir().unwrap();
        let store = ExtensionScheduleStore::new(directory.path());
        let existing = store
            .create("server", "user", "sample-extension", valid_task())
            .unwrap();

        assert!(
            store
                .batch(
                    "server",
                    "user",
                    "sample-extension",
                    vec![
                        (Some(existing.id.clone()), valid_task()),
                        (Some(existing.id.clone()), valid_task()),
                    ],
                    Vec::new(),
                )
                .is_err()
        );
        assert!(
            store
                .batch(
                    "server",
                    "user",
                    "sample-extension",
                    vec![(Some(existing.id.clone()), valid_task())],
                    vec![existing.id.clone()],
                )
                .is_err()
        );
        assert_eq!(
            store.list("server", "user", "sample-extension").unwrap(),
            vec![existing]
        );
    }
}
