//! Managed copies of files that arrived through Android "Open with".
//!
//! Layout: `imports/<content-hash>/<display name>` (the Android layer
//! names the folder after a hash of the bytes, so two different files
//! that share a name never collide). Older builds wrote flat
//! `imports/<display name>` files; both shapes are handled.
//!
//! Every function takes the root directory explicitly and accepts
//! only relative paths of at most two plain components, so nothing
//! here can be steered outside the imports directory.

use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::error::{AppError, AppResult, ErrorKind};

/// Half-written copies (dot-prefixed temp files) older than this are
/// leftovers from a killed ingest and are swept by `prune`.
const STALE_TEMP: Duration = Duration::from_secs(24 * 60 * 60);

/// A copy this new may be a file that is being opened right now: the
/// Android layer copies it in before the web layer has recorded it, so
/// it is in no recents list yet. `prune` leaves it for a later run.
const FRESH_COPY: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
pub struct Stats {
    pub bytes: u64,
    pub files: u64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneReport {
    /// Unreferenced copies deleted.
    pub orphans_removed: u64,
    /// Referenced copies evicted to get under the size cap, oldest
    /// first. The frontend marks their recents unavailable.
    pub evicted: Vec<String>,
    pub bytes_after: u64,
}

struct Entry {
    rel: String,
    path: PathBuf,
    bytes: u64,
    modified: SystemTime,
}

fn is_plain_name(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('.') && !name.contains(['/', '\\', '\0']) && name != ".."
}

/// Validate a relative path: one or two plain components.
pub fn resolve(root: &Path, rel: &str) -> AppResult<PathBuf> {
    let parts: Vec<&str> = rel.split('/').collect();
    let ok = (1..=2).contains(&parts.len()) && parts.iter().all(|p| is_plain_name(p));
    let candidate = root.join(rel);
    let normal = candidate
        .strip_prefix(root)
        .map(|p| p.components().all(|c| matches!(c, Component::Normal(_))))
        .unwrap_or(false);
    if ok && normal {
        Ok(candidate)
    } else {
        Err(AppError::new(
            ErrorKind::InvalidName,
            format!("invalid managed copy path {rel:?}"),
        ))
    }
}

/// Files directly in `root` or one folder deep. Symlinks are never
/// followed or counted.
fn walk(root: &Path) -> Vec<Entry> {
    let mut out = Vec::new();
    let Ok(top) = fs::read_dir(root) else {
        return out;
    };
    for item in top.flatten() {
        let Ok(ft) = item.file_type() else { continue };
        let name = item.file_name().to_string_lossy().into_owned();
        if ft.is_file() {
            push_entry(&mut out, item.path(), name);
        } else if ft.is_dir() {
            let Ok(inner) = fs::read_dir(item.path()) else {
                continue;
            };
            for child in inner.flatten() {
                if child.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    let child_name = child.file_name().to_string_lossy().into_owned();
                    push_entry(&mut out, child.path(), format!("{name}/{child_name}"));
                }
            }
        }
    }
    out
}

fn push_entry(out: &mut Vec<Entry>, path: PathBuf, rel: String) {
    if let Ok(meta) = fs::symlink_metadata(&path) {
        out.push(Entry {
            rel,
            path,
            bytes: meta.len(),
            modified: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        });
    }
}

fn is_temp(rel: &str) -> bool {
    rel.rsplit('/').next().is_some_and(|n| n.starts_with('.'))
}

/// Remove a file and, when it lived in a hash folder, the folder if
/// it is now empty.
fn remove_entry(root: &Path, path: &Path) -> bool {
    let removed = fs::remove_file(path).is_ok();
    if let Some(parent) = path.parent() {
        if parent != root {
            let _ = fs::remove_dir(parent); // only succeeds when empty
        }
    }
    removed
}

pub fn stats(root: &Path) -> Stats {
    walk(root)
        .iter()
        .filter(|e| !is_temp(&e.rel))
        .fold(Stats::default(), |acc, e| Stats {
            bytes: acc.bytes + e.bytes,
            files: acc.files + 1,
        })
}

pub fn clear(root: &Path) -> AppResult<()> {
    match fs::remove_dir_all(root) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.into()),
    }
}

/// Delete specific copies. Invalid or missing paths are skipped;
/// the return value counts real deletions.
pub fn remove(root: &Path, rels: &[String]) -> u64 {
    let mut removed = 0;
    for rel in rels {
        let Ok(path) = resolve(root, rel) else {
            continue;
        };
        let is_file = fs::symlink_metadata(&path)
            .map(|m| m.is_file())
            .unwrap_or(false);
        if is_file && remove_entry(root, &path) {
            removed += 1;
        }
    }
    removed
}

