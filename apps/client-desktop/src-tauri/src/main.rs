#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use keyring::Entry;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SERVICE_NAME: &str = "secure-messenger-desktop";
const MESSAGE_DB_NAME: &str = "messaging.sqlite3";
const PLUGINS_ROOT_DIR: &str = "plugins";
const PLUGIN_MANIFEST_NAME: &str = "manifest.json";
const MAX_PLUGIN_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_PLUGIN_ENTRYPOINT_BYTES: u64 = 512 * 1024;

#[derive(Serialize, Deserialize)]
struct OutboxItem {
    client_message_id: String,
    conversation_id: String,
    payload: String,
    created_at: String,
    retry_count: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalPluginDescriptor {
    manifest_json: String,
    entrypoint_code: String,
    source_ref: String,
}

#[tauri::command]
fn secure_store_set(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|error| error.to_string())?;
    entry
        .set_password(&value)
        .map_err(|error| format!("failed to set secret: {error}"))
}

#[tauri::command]
fn secure_store_get(key: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|error| error.to_string())?;

    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(error) => {
            let message = error.to_string().to_lowercase();
            if message.contains("no entry") || message.contains("not found") {
                Ok(None)
            } else {
                Err(format!("failed to get secret: {error}"))
            }
        }
    }
}

#[tauri::command]
fn secure_store_delete(key: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|error| error.to_string())?;

    match entry.delete_password() {
        Ok(_) => Ok(()),
        Err(error) => {
            let message = error.to_string().to_lowercase();
            if message.contains("no entry") || message.contains("not found") {
                Ok(())
            } else {
                Err(format!("failed to delete secret: {error}"))
            }
        }
    }
}

fn resolve_message_db_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?;
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir)
            .map_err(|error| format!("failed to create app data dir: {error}"))?;
    }
    Ok(app_dir.join(MESSAGE_DB_NAME))
}

fn resolve_plugin_root_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?;
    let plugins_dir = app_dir.join(PLUGINS_ROOT_DIR);
    if !plugins_dir.exists() {
        fs::create_dir_all(&plugins_dir)
            .map_err(|error| format!("failed to create plugins dir: {error}"))?;
    }
    Ok(plugins_dir)
}

fn is_path_inside(base_path: &Path, candidate_path: &Path) -> bool {
    let base = match fs::canonicalize(base_path) {
        Ok(path) => path,
        Err(_) => return false,
    };
    let candidate = match fs::canonicalize(candidate_path) {
        Ok(path) => path,
        Err(_) => return false,
    };
    candidate.starts_with(base)
}

fn is_valid_plugin_id(value: &str) -> bool {
    if value.len() < 3 || value.len() > 64 {
        return false;
    }
    value.chars().all(|char| {
        char.is_ascii_lowercase()
            || char.is_ascii_digit()
            || char == '.'
            || char == '_'
            || char == '-'
    })
}

fn validate_plugin_manifest(manifest: &Value) -> Result<(String, String), String> {
    let object = manifest
        .as_object()
        .ok_or_else(|| "manifest must be a JSON object".to_string())?;

    let api_version = object
        .get("apiVersion")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if api_version != "v1" {
        return Err("manifest apiVersion must be 'v1'".to_string());
    }

    let plugin_id = object
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if !is_valid_plugin_id(&plugin_id) {
        return Err("manifest id is invalid".to_string());
    }

    let entrypoint = object
        .get("entrypoint")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if entrypoint.is_empty() {
        return Err("manifest entrypoint is required".to_string());
    }
    if entrypoint.starts_with('/') || entrypoint.starts_with('\\') || entrypoint.contains("..") {
        return Err("manifest entrypoint must be a safe relative path".to_string());
    }

    let name = object
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if name.is_empty() {
        return Err("manifest name is required".to_string());
    }

    let version = object
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if version.is_empty() {
        return Err("manifest version is required".to_string());
    }

    Ok((plugin_id, entrypoint))
}

