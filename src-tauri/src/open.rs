//! Desktop hand-offs: files the app was launched with ("Open with
//! Paperwren", a double-clicked document), files macOS asks a running
//! app to open, and handing a document to the system's default app or
//! file manager.
//!
//! These are the only commands that touch a path the user's document
//! lives at. Each one validates that the path is an absolute path to
//! an existing file of a document type Paperwren opens, so a
//! compromised page cannot use them to launch arbitrary programs. The
//! type is checked on the path as given and again once links are
//! resolved: a link named `doc.pdf` that leads to a program, or to a
//! file of no document type, is refused. On Windows only a path on a
//! drive of this computer is taken: a `\\server\share` path would make
//! the system connect to that server, and sign in to it, before any
//! check could look at the file.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult, ErrorKind};

/// Extensions of the documents Paperwren opens (lowercase).
pub const DOCUMENT_EXTENSIONS: &[&str] = &[
    "pdf", "docx", "docm", "dotx", "doc", "odt", "rtf", "epub", "xlsx", "xlsm", "xlsb", "xltx",
    "xls", "ods", "csv", "tsv", "pptx", "pptm", "ppsx", "ppt", "pps", "odp", "md", "markdown",
    "txt", "text", "log", "json", "xml", "yml", "yaml", "ini", "png", "jpg", "jpeg", "gif", "webp",
    "bmp", "svg", "avif", "heic", "heif", "tif", "tiff", "cbz", "jsx", "ts", "tsx", "go", "rs",
    "java", "kt", "swift", "c", "h", "cpp", "cc", "hpp", "cs", "sql", "css", "scss", "less", "html",
    "htm", "vue", "toml", "gradle", "dart", "diff", "patch", "properties", "conf", "cfg", "env",
    "csproj", "plist", "vcf", "glb",
];

/// Source code a system may run when it is opened with its default app
/// (a script): Paperwren shows it, but never hands it on to be opened.
/// A Kotlin script (`kts`) runs with `kotlinc -script` where that is the
/// default app.
pub const SCRIPT_EXTENSIONS: &[&str] = &[
    "js", "mjs", "cjs", "py", "rb", "pl", "php", "sh", "bash", "zsh", "ps1", "bat", "lua", "r",
    "kts",
];

/// Documents Paperwren reads but never hands to the system's default
/// app: that is a browser, and a page or an SVG picture runs its own
/// script there, with the browser's access to local files.
const NOT_HANDED_OFF: &[&str] = &["html", "htm", "svg"];

/// The path's extension, lowercase.
pub fn extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
}

/// True for an extension (without the dot, any case) of a document or
/// script Paperwren opens.
pub fn is_allowed_extension(ext: &str) -> bool {
    let ext = ext.to_ascii_lowercase();
    DOCUMENT_EXTENSIONS.contains(&ext.as_str()) || SCRIPT_EXTENSIONS.contains(&ext.as_str())
}

/// True for the extension (without the dot, any case) of a script.
pub fn is_script_extension(ext: &str) -> bool {
    SCRIPT_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str())
}

/// True when the path's extension is a document type we open.
pub fn is_document(path: &Path) -> bool {
    extension(path).is_some_and(|e| is_allowed_extension(&e))
}

/// True when the system's default app may be asked to open the path:
/// a document, never a script it might run, nor a page or picture that
/// runs script in a browser.
pub fn may_hand_off(path: &Path) -> bool {
    extension(path).is_some_and(|e| {
        DOCUMENT_EXTENSIONS.contains(&e.as_str()) && !NOT_HANDED_OFF.contains(&e.as_str())
    })
}

/// True when `path` is on a drive of this computer: on Windows, a drive
/// letter (`C:\`, `\\?\C:\`), never a share on another computer
/// (`\\server\share`, `\\?\UNC\`) or a device (`\\.\pipe\`). Read
/// from the path's text alone, so nothing is reached to decide it.
/// Elsewhere a network folder is mounted into the tree, and the system
/// has signed in to it already.
pub fn on_this_computer(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        match path.components().next() {
            Some(Component::Prefix(prefix)) => {
                matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
            }
            _ => false,
        }
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        true
    }
}

/// A document's path, checked: as the caller wrote it (`path`), and
/// where it is once every link is resolved (`real`).
#[derive(Debug)]
pub struct Checked {
    pub path: PathBuf,
    pub real: PathBuf,
}

