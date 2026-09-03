use std::fs;
use std::io::Write as _;
use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;
use tauri::Manager;

/// Paperwren core (docs/10): a thin Rust layer for storage and
/// cache management. File reading lives in the fs plugin so the
/// same code path handles desktop paths and Android content URIs.
///
/// Security boundary of every command here (named per the audit
/// rule): reads and writes are confined to two directories the app
/// owns, `app_data/store` and `app_cache/files`, and every store
/// key is filtered to a safe charset before it can touch a path.
/// Nothing here accepts arbitrary absolute paths.

#[derive(Serialize)]
pub struct CacheStats {
    bytes: u64,
}

fn store_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("store");
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base)
}

fn cache_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("files");
    Ok(base)
}

/// Only plain name characters survive; this key becomes a filename.
fn sanitize_key(key: &str) -> String {
    key.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect()
}

#[tauri::command]
fn store_get(app: tauri::AppHandle, key: String) -> Result<Value, String> {
    let path = store_dir(&app)?.join(format!("{}.json", sanitize_key(&key)));
    if !path.exists() {
        return Ok(Value::Null);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
fn store_set(app: tauri::AppHandle, key: String, value: Value) -> Result<(), String> {
    let dir = store_dir(&app)?;
    let path = dir.join(format!("{}.json", sanitize_key(&key)));
    // Atomic write: a kill mid-write must leave the previous
    // version readable, so write a temp file and rename.
    let tmp = dir.join(format!(".{}.tmp", std::process::id()));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let payload = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
        f.write_all(&payload).map_err(|e| e.to_string())?;
        let _ = f.sync_all();
    }
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn dir_size(path: &PathBuf) -> u64 {
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

#[tauri::command]
fn cache_stats(app: tauri::AppHandle) -> Result<CacheStats, String> {
    let root = cache_root(&app)?;
    Ok(CacheStats { bytes: dir_size(&root) })
}

#[tauri::command]
fn clear_cache(app: tauri::AppHandle) -> Result<CacheStats, String> {
    let root = cache_root(&app)?;
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
    }
    Ok(CacheStats { bytes: 0 })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            store_get,
            store_set,
            cache_stats,
            clear_cache
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
