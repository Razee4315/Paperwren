//! Small JSON key-value store: one file per key under a directory
//! the app owns. Keys are validated, never sanitized: silently
//! stripping characters would let two different keys share a file.

use std::fs;
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::error::{AppError, AppResult, ErrorKind};

const MAX_KEY_LEN: usize = 64;

/// The most one stored value may hold, written or read. The largest
/// real ones (recents, a thumbnail as a data URL) are well under 1 MiB;
/// the bound means no call can make the app hold, or write, much more.
const MAX_VALUE_BYTES: u64 = 16 * 1024 * 1024;

/// Keys of a cache the app makes again when it is missing: page
/// thumbnails. Their writes are not flushed to disk one by one (an
/// fsync costs 5 to 50 ms each, one per document opened); a crash may
/// lose the newest, which then read as corrupt or missing and are drawn
/// again.
const CACHE_PREFIX: &str = "thumb_";

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
    let file = match fs::File::open(&path) {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Value::Null),
        Err(err) => return Err(err.into()),
    };
    // Read one byte past the bound, so a file that grew larger is told
    // from one exactly at it without trusting its stated size.
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut raw = Vec::with_capacity(size.min(MAX_VALUE_BYTES) as usize);
    file.take(MAX_VALUE_BYTES + 1).read_to_end(&mut raw)?;
    if raw.len() as u64 > MAX_VALUE_BYTES {
        return Err(AppError::new(
            ErrorKind::Corrupt,
            "stored value is too large",
        ));
    }
    Ok(serde_json::from_slice(&raw)?)
}

/// Atomic write: temp file in the same directory, fsync, rename.
/// A crash mid-write leaves the previous value intact. A thumbnail is
/// not flushed first (CACHE_PREFIX). A value larger than
/// MAX_VALUE_BYTES is refused, and the one stored stays.
///
/// `null` removes the key's file instead: a missing key already reads
/// as `null`, and a 4-byte `null` file per forgotten key (a thumbnail
/// of every recent ever removed) would stay forever.
pub fn set(dir: &Path, key: &str, value: &Value) -> AppResult<()> {
    let path = path_for(dir, key)?;
    if value.is_null() {
        return match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(err.into()),
        };
    }
    let payload = serde_json::to_vec(value)?;
    if payload.len() as u64 > MAX_VALUE_BYTES {
        return Err(AppError::new(ErrorKind::Io, "value is too large to store"));
    }
    fs::create_dir_all(dir)?;
    let mut tmp = tempfile_in(dir, key)?;
    let written = tmp.1.write_all(&payload).and_then(|()| {
        if key.starts_with(CACHE_PREFIX) {
            Ok(())
        } else {
            tmp.1.sync_all()
        }
    });
    drop(tmp.1);
    if let Err(err) = written {
        let _ = fs::remove_file(&tmp.0);
        return Err(err.into());
    }
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
    fn null_removes_the_file() {
        let dir = scratch("null");
        set(&dir, "thumb_f1", &json!("data:image/jpeg;base64,AA")).unwrap();
        assert!(dir.join("thumb_f1.json").exists());
        set(&dir, "thumb_f1", &Value::Null).unwrap();
        assert!(!dir.join("thumb_f1.json").exists());
        assert_eq!(get(&dir, "thumb_f1").unwrap(), Value::Null);
        // Again, and for a key never written, in a folder never made:
        // nothing to remove is not a failure, and nothing is created.
        set(&dir, "thumb_f1", &Value::Null).unwrap();
        let none = scratch("null-none");
        set(&none, "thumb_f2", &Value::Null).unwrap();
        assert!(!none.exists());
        // Invalid keys are still refused.
        assert_eq!(
            set(&dir, "../x", &Value::Null).unwrap_err().kind,
            ErrorKind::InvalidKey
        );
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
    fn a_value_too_large_is_refused_both_ways() {
        let dir = scratch("large");
        set(&dir, "recents", &json!([1])).unwrap();
        let huge = Value::String("a".repeat(MAX_VALUE_BYTES as usize));
        assert_eq!(set(&dir, "recents", &huge).unwrap_err().kind, ErrorKind::Io);
        // The value stored before stays, and no temp file is left.
        assert_eq!(get(&dir, "recents").unwrap(), json!([1]));
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        // A file grown past the bound some other way is not read whole.
        fs::write(
            dir.join("settings.json"),
            vec![b' '; MAX_VALUE_BYTES as usize + 1],
        )
        .unwrap();
        assert_eq!(get(&dir, "settings").unwrap_err().kind, ErrorKind::Corrupt);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_thumbnail_round_trips_without_a_flush() {
        let dir = scratch("thumb");
        set(&dir, "thumb_a1", &json!("data:image/jpeg;base64,AA")).unwrap();
        set(&dir, "thumb_a1", &json!("data:image/jpeg;base64,BB")).unwrap();
        assert_eq!(
            get(&dir, "thumb_a1").unwrap(),
            json!("data:image/jpeg;base64,BB")
        );
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_file_is_reported() {
        let dir = scratch("corrupt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json"), b"{not json").unwrap();
        assert_eq!(get(&dir, "settings").unwrap_err().kind, ErrorKind::Corrupt);
    }
}