/// An absolute path to an existing document, checked as given and once
/// resolved, or an error. What costs nothing (the path's form and type)
/// is checked before the file system is asked anything.
pub fn checked(path: &str) -> AppResult<Checked> {
    let candidate = PathBuf::from(path);
    if !candidate.is_absolute() {
        return Err(AppError::new(ErrorKind::Path, "path is not absolute"));
    }
    if !on_this_computer(&candidate) {
        return Err(AppError::new(
            ErrorKind::Path,
            "not a path on this computer",
        ));
    }
    if !is_document(&candidate) {
        return Err(AppError::new(ErrorKind::Path, "not a document type"));
    }
    let real = std::fs::canonicalize(&candidate)?;
    if !real.is_file() {
        return Err(AppError::new(ErrorKind::NotFound, "no such file"));
    }
    if !is_document(&real) {
        return Err(AppError::new(ErrorKind::Path, "not a document type"));
    }
    Ok(Checked {
        path: candidate,
        real,
    })
}

/// An absolute path to an existing document (as given), or an error.
pub fn validated(path: &str) -> AppResult<PathBuf> {
    checked(path).map(|found| found.path)
}

/// An existing document that may be handed to the system's default app,
/// by its own name and by the name of the file it leads to.
pub fn checked_for_hand_off(path: &str) -> AppResult<Checked> {
    let found = checked(path)?;
    if !may_hand_off(&found.path) || !may_hand_off(&found.real) {
        return Err(AppError::new(ErrorKind::Path, "a script is not handed on"));
    }
    Ok(found)
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
    fn a_kotlin_script_is_a_script() {
        assert!(is_document(Path::new("build.gradle.kts")));
        assert!(is_script_extension("KTS"));
        assert!(!DOCUMENT_EXTENSIONS.contains(&"kts"));
        assert!(!may_hand_off(Path::new("build.gradle.kts")));
        assert!(may_hand_off(Path::new("Main.kt")));
    }

    #[test]
    fn pages_and_svg_are_read_but_not_handed_to_a_browser() {
        for page in ["index.html", "page.HTM", "logo.svg"] {
            assert!(is_document(Path::new(page)), "{page}");
            assert!(!may_hand_off(Path::new(page)), "{page}");
        }
        assert!(may_hand_off(Path::new("photo.png")));
    }

    #[test]
    fn extensions_are_checked_in_any_case() {
        assert!(is_allowed_extension("PDF"));
        assert!(is_allowed_extension("ps1"));
        assert!(!is_allowed_extension("exe"));
        assert!(!is_allowed_extension(""));
        assert!(is_script_extension("Bat"));
        assert!(!is_script_extension("txt"));
    }

    #[cfg(windows)]
    #[test]
    fn a_path_on_another_computer_is_refused_before_it_is_reached() {
        for remote in [
            r"\\server\share\report.pdf",
            r"//server/share/report.pdf",
            r"\\?\UNC\server\share\report.pdf",
            r"\\.\pipe\report.pdf",
        ] {
            assert!(!on_this_computer(Path::new(remote)), "{remote}");
            let err = validated(remote).unwrap_err();
            assert_eq!(err.kind, ErrorKind::Path, "{remote}");
        }
        assert!(on_this_computer(Path::new(r"C:\Users\report.pdf")));
        assert!(on_this_computer(Path::new(r"\\?\C:\Users\report.pdf")));

        // A drive path written the long way still opens.
        let dir = std::env::temp_dir().join(format!("paperwren-verbatim-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let file = dir.join("long.txt");
        std::fs::write(&file, b"hello").expect("write");
        let canonical = file.canonicalize().expect("canonical");
        assert!(validated(canonical.to_str().expect("utf-8")).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn a_link_is_judged_by_the_file_it_leads_to() {
        use std::os::unix::fs::symlink;
        let dir = std::env::temp_dir().join(format!("paperwren-links-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        let secret = dir.join("passwd");
        let script = dir.join("evil.sh");
        let report = dir.join("report.pdf");
        std::fs::write(&secret, b"root:x:0:0").expect("write");
        std::fs::write(&script, b"#!/bin/sh").expect("write");
        std::fs::write(&report, b"%PDF-1.4").expect("write");
        let to_secret = dir.join("doc.pdf");
        let to_script = dir.join("run.pdf");
        let to_report = dir.join("same.pdf");
        symlink(&secret, &to_secret).expect("link");
        symlink(&script, &to_script).expect("link");
        symlink(&report, &to_report).expect("link");
        let text = |p: &Path| p.to_str().expect("utf-8").to_owned();

        // Leads to a file of no document type.
        assert_eq!(
            validated(&text(&to_secret)).unwrap_err().kind,
            ErrorKind::Path
        );
        // Leads to a script: shown, never handed on.
        assert!(validated(&text(&to_script)).is_ok());
        assert!(checked_for_hand_off(&text(&to_script)).is_err());
        // Leads to a document: accepted, under the name it was given.
        assert_eq!(validated(&text(&to_report)).unwrap(), to_report);
        let found = checked_for_hand_off(&text(&to_report)).unwrap();
        assert_eq!(found.real, report.canonicalize().unwrap());
        std::fs::remove_dir_all(&dir).ok();
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
