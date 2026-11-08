//! A folder the reader chose to browse (Home, Add folder), listed in one
//! go: its documents, the sub-folder each was found in, and their sizes
//! and dates.
//!
//! The web layer used to list each sub-folder and then ask for every
//! file's size and date, one call each. The fs plugin runs those calls on
//! the main thread, which on Linux is the thread that draws the window:
//! a folder of a few hundred files froze the app while they queued
//! (#49). Here the walk is one command, run off the main thread, with
//! one answer.
//!
//! The walk is the one the web layer did: breadth first, hidden entries
//! skipped, links not followed (no loops), within the limits it is given.

use std::collections::VecDeque;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult, ErrorKind};

/// How far a walk goes: documents found, folders read, and depth.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Limits {
    pub files: usize,
    pub folders: usize,
    pub depth: usize,
}

impl Limits {
    /// Never more than this, whatever the web layer asks.
    const CAP: Limits = Limits {
        files: 10_000,
        folders: 2_000,
        depth: 16,
    };

    fn capped(self) -> Self {
        Self {
            files: self.files.min(Self::CAP.files),
            folders: self.folders.min(Self::CAP.folders),
            depth: self.depth.min(Self::CAP.depth),
        }
    }
}

/// A document found in the folder.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub path: String,
    pub name: String,
    /// The sub-folder it is in, inside the chosen one ("Taxes/2026"),
    /// "" at the top.
    pub folder: String,
    pub size: u64,
    /// Last changed, in milliseconds since 1970; 0 when unknown.
    pub modified: u64,
}

fn extension(name: &str) -> Option<String> {
    let dot = name.rfind('.')?;
    // ".pdf" alone is a hidden file's name, not an extension.
    (dot > 0).then(|| name[dot + 1..].to_ascii_lowercase())
}

/// The documents under `root` whose extension is one of `extensions`
/// (lowercase, without the dot). The chosen folder must be readable;
/// a deeper one that is not is passed over.
pub fn list(root: &Path, extensions: &[String], limits: Limits) -> AppResult<Vec<Found>> {
    if !root.is_absolute() {
        return Err(AppError::new(ErrorKind::Path, "path is not absolute"));
    }
    let limits = limits.capped();
    let mut found: Vec<Found> = Vec::new();
    let mut queue: VecDeque<(std::path::PathBuf, String, usize)> = VecDeque::new();
    queue.push_back((root.to_path_buf(), String::new(), 0));
    let mut visited = 0usize;
    let mut first = true;

    while let Some((dir, label, depth)) = queue.pop_front() {
        if found.len() >= limits.files || visited >= limits.folders {
            break;
        }
        visited += 1;
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(err) if first => return Err(err.into()),
            Err(_) => continue,
        };
        first = false;
        // In order of name, so a listing reads the same each time.
        let mut entries: Vec<fs::DirEntry> = entries.filter_map(Result::ok).collect();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue; // A name that is not text cannot be shown or opened.
            };
            if name.starts_with('.') {
                continue;
            }
            // The entry's own type: a link is neither, and is not followed.
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                if depth < limits.depth {
                    let sub = if label.is_empty() {
                        name.clone()
                    } else {
                        format!("{label}/{name}")
                    };
                    queue.push_back((entry.path(), sub, depth + 1));
                }
            } else if kind.is_file()
                && found.len() < limits.files
                && extension(&name).is_some_and(|ext| extensions.contains(&ext))
            {
                let Some(path) = entry.path().to_str().map(str::to_owned) else {
                    continue;
                };
                // Size and date are a nicety: a file that refuses them is
                // still listed.
                let meta = entry.metadata().ok();
                let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                let modified = meta
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                found.push(Found {
                    path,
                    name,
                    folder: label.clone(),
                    size,
                    modified,
                });
            }
        }
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A folder of its own under the system's temporary one.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "paperwren-folder-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn exts() -> Vec<String> {
        ["pdf", "docx", "txt"].iter().map(|s| s.to_string()).collect()
    }

    const ROOMY: Limits = Limits {
        files: 2000,
        folders: 400,
        depth: 4,
    };

    #[test]
    fn lists_documents_with_their_folder_size_and_date() {
        let root = scratch("basic");
        touch(&root.join("b.pdf"), b"12345");
        touch(&root.join("a.TXT"), b"1");
        touch(&root.join("song.mp3"), b"1");
        touch(&root.join(".hidden.pdf"), b"1");
        touch(&root.join(".git/x.pdf"), b"1");
        touch(&root.join("Taxes/2026/c.docx"), b"1");

        let found = list(&root, &exts(), ROOMY).unwrap();
        let names: Vec<(&str, &str)> = found
            .iter()
            .map(|f| (f.name.as_str(), f.folder.as_str()))
            .collect();
        assert_eq!(
            names,
            vec![("a.TXT", ""), ("b.pdf", ""), ("c.docx", "Taxes/2026")]
        );
        let b = found.iter().find(|f| f.name == "b.pdf").unwrap();
        assert_eq!(b.size, 5);
        assert!(b.modified > 0);
        assert!(Path::new(&b.path).is_absolute());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn keeps_within_its_limits() {
        let root = scratch("limits");
        for i in 0..10 {
            touch(&root.join(format!("{i}.pdf")), b"1");
        }
        touch(&root.join("one/two/deep.pdf"), b"1");
        let few = Limits {
            files: 3,
            folders: 400,
            depth: 4,
        };
        assert_eq!(list(&root, &exts(), few).unwrap().len(), 3);
        let shallow = Limits {
            files: 2000,
            folders: 400,
            depth: 1,
        };
        assert!(list(&root, &exts(), shallow)
            .unwrap()
            .iter()
            .all(|f| f.name != "deep.pdf"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_a_folder_it_cannot_read() {
        let missing = std::env::temp_dir().join("paperwren-folder-missing-xyz");
        let err = list(&missing, &exts(), ROOMY).unwrap_err();
        assert_eq!(err.kind, ErrorKind::NotFound);
        let err = list(Path::new("relative/dir"), &exts(), ROOMY).unwrap_err();
        assert_eq!(err.kind, ErrorKind::Path);
    }

    #[test]
    fn an_extension_needs_a_name_before_it() {
        assert_eq!(extension("Report.PDF").as_deref(), Some("pdf"));
        assert_eq!(extension("archive.tar.gz").as_deref(), Some("gz"));
        assert_eq!(extension(".pdf"), None);
        assert_eq!(extension("README"), None);
    }
}
