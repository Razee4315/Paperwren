//! Desktop hand-offs: files the app was launched with ("Open with
//! Paperwren", a double-clicked document), and handing a document to
//! the system's default app or file manager.
//!
//! These are the only commands that touch a path the user's document
//! lives at. Each one validates that the path is an absolute path to
//! an existing file of a document type Paperwren opens, so a
//! compromised page cannot use them to launch arbitrary programs.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult, ErrorKind};

/// Extensions of the documents Paperwren opens (lowercase).
pub const DOCUMENT_EXTENSIONS: &[&str] = &[
    "pdf", "docx", "docm", "dotx", "doc", "odt", "rtf", "xlsx", "xlsm", "xlsb", "xltx", "xls",
    "ods", "csv", "tsv", "pptx", "pptm", "ppsx", "ppt", "pps", "odp", "md", "markdown", "txt",
    "text", "log", "json", "xml", "yml", "yaml", "ini", "png", "jpg", "jpeg", "gif", "webp", "bmp",
];

/// True when the path's extension is a document type we open.
pub fn is_document(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let lower = e.to_ascii_lowercase();
            DOCUMENT_EXTENSIONS.contains(&lower.as_str())
        })
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

/// The documents named on the command line, in order. A file manager
/// passes the double-clicked file as the first argument.
pub fn launch_files<I, S>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    args.into_iter()
        .filter_map(|arg| {
            let text = arg.as_ref().to_str()?.to_owned();
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
        assert!(!is_document(Path::new("setup.exe")));
        assert!(!is_document(Path::new("script.bat")));
        assert!(!is_document(Path::new("no-extension")));
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
}
