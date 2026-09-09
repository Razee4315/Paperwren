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

/// Managed open-with copies live here. They are reopen-critical, so
/// they are NOT part of "Clear cache" (audit section 4.4): removing
/// one invalidates its recent instead of happening silently.
fn imports_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("imports");
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
    let safe_key = sanitize_key(&key);
    let path = dir.join(format!("{safe_key}.json"));
    // Atomic write: a kill mid-write must leave the previous
    // version readable, so write a temp file and rename. The temp
    // name is unique per destination key AND write generation:
    // settings and recents writing concurrently used to share one
    // process-wide temp path (audit section 15.2).
    let generation = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(
        ".{safe_key}.{}.{}.tmp",
        std::process::id(),
        generation
    ));
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
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            // Never follow symlinks: a link loop in a cache dir would
            // recurse forever (fatal under panic=abort), and a link
            // pointing outside the dir is not ours to size.
            if file_type.is_symlink() {
                continue;
            }
            let p = entry.path();
            if file_type.is_dir() {
                total += dir_size(&p);
            } else if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

// Cache/import maintenance runs off the main thread: async commands
// execute on Tauri's command thread pool, while sync commands run on
// the platform main loop. dir_size/remove_dir_all over an imports
// dir holding large documents would otherwise block the UI (ANR on
// Android).

#[tauri::command]
async fn cache_stats(app: tauri::AppHandle) -> Result<CacheStats, String> {
    let root = cache_root(&app)?;
    Ok(CacheStats { bytes: dir_size(&root) })
}

#[tauri::command]
async fn clear_cache(app: tauri::AppHandle) -> Result<CacheStats, String> {
    let root = cache_root(&app)?;
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
    }
    Ok(CacheStats { bytes: 0 })
}

#[tauri::command]
async fn imports_stats(app: tauri::AppHandle) -> Result<CacheStats, String> {
    let root = imports_root(&app)?;
    Ok(CacheStats {
        bytes: dir_size(&root),
    })
}

/// Removing managed copies invalidates their recents; the frontend
/// marks the affected entries unavailable rather than calling this
/// under a control labeled only "Clear cache".
#[tauri::command]
async fn clear_imports(app: tauri::AppHandle) -> Result<CacheStats, String> {
    let root = imports_root(&app)?;
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
    }
    Ok(CacheStats { bytes: 0 })
}

/// Delete specific managed copies (recents eviction). Only bare
/// filenames are accepted: anything that is not a plain existing file
/// directly inside the imports dir is ignored, so this can never
/// reach outside the app's own store no matter what the webview sends.
#[tauri::command]
async fn imports_remove(
    app: tauri::AppHandle,
    names: Vec<String>,
) -> Result<usize, String> {
    let root = imports_root(&app)?;
    let mut removed = 0;
    for name in names {
        // Reject separators, dot segments, and empty names outright.
        if name.is_empty()
            || name.contains('/')
            || name.contains('\\')
            || name == "."
            || name == ".."
            || name.starts_with('.')
        {
            continue;
        }
        let path = root.join(name);
        if let Ok(meta) = fs::symlink_metadata(&path) {
            if meta.is_file() {
                let _ = fs::remove_file(&path);
                removed += 1;
            }
        }
    }
    Ok(removed)
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
            clear_cache,
            imports_stats,
            clear_imports,
            imports_remove
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
