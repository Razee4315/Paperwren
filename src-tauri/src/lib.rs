//! Paperwren core: storage for settings/recents and housekeeping for
//! managed "Open with" copies. File *reading* goes through the fs
//! plugin so one code path covers desktop paths and Android
//! `content://` URIs.
//!
//! Security boundary: the storage commands touch only two
//! directories the app owns (`app_data/store`, `app_data/imports`)
//! and validate keys and relative paths before building a path.
//! The desktop hand-off commands (`open.rs`) are the one exception:
//! they take the absolute path of the user's document, and accept it
//! only if it is an existing file of a document type the app opens.

mod error;
mod imports;
mod open;
mod store;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

use serde_json::Value;
use tauri::Manager;

use error::{AppError, AppResult};

/// Size cap for managed copies before the oldest are evicted.
const IMPORTS_MAX_BYTES: u64 = 250 * 1024 * 1024;

/// Tells the window that documents are waiting in `Waiting`.
#[cfg(target_os = "macos")]
const OPEN_EVENT: &str = "paperwren-open";

/// Documents the system handed the app that the window has not taken
/// yet: the ones on the command line and, on macOS, the ones Finder
/// asks for (which can arrive before the window is listening).
struct Waiting(Mutex<Vec<String>>);

impl Waiting {
    fn at_launch() -> Self {
        #[cfg(desktop)]
        let files = open::launch_files(std::env::args_os().skip(1));
        #[cfg(not(desktop))]
        let files = Vec::new();
        Self(Mutex::new(files))
    }

    fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(|e| e.into_inner()))
    }

    #[cfg(target_os = "macos")]
    fn add(&self, files: Vec<String>) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).extend(files);
    }
}

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

/// Documents the app was asked to open (a double-clicked file, "Open
/// with Paperwren") since the window last took them: each is handed
/// over once. Empty on mobile, where the system delivers files through
/// intents instead.
#[tauri::command]
fn launch_files(waiting: tauri::State<'_, Waiting>) -> Vec<String> {
    waiting.take()
}

/// macOS asked the app to open documents: keep them for the window,
/// tell it, and bring it forward.
#[cfg(target_os = "macos")]
fn opened(app: &tauri::AppHandle, urls: &[tauri::Url]) {
    use tauri::Emitter;

    let files = open::opened_files(urls);
    if files.is_empty() {
        return;
    }
    app.state::<Waiting>().add(files);
    let _ = app.emit(OPEN_EVENT, ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Open a document in the system's default app for its type.
#[tauri::command]
async fn open_external(path: String) -> AppResult<()> {
    let target = open::validated(&path)?;
    #[cfg(desktop)]
    {
        blocking(move || Ok(open::open_with_default(&target)?)).await
    }
    #[cfg(not(desktop))]
    {
        let _ = target;
        Err(AppError::new(error::ErrorKind::Path, "not available here"))
    }
}

/// Show a document in the system file manager.
#[tauri::command]
async fn reveal_in_folder(path: String) -> AppResult<()> {
    let target = open::validated(&path)?;
    #[cfg(desktop)]
    {
        blocking(move || Ok(open::reveal(&target)?)).await
    }
    #[cfg(not(desktop))]
    {
        let _ = target;
        Err(AppError::new(error::ErrorKind::Path, "not available here"))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Waiting::at_launch())
        .invoke_handler(tauri::generate_handler![
            store_get,
            store_set,
            imports_stats,
            imports_clear,
            imports_remove,
            imports_prune,
            launch_files,
            open_external,
            reveal_in_folder
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &_event {
                opened(_app, urls);
            }
        });
}
