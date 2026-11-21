//! Paperwren core: storage for settings/recents and housekeeping for
//! managed "Open with" copies. Reading a whole file goes through the fs
//! plugin so one code path covers desktop paths and Android
//! `content://` URIs. A large PDF is read a piece at a time instead
//! (`read_file_range`), so it is never held whole in memory.
//!
//! Security boundary: the storage commands touch only two
//! directories the app owns (`app_data/store`, and `app_data/imports`
//! or, on Android, `files/imports`, where MainActivity writes copies)
//! and validate keys and relative paths before building a path.
//! The desktop hand-off commands (`open.rs`) are the one exception:
//! they take the absolute path of the user's document, and accept it
//! only if it is an existing file of a document type the app opens.
//! The two desktop writes (`save.rs`) are asked for by the reader: a
//! copy saved where the system's save dialog says, and a rename of the
//! document on show within its folder. Listing a folder the reader chose
//! (`folder.rs`) reads names, sizes and dates only, as the fs plugin's
//! read-dir and stat permissions already allow, in one call instead of
//! one per file. Reading a piece of a document (`read_file_range`,
//! `file_size`) takes, on a computer, the same validated document path
//! as the hand-offs; on a phone, only a managed copy inside the imports
//! directory, never another of the app's own files.
//!
//! On a computer none of these takes a path inside the app's own
//! folders (its data, settings, cache, and the webview's data there),
//! once links are resolved: the page has no business reading, listing
//! or renaming them as documents. Managed copies (imports) are the one
//! exception for reading and hand-offs: they are the reader's documents.
//! Folder listing and renaming are desktop commands; a phone answers
//! them with an error, as it does the other hand-offs.

mod error;
// On a phone only part of these is used: the rest are desktop commands.
#[cfg_attr(mobile, allow(dead_code))]
mod folder;
mod imports;
#[cfg_attr(mobile, allow(dead_code))]
mod open;
#[cfg(desktop)]
mod placement;
#[cfg_attr(mobile, allow(dead_code))]
mod save;
mod store;
mod trace;

#[cfg(desktop)]
use std::path::Path;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

use serde_json::Value;
use tauri::Manager;

use error::{AppError, AppResult};

/// Size cap for managed copies before the oldest are evicted.
const IMPORTS_MAX_BYTES: u64 = 250 * 1024 * 1024;

/// The most one `read_file_range` call answers with. pdf.js asks for a
/// few 64 KiB pieces at a time; a bound here means no request can make
/// the app hold a large file whole.
const RANGE_MAX_BYTES: u32 = 4 * 1024 * 1024;

/// The largest copy `save_as` writes. What the app makes (a filled-in
/// form, pages put together) is far smaller; the bound keeps a page from
/// asking for a write of any size.
#[cfg(desktop)]
const SAVE_MAX_BYTES: usize = 512 * 1024 * 1024;

/// The error a phone gives for a command only a computer has.
#[cfg(not(desktop))]
fn desktop_only() -> AppError {
    AppError::new(error::ErrorKind::Path, "not available on mobile")
}

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

/// Where the managed copies live. On Android, MainActivity writes them
/// to `Context.filesDir/imports`, and `filesDir` is `<dataDir>/files`,
/// while Tauri's `app_data_dir()` there is `<dataDir>` itself. Looking
/// in `app_data_dir()/imports` found nothing, so copies were never
/// pruned, removed or cleared and the app's data grew without bound.
#[cfg(target_os = "android")]
fn imports_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    Ok(app.path().app_data_dir()?.join("files").join("imports"))
}

#[cfg(not(target_os = "android"))]
fn imports_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    data_dir(app, "imports")
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
    let root = imports_dir(&app)?;
    blocking(move || Ok(imports::stats(&root))).await
}

#[tauri::command]
async fn imports_clear(app: tauri::AppHandle) -> AppResult<()> {
    let root = imports_dir(&app)?;
    blocking(move || imports::clear(&root)).await
}

#[tauri::command]
async fn imports_remove(app: tauri::AppHandle, paths: Vec<String>) -> AppResult<u64> {
    let root = imports_dir(&app)?;
    blocking(move || Ok(imports::remove(&root, &paths))).await
}

