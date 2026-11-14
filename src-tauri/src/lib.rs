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
//! The two desktop writes (`save.rs`) are asked for by the reader: a
//! copy saved where the system's save dialog says, and a rename of the
//! document on show within its folder. Listing a folder the reader chose
//! (`folder.rs`) reads names, sizes and dates only, as the fs plugin's
//! read-dir and stat permissions already allow, in one call instead of
//! one per file.

mod error;
mod folder;
mod imports;
mod open;
mod save;
mod store;
mod trace;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

use serde_json::Value;
use tauri::Manager;

use error::{AppError, AppResult};

/// Size cap for managed copies before the oldest are evicted.
const IMPORTS_MAX_BYTES: u64 = 250 * 1024 * 1024;

/// Tells the window that documents are waiting in `Waiting`.
#[cfg(desktop)]
const OPEN_EVENT: &str = "paperwren-open";

/// Documents the system handed the app that the window has not taken
/// yet: the ones on the command line, the ones a second launch passed
/// on, and, on macOS, the ones Finder asks for (which can arrive
/// before the window is listening).
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

    #[cfg(desktop)]
    fn add(&self, files: Vec<String>) {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .extend(files);
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

/// The documents in a folder the reader chose to browse, with the
/// sub-folder each is in and its size and date: one answer, read off the
/// main thread (folder.rs). `extensions` are the types the app opens.
#[tauri::command]
async fn list_folder(
    path: String,
    extensions: Vec<String>,
    limits: folder::Limits,
) -> AppResult<Vec<folder::Found>> {
    let extensions: Vec<String> = extensions
        .into_iter()
        .take(500)
        .map(|e| e.to_ascii_lowercase())
        .collect();
    blocking(move || folder::list(&PathBuf::from(path), &extensions, limits)).await
}

/// Documents the app was asked to open (a double-clicked file, "Open
/// with Paperwren") since the window last took them: each is handed
/// over once. Empty on mobile, where the system delivers files through
/// intents instead.
#[tauri::command]
fn launch_files(waiting: tauri::State<'_, Waiting>) -> Vec<String> {
    waiting.take()
}

/// Whether `PAPERWREN_TRACE` asks for start-up timings (trace.rs). The web
/// layer asks once and sends its milestones only when this is true.
#[tauri::command]
fn trace_enabled() -> bool {
    trace::enabled()
}

/// A milestone the web layer reached, written to the trace with the
/// time since the process started.
#[tauri::command]
fn trace_mark(name: String) {
    trace::mark_web(&name);
}

/// Documents to open in the running app: keep them for the window,
/// tell it, and bring it forward. With none, it is only brought
/// forward (Paperwren started again from its icon).
#[cfg(desktop)]
fn hand_over(app: &tauri::AppHandle, files: Vec<String>) {
    use tauri::Emitter;

    if !files.is_empty() {
        app.state::<Waiting>().add(files);
        let _ = app.emit(OPEN_EVENT, ());
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Paperwren was started again while it runs (a double-click on a
/// document in Explorer or a file manager, on Windows and Linux): that
/// second start ends at once and hands its documents here, so they
/// open as tabs in this window instead of in a second one.
#[cfg(desktop)]
fn second_launch(app: &tauri::AppHandle, argv: Vec<String>, cwd: String) {
    let cwd = std::path::Path::new(&cwd);
    let files = open::launch_files_in(argv.into_iter().skip(1), cwd);
    hand_over(app, files);
}

/// macOS asked the app to open documents.
#[cfg(target_os = "macos")]
fn opened(app: &tauri::AppHandle, urls: &[tauri::Url]) {
    let files = open::opened_files(urls);
    if !files.is_empty() {
        hand_over(app, files);
    }
}

/// Open a document in the system's default app for its type.
#[tauri::command]
async fn open_external(path: String) -> AppResult<()> {
    let target = open::validated_for_hand_off(&path)?;
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

/// Rename the document on show, in its folder; returns its new path.
#[tauri::command]
async fn rename_file(path: String, name: String) -> AppResult<String> {
    blocking(move || {
        let to = save::rename(&path, &name)?;
        to.to_str()
            .map(str::to_owned)
            .ok_or_else(|| AppError::new(error::ErrorKind::Path, "path is not text"))
    })
    .await
}

/// `%XX`-encoded text (the name travels in a header), decoded.
fn percent_decoded(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Save bytes the app made (the body) as a new file where the reader
/// says, in the system's save dialog, suggesting the name in the
/// `x-name` header. Returns the path, or None when the reader cancels.
#[tauri::command]
async fn save_as(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> AppResult<Option<String>> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::new(error::ErrorKind::Io, "expected the file's bytes"));
    };
    let bytes = bytes.clone();
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .and_then(percent_decoded)
        .and_then(|n| save::valid_name(&n).ok())
        .unwrap_or_else(|| "Untitled".to_owned());
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::DialogExt;
        let mut dialog = app.dialog().file().set_file_name(&name);
        if let Some(ext) = save::extension_of(&name) {
            dialog = dialog.add_filter(ext.to_uppercase(), &[ext.as_str()]);
        }
        blocking(move || {
            let Some(picked) = dialog.blocking_save_file() else {
                return Ok(None);
            };
            let path = picked
                .into_path()
                .map_err(|e| AppError::new(error::ErrorKind::Path, e.to_string()))?;
            std::fs::write(&path, &bytes)?;
            Ok(path.to_str().map(str::to_owned))
        })
        .await
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, bytes, name);
        Err(AppError::new(error::ErrorKind::Path, "not available here"))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The clock for PAPERWREN_TRACE starts here.
    trace::start();
    let builder = tauri::Builder::default();
    // First of all: a second start hands over and ends before anything
    // else of it runs.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(second_launch));
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());
    // Updates on a computer only, and only checked when the reader
    // allows it (the web layer asks first).
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    builder
        .manage(Waiting::at_launch())
        // The windows of the configuration exist by the time this runs.
        .setup(|_app| {
            trace::mark("window created");
            Ok(())
        })
        .on_page_load(|_webview, payload| match payload.event() {
            tauri::webview::PageLoadEvent::Started => trace::mark("page load started"),
            tauri::webview::PageLoadEvent::Finished => trace::mark("page load finished"),
        })
        .invoke_handler(tauri::generate_handler![
            store_get,
            store_set,
            imports_stats,
            imports_clear,
            imports_remove,
            imports_prune,
            list_folder,
            launch_files,
            open_external,
            reveal_in_folder,
            rename_file,
            save_as,
            trace_enabled,
            trace_mark
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

#[cfg(test)]
mod tests {
    use super::percent_decoded;

    #[test]
    fn names_in_headers_are_decoded() {
        assert_eq!(
            percent_decoded("R%C3%A9sum%C3%A9%20(signed).pdf").as_deref(),
            Some("Résumé (signed).pdf")
        );
        assert_eq!(percent_decoded("plain.pdf").as_deref(), Some("plain.pdf"));
        assert_eq!(percent_decoded("bad%2"), None);
        assert_eq!(percent_decoded("%FF%FE"), None);
    }
}