/// Housekeeping: drop stale temp files and unreferenced copies (but
/// not ones copied in moments ago), then evict the oldest referenced
/// copies until the total fits `max_bytes`.
pub fn prune(root: &Path, keep: &[String], max_bytes: u64, now: SystemTime) -> PruneReport {
    let keep: HashSet<&str> = keep.iter().map(String::as_str).collect();
    let mut report = PruneReport::default();
    let mut live = Vec::new();
    for entry in walk(root) {
        if is_temp(&entry.rel) {
            let age = now.duration_since(entry.modified).unwrap_or_default();
            if age > STALE_TEMP {
                remove_entry(root, &entry.path);
            }
            continue;
        }
        if keep.contains(entry.rel.as_str()) {
            live.push(entry);
            continue;
        }
        // A clock that went backwards reads as age zero: kept.
        let age = now.duration_since(entry.modified).unwrap_or_default();
        if age >= FRESH_COPY && remove_entry(root, &entry.path) {
            report.orphans_removed += 1;
        }
    }
    live.sort_by_key(|e| e.modified);
    let mut total: u64 = live.iter().map(|e| e.bytes).sum();
    for entry in &live {
        if total <= max_bytes {
            break;
        }
        if remove_entry(root, &entry.path) {
            total -= entry.bytes;
            report.evicted.push(entry.rel.clone());
        }
    }
    report.bytes_after = total;
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("paperwren-imports-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn put(root: &Path, rel: &str, bytes: usize) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, vec![0u8; bytes]).unwrap();
    }

    #[test]
    fn resolve_rejects_escapes() {
        let root = scratch("resolve");
        for bad in [
            "",
            "..",
            "../x",
            "a/../b",
            "/etc/passwd",
            ".hidden",
            "a/b/c",
            "a\\b",
            "a//b",
        ] {
            assert!(resolve(&root, bad).is_err(), "{bad}");
        }
        assert!(resolve(&root, "report.pdf").is_ok());
        assert!(resolve(&root, "3fa9c0/report.pdf").is_ok());
    }

    #[test]
    fn stats_counts_flat_and_nested_but_not_temp() {
        let root = scratch("stats");
        put(&root, "old.pdf", 10);
        put(&root, "abc/new.pdf", 20);
        put(&root, "abc/.new.pdf.tmp", 99);
        assert_eq!(
            stats(&root),
            Stats {
                bytes: 30,
                files: 2
            }
        );
    }

    #[test]
    fn remove_deletes_only_valid_paths_and_empty_folders() {
        let root = scratch("remove");
        put(&root, "abc/a.pdf", 1);
        put(&root, "b.pdf", 1);
        let n = remove(
            &root,
            &["abc/a.pdf".into(), "../b.pdf".into(), "missing.pdf".into()],
        );
        assert_eq!(n, 1);
        assert!(!root.join("abc").exists());
        assert!(root.join("b.pdf").exists());
    }

    #[test]
    fn prune_drops_orphans_then_evicts_oldest() {
        let root = scratch("prune");
        put(&root, "h1/old.pdf", 100);
        std::thread::sleep(Duration::from_millis(20));
        put(&root, "h2/new.pdf", 100);
        put(&root, "orphan.pdf", 50);
        // An hour on: the orphan is no longer a copy that just arrived.
        let report = prune(
            &root,
            &["h1/old.pdf".into(), "h2/new.pdf".into()],
            150,
            SystemTime::now() + Duration::from_secs(60 * 60),
        );
        assert_eq!(report.orphans_removed, 1);
        assert_eq!(report.evicted, vec!["h1/old.pdf".to_string()]);
        assert_eq!(report.bytes_after, 100);
        assert!(root.join("h2/new.pdf").exists());
    }

    #[test]
    fn prune_leaves_a_copy_that_just_arrived() {
        let root = scratch("fresh");
        put(&root, "h1/opening-now.pdf", 10);
        let report = prune(&root, &[], u64::MAX, SystemTime::now());
        assert_eq!(report.orphans_removed, 0);
        assert!(root.join("h1/opening-now.pdf").exists());
        // Once it is old enough and still unreferenced, it goes.
        let later = SystemTime::now() + FRESH_COPY + Duration::from_secs(1);
        let report = prune(&root, &[], u64::MAX, later);
        assert_eq!(report.orphans_removed, 1);
        assert!(!root.join("h1/opening-now.pdf").exists());
    }

    #[test]
    fn missing_root_is_empty_not_an_error() {
        let root = std::env::temp_dir().join("paperwren-imports-none-xyz");
        let _ = fs::remove_dir_all(&root);
        assert_eq!(stats(&root), Stats::default());
        assert!(clear(&root).is_ok());
        assert_eq!(prune(&root, &[], 0, SystemTime::now()).bytes_after, 0);
    }
}
