//! Database open and migration.

use rusqlite::Connection;
use std::path::Path;

use cfms_core::Result;

use crate::db::schema;

/// Open (or create) the persistent application database at `path`, running
/// any pending schema migrations.
pub fn open(path: &Path) -> Result<Connection> {
    let db = Connection::open(path).map_err(|e| {
        cfms_core::Error::Other(format!(
            "failed to open database at {}: {e}",
            path.display()
        ))
    })?;

    // Performance / durability pragmas.
    db.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         PRAGMA busy_timeout=5000;",
    )
    .map_err(|e| cfms_core::Error::Other(format!("failed to set pragmas: {e}")))?;

    // Run migrations.
    migrate(&db)?;

    Ok(db)
}

/// Apply any pending schema migrations.
pub(super) fn migrate(db: &Connection) -> Result<()> {
    // Ensure schema_version table exists (it's created in SCHEMA_V1, but we
    // need a fallback for a completely empty database).
    let current: u32 = db
        .query_row(
            "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if current < 1 {
        db.execute_batch(schema::SCHEMA_V1)
            .map_err(|e| cfms_core::Error::Other(format!("schema v1 migration failed: {e}")))?;
    }

    if current < 2 {
        db.execute_batch(schema::SCHEMA_V2)
            .map_err(|e| cfms_core::Error::Other(format!("schema v2 migration failed: {e}")))?;
    }

    if current < 3 {
        let transaction = db
            .unchecked_transaction()
            .map_err(|e| cfms_core::Error::Other(format!("begin schema v3 migration: {e}")))?;
        transaction
            .execute_batch(schema::SCHEMA_V3)
            .map_err(|e| cfms_core::Error::Other(format!("schema v3 migration failed: {e}")))?;
        transaction
            .commit()
            .map_err(|e| cfms_core::Error::Other(format!("commit schema v3 migration: {e}")))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;


    fn assert_current_schema(db: &Connection) {
        let version: u32 = db
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, schema::CURRENT_VERSION);
        let mut statement = db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap();
        let tables = statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(
            tables,
            [
                "extension_catalog_state",
                "extension_installations",
                "extension_package_versions",
                "schema_version",
                "user_settings",
            ]
        );
    }

    fn insert_setting(db: &Connection) {
        db.execute(
            "INSERT INTO user_settings (key, value) VALUES ('language', 'zh_CN')",
            [],
        )
        .unwrap();
    }

    fn assert_setting(db: &Connection) {
        let language: String = db
            .query_row(
                "SELECT value FROM user_settings WHERE key = 'language'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(language, "zh_CN");
    }

    fn legacy_database(path: &Path) -> Connection {
        let db = Connection::open(path).unwrap();
        db.execute_batch(schema::SCHEMA_V1).unwrap();
        db.execute_batch(schema::SCHEMA_V2).unwrap();
        db.execute_batch(
            r#"
            INSERT INTO extension_installations
                VALUES ('org.cfms.example', '1.0.0', 'digest', 'epoch', 'installed', 1, NULL, NULL);
            INSERT INTO extension_catalog_state
                VALUES ('https://example.test/catalog.json', 'etag', 1, '{}', 'signature');
            INSERT INTO extension_package_versions
                VALUES ('org.cfms.example', '1.0.0', 'digest', 1);
        "#,
        )
        .unwrap();
        insert_setting(&db);
        db
    }

    #[test]
    fn fresh_database_reaches_current_schema_with_extension_tables() {
        let temp = tempfile::tempdir().unwrap();
        let db = open(&temp.path().join("client.db")).unwrap();
        assert_current_schema(&db);
        let v2_entries: u32 = db
            .query_row(
                "SELECT COUNT(*) FROM schema_version WHERE version = 2",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(v2_entries, 1);
    }

    #[test]
    fn version_one_database_migrates_without_losing_settings() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("client.db");
        let db = Connection::open(&path).unwrap();
        db.execute_batch(schema::SCHEMA_V1).unwrap();
        insert_setting(&db);
        drop(db);

        let db = open(&path).unwrap();
        assert_current_schema(&db);
        assert_setting(&db);
    }

    #[test]
    fn version_two_database_preserves_extension_data_and_settings_on_reopen() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("client.db");
        drop(legacy_database(&path));

        for _ in 0..2 {
            let db = open(&path).unwrap();
            assert_current_schema(&db);
            assert_setting(&db);
            let v2_entries: u32 = db
                .query_row(
                    "SELECT COUNT(*) FROM schema_version WHERE version = 2",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(v2_entries, 1);
        }
    }

    #[test]
    fn recovery_database_uses_current_schema_and_supports_settings() {
        let db = crate::db::open_in_memory().unwrap();
        assert_current_schema(&db);
        insert_setting(&db);
        assert_setting(&db);
    }

    #[test]
    fn failed_migration_rolls_back_and_can_be_retried() {
        let temp = tempfile::tempdir().unwrap();
        let db = legacy_database(&temp.path().join("client.db"));
        db.execute_batch(
            r#"
            CREATE TRIGGER fail_v3 BEFORE INSERT ON schema_version
            WHEN NEW.version = 3
            BEGIN SELECT RAISE(ABORT, 'simulated migration failure'); END;
        "#,
        )
        .unwrap();

        assert!(migrate(&db).is_err());
        let version: u32 = db
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 2);
        for table in [
            "extension_installations",
            "extension_catalog_state",
            "extension_package_versions",
        ] {
            let rows: u32 = db
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(rows, 1);
        }
        assert_setting(&db);

        db.execute_batch("DROP TRIGGER fail_v3").unwrap();
        migrate(&db).unwrap();
        assert_current_schema(&db);
        assert_setting(&db);
    }
}
