//! Small JSON key-value store: one file per key under a directory
//! the app owns. Keys are validated, never sanitized: silently
//! stripping characters would let two different keys share a file.

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::error::{AppError, AppResult, ErrorKind};

const MAX_KEY_LEN: usize = 64;

pub fn validate_key(key: &str) -> AppResult<()> {
    let ok = !key.is_empty()
        && key.len() <= MAX_KEY_LEN
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if ok {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorKind::InvalidKey,
            format!("invalid store key {key:?}"),
        ))
    }
}

fn path_for(dir: &Path, key: &str) -> AppResult<PathBuf> {
    validate_key(key)?;
    Ok(dir.join(format!("{key}.json")))
}

/// Missing keys read as `null`. A file that exists but is not valid
/// JSON is reported as `Corrupt` rather than hidden: the frontend
/// falls back to defaults and the next write repairs it.
pub fn get(dir: &Path, key: &str) -> AppResult<Value> {
    let path = path_for(dir, key)?;
    match fs::read(&path) {
        Ok(raw) => Ok(serde_json::from_slice(&raw)?),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
        Err(err) => Err(err.into()),
    }
}

/// Atomic write: temp file in the same directory, fsync, rename.
/// A crash mid-write leaves the previous value intact.
pub fn set(dir: &Path, key: &str, value: &Value) -> AppResult<()> {
    let path = path_for(dir, key)?;
    fs::create_dir_all(dir)?;
    let payload = serde_json::to_vec(value)?;
    let mut tmp = tempfile_in(dir, key)?;
    tmp.1.write_all(&payload)?;
    tmp.1.sync_all()?;
    drop(tmp.1);
    fs::rename(&tmp.0, &path).map_err(|err| {
        let _ = fs::remove_file(&tmp.0);
        AppError::from(err)
    })
}

/// A temp file whose name is unique per process, key and call.
fn tempfile_in(dir: &Path, key: &str) -> AppResult<(PathBuf, fs::File)> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let path = dir.join(format!(".{key}.{}.{n}.tmp", std::process::id()));
    let file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)?;
    Ok((path, file))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("paperwren-store-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn missing_key_reads_null() {
        let dir = scratch("missing");
        assert_eq!(get(&dir, "settings").unwrap(), Value::Null);
    }

    #[test]
    fn roundtrip_and_overwrite() {
        let dir = scratch("roundtrip");
        set(&dir, "recents", &json!([1, 2])).unwrap();
        set(&dir, "recents", &json!({"a": true})).unwrap();
        assert_eq!(get(&dir, "recents").unwrap(), json!({"a": true}));
        // No temp files survive a successful write.
        let leftovers = fs::read_dir(&dir)
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")
            })
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn rejects_unsafe_keys() {
        let dir = scratch("keys");
        for key in ["", "../x", "a/b", "a.b", "ключ", &"k".repeat(65)] {
            let err = set(&dir, key, &json!(1)).unwrap_err();
            assert_eq!(err.kind, ErrorKind::InvalidKey, "{key}");
        }
    }

    #[test]
    fn corrupt_file_is_reported() {
        let dir = scratch("corrupt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json"), b"{not json").unwrap();
        assert_eq!(get(&dir, "settings").unwrap_err().kind, ErrorKind::Corrupt);
    }
}