/// `keep` lists the managed copies still referenced by recents,
/// relative to the imports directory.
#[tauri::command]
async fn imports_prune(
    app: tauri::AppHandle,
    keep: Vec<String>,
) -> AppResult<imports::PruneReport> {
    let root = imports_dir(&app)?;
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

/// The app's own folders, as the file system writes them once links are
/// resolved, so a resolved path can be compared with them. Found once:
/// they do not move while the app runs.
#[cfg(desktop)]
struct Private {
    /// Data, local data (on Windows the webview's data is in it, under
    /// EBWebView), settings, cache; on macOS the webview's data too.
    dirs: Vec<PathBuf>,
    /// The managed copies, inside the data folder.
    imports: Option<PathBuf>,
}

#[cfg(desktop)]
fn private_dirs(app: &tauri::AppHandle) -> &'static Private {
    static PRIVATE: std::sync::OnceLock<Private> = std::sync::OnceLock::new();
    PRIVATE.get_or_init(|| {
        let paths = app.path();
        #[allow(unused_mut)]
        let mut wanted: Vec<PathBuf> = [
            paths.app_data_dir(),
            paths.app_local_data_dir(),
            paths.app_config_dir(),
            paths.app_cache_dir(),
        ]
        .into_iter()
        .flatten()
        .collect();
        #[cfg(target_os = "macos")]
        if let Ok(home) = paths.home_dir() {
            wanted.push(
                home.join("Library")
                    .join("WebKit")
                    .join(&app.config().identifier),
            );
        }
        let mut dirs: Vec<PathBuf> = Vec::new();
        for dir in wanted.iter().filter_map(|d| resolved(d)) {
            if !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }
        let imports = imports_dir(app).ok().and_then(|d| resolved(&d));
        Private { dirs, imports }
    })
}

/// `dir` once links are resolved, or, while it is not made yet, its
/// parent's resolved form with its name: a folder made later still
/// compares the same.
#[cfg(desktop)]
fn resolved(dir: &Path) -> Option<PathBuf> {
    dir.canonicalize().ok().or_else(|| {
        let parent = dir.parent()?.canonicalize().ok()?;
        Some(parent.join(dir.file_name()?))
    })
}

/// Whether the resolved path `real` is one of the app's own files (or
/// folders). A managed copy counts as the reader's when `copies` says so.
#[cfg(desktop)]
fn is_private(real: &Path, private: &Private, copies: bool) -> bool {
    if copies {
        if let Some(imports) = &private.imports {
            if real.starts_with(imports) {
                return false;
            }
        }
    }
    private.dirs.iter().any(|dir| real.starts_with(dir))
}

/// An error for a path inside the app's own folders (`is_private`).
#[cfg(desktop)]
fn not_private(app: &tauri::AppHandle, real: &Path, copies: bool) -> AppResult<()> {
    if is_private(real, private_dirs(app), copies) {
        return Err(AppError::new(
            error::ErrorKind::Path,
            "that is one of the app's own files",
        ));
    }
    Ok(())
}

/// The documents in a folder the reader chose to browse, with the
/// sub-folder each is in and its size and date: one answer, read off the
/// main thread (folder.rs). `extensions` are the types the app opens:
/// any other the page names is dropped. A computer only: a phone lists
/// a folder through MainActivity.
#[tauri::command]
async fn list_folder(
    app: tauri::AppHandle,
    path: String,
    extensions: Vec<String>,
    limits: folder::Limits,
) -> AppResult<Vec<folder::Found>> {
    #[cfg(desktop)]
    {
        let extensions: std::collections::HashSet<String> = extensions
            .into_iter()
            .take(500)
            .map(|e| e.to_ascii_lowercase())
            .filter(|e| open::is_allowed_extension(e))
            .collect();
        blocking(move || {
            let root = PathBuf::from(path);
            if !root.is_absolute() {
                return Err(AppError::new(
                    error::ErrorKind::Path,
                    "path is not absolute",
                ));
            }
            if !open::on_this_computer(&root) {
                return Err(AppError::new(
                    error::ErrorKind::Path,
                    "not a path on this computer",
                ));
            }
            not_private(&app, &root.canonicalize()?, false)?;
            folder::list(&root, &extensions, limits)
        })
        .await
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, path, extensions, limits);
        Err(desktop_only())
    }
}

/// A document the page may read a piece of. On a computer it is the
/// reader's own document: an absolute path to an existing file of a
/// type the app opens (open.rs), not one of the app's own files. On a
/// phone the page reads only managed copies this way (a `content://`
/// document goes through MainActivity), so only a file inside the
/// imports directory, once links are resolved, is accepted. It touches
/// the disk: call it inside `blocking`. Answers the resolved path, so
/// the file read is the one checked.
fn readable(app: &tauri::AppHandle, path: &str) -> AppResult<PathBuf> {
    #[cfg(desktop)]
    {
        let found = open::checked(path)?;
        not_private(app, &found.real, true)?;
        Ok(found.real)
    }
    #[cfg(not(desktop))]
    {
        let root = imports_dir(app)?.canonicalize()?;
        let file = PathBuf::from(path).canonicalize()?;
        if !file.starts_with(&root) || !file.is_file() {
            return Err(AppError::new(error::ErrorKind::Path, "not a managed copy"));
        }
        Ok(file)
    }
}

