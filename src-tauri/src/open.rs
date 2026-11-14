//! Desktop hand-offs: files the app was launched with ("Open with
//! Paperwren", a double-clicked document), files macOS asks a running
//! app to open, and handing a document to the system's default app or
//! file manager.
//!
//! These are the only commands that touch a path the user's document
//! lives at. Each one validates that the path is an absolute path to
//! an existing file of a document type Paperwren opens, so a
//! compromised page cannot use them to launch arbitrary programs.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult, ErrorKind};

/// Extensions of the documents Paperwren opens (lowercase).
pub const DOCUMENT_EXTENSIONS: &[&str] = &[
    "pdf", "docx", "docm", "dotx", "doc", "odt", "rtf", "epub", "xlsx", "xlsm", "xlsb", "xltx",
    "xls", "ods", "csv", "tsv", "pptx", "pptm", "ppsx", "ppt", "pps", "odp", "md", "markdown",
    "txt", "text", "log", "json", "xml", "yml", "yaml", "ini", "png", "jpg", "jpeg", "gif", "webp",
    "bmp", "svg", "avif", "heic", "heif", "tif", "tiff", "cbz", "jsx", "ts", "tsx", "go", "rs",
    "java", "kt", "kts", "swift", "c", "h", "cpp", "cc", "hpp", "cs", "sql", "css", "scss", "less",
    "html", "htm", "vue", "toml", "gradle", "dart", "diff", "patch", "properties", "conf", "cfg",
    "env", "csproj", "plist", "vcf", "glb",
];

/// Source code a system may run when it is opened with its default app
/// (a script): Paperwren shows it, but never hands it on to be opened.
pub const SCRIPT_EXTENSIONS: &[&str] = &[
    "js", "mjs", "cjs", "py", "rb", "pl", "php", "sh", "bash", "zsh", "ps1", "bat", "lua", "r",
];

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
}

/// True when the path's extension is a document type we open.
pub fn is_document(path: &Path) -> bool {
    extension(path)
        .map(|e| {
            DOCUMENT_EXTENSIONS.contains(&e.as_str()) || SCRIPT_EXTENSIONS.contains(&e.as_str())
        })
        .unwrap_or(false)
}

/// True when the system's default app may be asked to open the path:
/// a document, never a script it might run.
pub fn may_hand_off(path: &Path) -> bool {
    extension(path)
        .map(|e| DOCUMENT_EXTENSIONS.contains(&e.as_str()))
        .unwrap_or(false)
}

/// An absolute path to an existing document, or an error.
pub fn validated(path: &str) -> AppResult<PathBuf> {
    let candidate = PathBuf::from(path);
    if !candidate.is_absolute() {
        return Err(AppError::new(ErrorKind::Path, "path is not absolute"));
    }
    if !is_document(&candidate) {
        return Err(AppError::new(ErrorKind::Path, "not a document type"));
    }
    if !candidate.is_file() {
        return Err(AppError::new(ErrorKind::NotFound, "no such file"));
    }
    Ok(candidate)
}

/// An existing document that may be handed to the system's default app.
pub fn validated_for_hand_off(path: &str) -> AppResult<PathBuf> {
    let target = validated(path)?;
    if !may_hand_off(&target) {
        return Err(AppError::new(ErrorKind::Path, "a script is not handed on"));
    }
    Ok(target)
}

/// The documents named on the command line, in order. A file manager
/// passes the double-clicked file as the first argument.
pub fn launch_files<I, S>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let cwd = std::env::current_dir().unwrap_or_default();
    launch_files_in(args, &cwd)
}

/// The documents among `args`, a name without a folder read from `cwd`
/// (where the program was started: a second start passes its own).
pub fn launch_files_in<I, S>(args: I, cwd: &Path) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    args.into_iter()
        .filter_map(|arg| {
            let text = arg.as_ref().to_str()?;
            if text.starts_with('-') {
                return None;
            }
            let path = Path::new(text);
            let full = if path.is_absolute() || cwd.as_os_str().is_empty() {
                path.to_path_buf()
            } else {
                cwd.join(path)
            };
            let full = full.to_str()?.to_owned();
            validated(&full).ok().map(|_| full)
        })
        .collect()
}