#[tauri::command]
fn plugins_discover_local(app_handle: AppHandle) -> Result<Vec<LocalPluginDescriptor>, String> {
    let plugin_root = resolve_plugin_root_path(&app_handle)?;
    let root_canonical = fs::canonicalize(&plugin_root)
        .map_err(|error| format!("failed to canonicalize plugin root: {error}"))?;

    let entries = fs::read_dir(&root_canonical)
        .map_err(|error| format!("failed to list plugin directory: {error}"))?;

    let mut result = Vec::new();
    for entry in entries.flatten() {
        let plugin_dir = entry.path();
        if !plugin_dir.is_dir() {
            continue;
        }

        let plugin_dir_canonical = match fs::canonicalize(&plugin_dir) {
            Ok(path) => path,
            Err(_) => continue,
        };
        if !plugin_dir_canonical.starts_with(&root_canonical) {
            continue;
        }

        let manifest_path = plugin_dir_canonical.join(PLUGIN_MANIFEST_NAME);
        if !manifest_path.exists() {
            continue;
        }
        if !is_path_inside(&plugin_dir_canonical, &manifest_path) {
            continue;
        }

        let manifest_metadata = match fs::metadata(&manifest_path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if manifest_metadata.len() == 0 || manifest_metadata.len() > MAX_PLUGIN_MANIFEST_BYTES {
            continue;
        }

        let manifest_raw = match fs::read_to_string(&manifest_path) {
            Ok(contents) => contents,
            Err(_) => continue,
        };
        let manifest_value: Value = match serde_json::from_str(&manifest_raw) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let (_, entrypoint_relative) = match validate_plugin_manifest(&manifest_value) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let entrypoint_candidate = plugin_dir_canonical.join(entrypoint_relative);
        let entrypoint_canonical = match fs::canonicalize(&entrypoint_candidate) {
            Ok(path) => path,
            Err(_) => continue,
        };
        if !entrypoint_canonical.starts_with(&plugin_dir_canonical) {
            continue;
        }

        let entry_metadata = match fs::metadata(&entrypoint_canonical) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if entry_metadata.len() == 0 || entry_metadata.len() > MAX_PLUGIN_ENTRYPOINT_BYTES {
            continue;
        }

        let entrypoint_code = match fs::read_to_string(&entrypoint_canonical) {
            Ok(contents) => contents,
            Err(_) => continue,
        };
        let manifest_json = match serde_json::to_string(&manifest_value) {
            Ok(value) => value,
            Err(_) => continue,
        };

        result.push(LocalPluginDescriptor {
            manifest_json,
            entrypoint_code,
            source_ref: format!("local:{}", plugin_dir_canonical.display()),
        });
    }

    Ok(result)
}

fn ensure_message_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;

            CREATE TABLE IF NOT EXISTS conversations (
              id TEXT PRIMARY KEY,
              payload TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
              id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL,
              server_sequence INTEGER,
              payload TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conversation_sequence
              ON messages(conversation_id, server_sequence DESC, created_at DESC);

            CREATE TABLE IF NOT EXISTS outbox (
              client_message_id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL,
              payload TEXT NOT NULL,
              created_at TEXT NOT NULL,
              retry_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS sync_state (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              cursor INTEGER NOT NULL DEFAULT 0,
              updated_at TEXT NOT NULL
            );
        ",
        )
        .map_err(|error| format!("failed to ensure messaging schema: {error}"))?;
    Ok(())
}

fn with_message_connection<T>(
    app_handle: &AppHandle,
    callback: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let db_path = resolve_message_db_path(app_handle)?;
    let connection = Connection::open(db_path)
        .map_err(|error| format!("failed to open messaging db: {error}"))?;
    ensure_message_schema(&connection)?;
    callback(&connection)
}

#[tauri::command]
fn messaging_store_upsert_conversation(
    app_handle: AppHandle,
    conversation_id: String,
    payload: String,
    updated_at: String,
) -> Result<(), String> {
    with_message_connection(&app_handle, |connection| {
        connection
            .execute(
                "
                INSERT INTO conversations (id, payload, updated_at)
                VALUES (?1, ?2, ?3)
                ON CONFLICT(id) DO UPDATE SET
                  payload = excluded.payload,
                  updated_at = excluded.updated_at
            ",
                params![conversation_id, payload, updated_at],
            )
            .map_err(|error| format!("failed to upsert conversation: {error}"))?;
        Ok(())
    })
}

#[tauri::command]
fn messaging_store_upsert_message(
    app_handle: AppHandle,
    message_id: String,
    conversation_id: String,
    server_sequence: Option<i64>,
    payload: String,
    created_at: String,
) -> Result<(), String> {
    with_message_connection(&app_handle, |connection| {
        connection
            .execute(
                "
                INSERT INTO messages (id, conversation_id, server_sequence, payload, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ON CONFLICT(id) DO UPDATE SET
                  conversation_id = excluded.conversation_id,
                  server_sequence = excluded.server_sequence,
                  payload = excluded.payload,
                  created_at = excluded.created_at
            ",
                params![
                    message_id,
                    conversation_id,
                    server_sequence,
                    payload,
                    created_at
                ],
            )
            .map_err(|error| format!("failed to upsert message: {error}"))?;
        Ok(())
    })
}

#[tauri::command]
fn messaging_store_list_conversations(app_handle: AppHandle) -> Result<Vec<String>, String> {
    with_message_connection(&app_handle, |connection| {
        let mut statement = connection
            .prepare("SELECT payload FROM conversations ORDER BY updated_at DESC")
            .map_err(|error| format!("failed to prepare list conversations statement: {error}"))?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| format!("failed to query conversations: {error}"))?;
        let mut result = Vec::new();
        for row in rows {
            result
                .push(row.map_err(|error| format!("failed to decode conversation row: {error}"))?);
        }
        Ok(result)
    })
}

#[tauri::command]
fn messaging_store_list_messages(
    app_handle: AppHandle,
    conversation_id: String,
    limit: i64,
) -> Result<Vec<String>, String> {
    let normalized_limit = if limit <= 0 { 100 } else { limit.min(500) };
    with_message_connection(&app_handle, |connection| {
        let mut statement = connection
            .prepare(
                "
                SELECT payload
                FROM messages
                WHERE conversation_id = ?1
                ORDER BY COALESCE(server_sequence, 0) DESC, created_at DESC
                LIMIT ?2
            ",
            )
            .map_err(|error| format!("failed to prepare list messages statement: {error}"))?;
        let rows = statement
            .query_map(params![conversation_id, normalized_limit], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| format!("failed to query messages: {error}"))?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|error| format!("failed to decode message row: {error}"))?);
        }
        Ok(result)
    })
}