/// Up to `length` bytes of a document from `offset`, as raw bytes (no
/// JSON). Fewer at the end of the file, none past it. pdf.js reads a
/// large PDF this way: the pages it draws, and little else. The path is
/// checked off the async workers too: resolving it is a call to the
/// disk, made once for each piece.
#[tauri::command]
async fn read_file_range(
    app: tauri::AppHandle,
    path: String,
    offset: u64,
    length: u32,
) -> AppResult<tauri::ipc::Response> {
    let length = u64::from(length.min(RANGE_MAX_BYTES));
    let bytes = blocking(move || {
        use std::io::{Read, Seek, SeekFrom};
        let target = readable(&app, &path)?;
        let mut file = std::fs::File::open(&target)?;
        file.seek(SeekFrom::Start(offset))?;
        let mut buf = Vec::with_capacity(length as usize);
        file.take(length).read_to_end(&mut buf)?;
        Ok(buf)
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// The size of a document `read_file_range` may read.
#[tauri::command]
async fn file_size(app: tauri::AppHandle, path: String) -> AppResult<u64> {
    blocking(move || {
        let target = readable(&app, &path)?;
        Ok(std::fs::metadata(&target)?.len())
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

/// Open a document in the system's default app for its type. The
/// checks touch the disk, so they run off the async workers with the
/// hand-off itself.
#[tauri::command]
async fn open_external(app: tauri::AppHandle, path: String) -> AppResult<()> {
    #[cfg(desktop)]
    {
        blocking(move || {
            let found = open::checked_for_hand_off(&path)?;
            not_private(&app, &found.real, true)?;
            Ok(open::open_with_default(&found.path)?)
        })
        .await
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, path);
        Err(desktop_only())
    }
}

/// Show a document in the system file manager.
#[tauri::command]
async fn reveal_in_folder(app: tauri::AppHandle, path: String) -> AppResult<()> {
    #[cfg(desktop)]
    {
        blocking(move || {
            let found = open::checked(&path)?;
            not_private(&app, &found.real, true)?;
            Ok(open::reveal(&found.path)?)
        })
        .await
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, path);
        Err(desktop_only())
    }
}

/// Rename the document on show, in its folder; returns its new path.
/// Neither the document nor the folder it is in may be one of the app's
/// own. A computer only: a phone renames through MainActivity.
#[tauri::command]
async fn rename_file(app: tauri::AppHandle, path: String, name: String) -> AppResult<String> {
    #[cfg(desktop)]
    {
        blocking(move || {
            let found = open::checked(&path)?;
            not_private(&app, &found.real, false)?;
            if let Some(folder) = found.path.parent() {
                not_private(&app, &folder.canonicalize()?, false)?;
            }
            let to = save::rename(&path, &name)?;
            to.to_str()
                .map(str::to_owned)
                .ok_or_else(|| AppError::new(error::ErrorKind::Path, "path is not text"))
        })
        .await
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, path, name);
        Err(desktop_only())
    }
}

/// `%XX`-encoded text (the name travels in a header), decoded.
#[cfg_attr(mobile, allow(dead_code))]
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
///
/// The body is lent to the command by the IPC layer (`Request` holds
/// only a reference) and cannot be moved out of it, while work sent to
/// another thread must own what it uses. So the dialog runs off the
/// async workers (it waits for the reader), and the bytes are written
/// from the lent body on this task once a place is picked: a 300 MB
/// copy used to be cloned whole, held twice, before the dialog even
/// opened. The write holds one async worker for as long as the disk
/// takes; the others go on answering. It goes to a file beside the
/// chosen one first, then takes its name (save::write_copy).
#[tauri::command]
async fn save_as(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> AppResult<Option<String>> {
    #[cfg(desktop)]
    {
        let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
            return Err(AppError::new(
                error::ErrorKind::Io,
                "expected the file's bytes",
            ));
        };
        if bytes.len() > SAVE_MAX_BYTES {
            return Err(AppError::new(
                error::ErrorKind::Io,
                "the copy is too large to save",
            ));
        }
        let name = request
            .headers()
            .get("x-name")
            .and_then(|v| v.to_str().ok())
            .and_then(percent_decoded)
            .and_then(|n| save::valid_name(&n).ok())
            .unwrap_or_else(|| "Untitled".to_owned());
        // The files the reader has open: a copy never goes over one of them.
        let open = request
            .headers()
            .get("x-open")
            .and_then(|v| v.to_str().ok())
            .and_then(percent_decoded)
            .map(|list| save::open_paths(&list))
            .unwrap_or_default();
        use tauri_plugin_dialog::DialogExt;
        let mut dialog = app.dialog().file().set_file_name(&name);
        if let Some(ext) = save::extension_of(&name) {
            dialog = dialog.add_filter(ext.to_uppercase(), &[ext.as_str()]);
        }
        let picked = blocking(move || {
            let Some(picked) = dialog.blocking_save_file() else {
                return Ok(None);
            };
            let path = picked
                .into_path()
                .map_err(|e| AppError::new(error::ErrorKind::Path, e.to_string()))?;
            // The opened file is never changed: the reader is told, and
            // asked again.
            if save::is_open(&path, &open) {
                return Err(AppError::new(
                    error::ErrorKind::IsOpen,
                    "that is a file you have open",
                ));
            }
            Ok(Some(path))
        })
        .await?;
        let Some(path) = picked else {
            return Ok(None);
        };
        save::write_copy(&path, bytes)?;
        Ok(path.to_str().map(str::to_owned))
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, request);
        Err(desktop_only())
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
        // On a computer the window starts hidden: it is put back where it
        // was left, then shown (placement.rs).
        .setup(|_app| {
            trace::mark("window created");
            #[cfg(desktop)]
            if let Some(window) = _app.get_webview_window("main") {
                let store = data_dir(_app.handle(), "store").ok();
                placement::open(&window, store.as_deref());
                trace::mark("window shown");
                // On Windows, minimizing a window leaves WebView2 visible, so
                // Chromium keeps document.visibilityState == "visible" and runs
                // timers/compositing in the background. Hiding only the child
                // webview signals SetIsVisible(false) without hiding the window.
                #[cfg(windows)]
                {
                    let hidden = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                    let wv = window.clone();
                    window.on_window_event(move |event| {
                        use std::sync::atomic::Ordering;
                        match event {
                            tauri::WindowEvent::Resized(size) => {
                                // Frameless Windows windows (`decorations: false`) report
                                // their iconic strip size (e.g. 159x27) instead of 0x0 on
                                // minimize, both well below the 360x480 minimum window size.
                                let minimized = size.width <= 300
                                    && size.height <= 100
                                    && wv.is_minimized().unwrap_or(false);
                                if minimized {
                                    if !hidden.swap(true, Ordering::AcqRel) {
                                        let _ = AsRef::<tauri::Webview<_>>::as_ref(&wv).hide();
                                    }
                                } else if hidden.load(Ordering::Acquire)
                                    && !wv.is_minimized().unwrap_or(false)
                                    && hidden.swap(false, Ordering::AcqRel)
                                {
                                    let _ = AsRef::<tauri::Webview<_>>::as_ref(&wv).show();
                                }
                            }
                            tauri::WindowEvent::Focused(true)
                                if hidden.load(Ordering::Acquire)
                                    && !wv.is_minimized().unwrap_or(false)
                                    && hidden.swap(false, Ordering::AcqRel) =>
                            {
                                let _ = AsRef::<tauri::Webview<_>>::as_ref(&wv).show();
                            }
                            _ => {}
                        }
                    });
                }
            }
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
            read_file_range,
            file_size,
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

    #[cfg(desktop)]
    #[test]
    fn the_apps_own_folders_are_not_documents() {
        use super::{is_private, resolved, Private};
        use std::fs;

        let root = std::env::temp_dir().join(format!("paperwren-private-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let data = root.join("app.data");
        fs::create_dir_all(data.join("store")).unwrap();
        fs::create_dir_all(data.join("imports").join("ab12")).unwrap();
        fs::create_dir_all(root.join("app.data2")).unwrap();
        fs::create_dir_all(root.join("Documents")).unwrap();
        for file in [
            "app.data/store/settings_v2.json",
            "app.data/imports/ab12/copy.pdf",
            "app.data2/near.pdf",
            "Documents/report.pdf",
        ] {
            fs::write(root.join(file), b"x").unwrap();
        }
        let private = Private {
            // A cache folder not made yet still counts.
            dirs: vec![
                resolved(&data).unwrap(),
                resolved(&root.join("app.cache")).unwrap(),
            ],
            imports: resolved(&data.join("imports")),
        };
        let real = |p: &str| root.join(p).canonicalize().unwrap();

        let store = real("app.data/store/settings_v2.json");
        assert!(is_private(&store, &private, true));
        assert!(is_private(&real("app.data"), &private, false));
        // A managed copy is the reader's to read, never to list or rename.
        let copy = real("app.data/imports/ab12/copy.pdf");
        assert!(!is_private(&copy, &private, true));
        assert!(is_private(&copy, &private, false));
        // A folder whose name only begins the same is not inside.
        assert!(!is_private(&real("app.data2/near.pdf"), &private, true));
        assert!(!is_private(&real("Documents/report.pdf"), &private, false));
        // The cache, made after the folders were found.
        fs::create_dir_all(root.join("app.cache")).unwrap();
        fs::write(root.join("app.cache/x.json"), b"x").unwrap();
        assert!(is_private(&real("app.cache/x.json"), &private, true));
        let _ = fs::remove_dir_all(&root);
    }
}
