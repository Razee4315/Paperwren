//! Paperwren core: storage for settings/recents and housekeeping for
//! managed "Open with" copies. File *reading* goes through the fs
//! plugin so one code path covers desktop paths and Android
//! `content://` URIs.
//!
//! Security boundary: every command here touches only two
//! directories the app owns (`app_data/store`, `app_data/imports`)
//! and validates keys and relative paths before building a path.
//! No command accepts an absolute path.

mod error;
mod imports;
mod store;

use std::path::PathBuf;
use std::time::SystemTime;

use serde_json::Value;
use tauri::Manager;

use error::{AppError, AppResult};

/// Size cap for managed copies before the oldest are evicted.
const IMPORTS_MAX_BYTES: u64 = 250 * 1024 * 1024;

fn data_dir(app: &tauri::AppHandle, leaf: &str) -> AppResult<PathBuf> {
    Ok(app.path().app_data_dir()?.join(leaf))
}

/// Run blocking filesystem work off the async runtime's workers so a
/// large directory walk can never stall IPC (or the UI on Android).
async fn blocking<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::new(error::ErrorKind::Io, e.to_string()))?
}

#[tauri::command]
async fn store_get(app: tauri::AppHandle, key: String) -> AppResult<Value> {
    let dir = data_dir(&app, "store")?;
    blocking(move || store::get(&dir, &key)).await
}

#[tauri::command]
async fn store_set(app: tauri::AppHandle, key: String, value: Value) -> AppResult<()> {
    let dir = data_dir(&app, "store")?;
    blocking(move || store::set(&dir, &key, &value)).await
}

#[tauri::command]
async fn imports_stats(app: tauri::AppHandle) -> AppResult<imports::Stats> {
    let root = data_dir(&app, "imports")?;
    blocking(move || Ok(imports::stats(&root))).await
}

#[tauri::command]
async fn imports_clear(app: tauri::AppHandle) -> AppResult<()> {
    let root = data_dir(&app, "imports")?;
    blocking(move || imports::clear(&root)).await
}

#[tauri::command]
async fn imports_remove(app: tauri::AppHandle, paths: Vec<String>) -> AppResult<u64> {
    let root = data_dir(&app, "imports")?;
    blocking(move || Ok(imports::remove(&root, &paths))).await
}

/// `keep` lists the managed copies still referenced by recents,
/// relative to the imports directory.
#[tauri::command]
async fn imports_prune(
    app: tauri::AppHandle,
    keep: Vec<String>,
) -> AppResult<imports::PruneReport> {
    let root = data_dir(&app, "imports")?;
    blocking(move || {
        Ok(imports::prune(
            &root,
            &keep,
            IMPORTS_MAX_BYTES,
            SystemTime::now(),
        ))
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            store_get,
            store_set,
            imports_stats,
            imports_clear,
            imports_remove,
            imports_prune
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