/// The documents among the URLs macOS asked the app to open. Finder
/// does not put a double-clicked file on the command line: it sends
/// the app an open event, at launch and while it is running.
#[cfg(target_os = "macos")]
pub fn opened_files(urls: &[tauri::Url]) -> Vec<String> {
    urls.iter()
        .filter(|url| url.scheme() == "file")
        .filter_map(|url| url.to_file_path().ok())
        .filter_map(|path| {
            let text = path.to_str()?.to_owned();
            validated(&text).ok().map(|_| text)
        })
        .collect()
}

/// Open the document in the system's default app for its type.
#[cfg(desktop)]
pub fn open_with_default(path: &Path) -> std::io::Result<()> {
    use std::process::Command;
    #[cfg(target_os = "windows")]
    {
        // explorer hands the file to its registered app; unlike
        // `cmd /C start` it needs no shell quoting.
        Command::new("explorer").arg(path).spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(path).spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(path).spawn()?;
    }
    Ok(())
}

/// Show the document, selected, in the system file manager.
#[cfg(desktop)]
pub fn reveal(path: &Path) -> std::io::Result<()> {
    use std::process::Command;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // explorer parses "/select," itself; pass the argument verbatim.
        Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", path.display()))
            .spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg("-R").arg(path).spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let folder = path.parent().unwrap_or(path);
        Command::new("xdg-open").arg(folder).spawn()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_document_types_case_insensitively() {
        assert!(is_document(Path::new("/tmp/Report.PDF")));
        assert!(is_document(Path::new("notes.md")));
        assert!(is_document(Path::new("book.EPUB")));
        assert!(is_document(Path::new("scan.tiff")));
        assert!(!is_document(Path::new("setup.exe")));
        assert!(!is_document(Path::new("setup.msi")));
        assert!(!is_document(Path::new("no-extension")));
    }

    #[test]
    fn shows_a_script_but_never_hands_it_on() {
        // Read as text in the app...
        assert!(is_document(Path::new("script.bat")));
        assert!(is_document(Path::new("tool.PS1")));
        assert!(is_document(Path::new("app.py")));
        // ...but never opened with what might run it.
        for script in ["script.bat", "tool.PS1", "app.py", "run.sh", "main.js"] {
            assert!(!may_hand_off(Path::new(script)), "{script}");
        }
        assert!(may_hand_off(Path::new("report.pdf")));
        assert!(may_hand_off(Path::new("main.rs")));
    }

    #[test]
    fn refuses_relative_paths_and_non_documents() {
        assert!(validated("relative/file.pdf").is_err());
        let exe = std::env::current_exe().expect("test binary path");
        assert!(validated(exe.to_str().expect("utf-8 path")).is_err());
    }

    #[test]
    fn accepts_an_existing_document() {
        let dir = std::env::temp_dir().join(format!("paperwren-open-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let file = dir.join("sample.txt");
        std::fs::write(&file, b"hello").expect("write");
        let text = file.to_str().expect("utf-8 path");
        assert!(validated(text).is_ok());
        assert!(validated(dir.join("missing.txt").to_str().expect("utf-8")).is_err());
        // Only real documents among the launch arguments survive.
        let found = launch_files(["--flag", text, "relative.pdf"]);
        assert_eq!(found, vec![text.to_owned()]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_second_start_names_its_documents_from_where_it_was_started() {
        let dir = std::env::temp_dir().join(format!("paperwren-second-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        std::fs::write(dir.join("notes.txt"), b"hello").expect("write");
        let full = dir.join("notes.txt").to_str().expect("utf-8").to_owned();
        // A file manager passes the whole path; a shell may pass only the
        // name, read from the folder the second start ran in.
        let found = launch_files_in(["notes.txt", "-psn_0_1", "missing.txt"], &dir);
        assert_eq!(found, vec![full.clone()]);
        let whole = launch_files_in([full.as_str()], Path::new(""));
        assert_eq!(whole, vec![full.clone()]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn takes_only_documents_from_open_events() {
        let dir = std::env::temp_dir().join(format!("paperwren-opened-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let file = dir.join("a report.txt");
        std::fs::write(&file, b"hello").expect("write");
        let url = |path: &Path| tauri::Url::from_file_path(path).expect("file url");
        let urls = [
            url(&file),
            url(&dir.join("missing.pdf")),
            url(&std::env::current_exe().expect("test binary path")),
            tauri::Url::parse("https://example.com/remote.pdf").expect("url"),
        ];
        // The space in the name comes back out of the URL's %20.
        assert_eq!(
            opened_files(&urls),
            vec![file.to_str().expect("utf-8").to_owned()]
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