#[tauri::command]
fn messaging_store_enqueue_outbox(
    app_handle: AppHandle,
    client_message_id: String,
    conversation_id: String,
    payload: String,
    created_at: String,
) -> Result<(), String> {
    with_message_connection(&app_handle, |connection| {
        connection
            .execute(
                "
                INSERT INTO outbox (client_message_id, conversation_id, payload, created_at, retry_count)
                VALUES (?1, ?2, ?3, ?4, 0)
                ON CONFLICT(client_message_id) DO UPDATE SET
                  payload = excluded.payload,
                  conversation_id = excluded.conversation_id,
                  created_at = excluded.created_at
            ",
                params![client_message_id, conversation_id, payload, created_at],
            )
            .map_err(|error| format!("failed to enqueue outbox item: {error}"))?;
        Ok(())
    })
}

#[tauri::command]
fn messaging_store_delete_outbox(
    app_handle: AppHandle,
    client_message_id: String,
) -> Result<(), String> {
    with_message_connection(&app_handle, |connection| {
        connection
            .execute(
                "DELETE FROM outbox WHERE client_message_id = ?1",
                params![client_message_id],
            )
            .map_err(|error| format!("failed to delete outbox item: {error}"))?;
        Ok(())
    })
}

#[tauri::command]
fn messaging_store_increment_outbox_retry(
    app_handle: AppHandle,
    client_message_id: String,
) -> Result<(), String> {
    with_message_connection(&app_handle, |connection| {
        connection
            .execute(
                "
                UPDATE outbox
                SET retry_count = retry_count + 1
                WHERE client_message_id = ?1
            ",
                params![client_message_id],
            )
            .map_err(|error| format!("failed to increment outbox retry: {error}"))?;
        Ok(())
    })
}

#[tauri::command]
fn messaging_store_list_outbox(app_handle: AppHandle) -> Result<Vec<OutboxItem>, String> {
    with_message_connection(&app_handle, |connection| {
        let mut statement = connection
            .prepare(
                "
                SELECT client_message_id, conversation_id, payload, created_at, retry_count
                FROM outbox
                ORDER BY created_at ASC
            ",
            )
            .map_err(|error| format!("failed to prepare list outbox statement: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok(OutboxItem {
                    client_message_id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    payload: row.get(2)?,
                    created_at: row.get(3)?,
                    retry_count: row.get(4)?,
                })
            })
            .map_err(|error| format!("failed to query outbox rows: {error}"))?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|error| format!("failed to decode outbox row: {error}"))?);
        }
        Ok(result)
    })
}

#[tauri::command]
fn messaging_store_read_sync_cursor(app_handle: AppHandle) -> Result<i64, String> {
    with_message_connection(&app_handle, |connection| {
        let mut statement = connection
            .prepare("SELECT cursor FROM sync_state WHERE id = 1")
            .map_err(|error| format!("failed to prepare read cursor statement: {error}"))?;
        let cursor = statement.query_row([], |row| row.get::<_, i64>(0));
        match cursor {
            Ok(value) => Ok(value),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(0),
            Err(error) => Err(format!("failed to read sync cursor: {error}")),
        }
    })
}

#[tauri::command]
fn messaging_store_write_sync_cursor(
    app_handle: AppHandle,
    cursor: i64,
    updated_at: String,
) -> Result<(), String> {
    with_message_connection(&app_handle, |connection| {
        connection
            .execute(
                "
                INSERT INTO sync_state (id, cursor, updated_at)
                VALUES (1, ?1, ?2)
                ON CONFLICT(id) DO UPDATE SET
                  cursor = CASE WHEN excluded.cursor > sync_state.cursor THEN excluded.cursor ELSE sync_state.cursor END,
                  updated_at = excluded.updated_at
            ",
                params![cursor, updated_at],
            )
            .map_err(|error| format!("failed to upsert sync cursor: {error}"))?;
        Ok(())
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            secure_store_set,
            secure_store_get,
            secure_store_delete,
            messaging_store_upsert_conversation,
            messaging_store_upsert_message,
            messaging_store_list_conversations,
            messaging_store_list_messages,
            messaging_store_enqueue_outbox,
            messaging_store_delete_outbox,
            messaging_store_increment_outbox_retry,
            messaging_store_list_outbox,
            messaging_store_read_sync_cursor,
            messaging_store_write_sync_cursor,
            plugins_discover_local
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
