//! The desktop window opens where, and as large as, it was left.
//!
//! The configuration creates it hidden (`visible: false`); it is put
//! back here, before anything is on screen, and then shown. Placing it
//! from the page meant a window that was seen at its default size and
//! then jumped, and a first screen that waited for the moves.
//!
//! The page keeps the place saved as the window moves (windowState.ts),
//! under the store key `window`: `{ x, y, w, h, maximized }` in physical
//! pixels, the outer position and the inner size. A place is used only
//! while enough of it is on a screen to grab (a monitor may have been
//! unplugged since); otherwise the window keeps its default size,
//! centred.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tauri::{PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

use crate::store;

const PLACE_KEY: &str = "window";
/// How much of the window must be on a screen to count as reachable
/// (the same rule as `reachable` in windowState.ts).
const GRIP: i64 = 80;
/// If showing the window has not worked by then, it is tried again: a
/// window that never appears is worse than one in the wrong place.
const SHOW_FALLBACK: Duration = Duration::from_millis(1500);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Place {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub maximized: bool,
}

/// A saved place, or None when it is missing or not a usable one (the
/// same checks as `normalizePlace` in windowState.ts).
pub fn place_of(value: &Value) -> Option<Place> {
    let n = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite())
            .map(f64::round)
    };
    let (x, y, w, h) = (n("x")?, n("y")?, n("w")?, n("h")?);
    let coord = |v: f64| (v.abs() <= 1_000_000.0).then_some(v as i32);
    let length = |v: f64| (200.0..=100_000.0).contains(&v).then_some(v as u32);
    Some(Place {
        x: coord(x)?,
        y: coord(y)?,
        w: length(w)?,
        h: length(h)?,
        maximized: value.get("maximized") == Some(&Value::Bool(true)),
    })
}

/// A monitor's rectangle in physical pixels.
#[derive(Debug, Clone, Copy)]
pub struct Screen {
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
}

/// True when enough of the title bar is on one of the screens to grab.
pub fn reachable(place: &Place, screens: &[Screen]) -> bool {
    let (x, y, w) = (place.x as i64, place.y as i64, place.w as i64);
    screens.iter().any(|s| {
        x + w - GRIP > s.x && x + GRIP < s.x + s.w && y >= s.y - 8 && y + GRIP / 2 < s.y + s.h
    })
}

/// Put the hidden window back where it was left, then show it. Whatever
/// fails on the way, the window is shown.
pub fn open<R: Runtime>(window: &WebviewWindow<R>, store_dir: Option<&Path>) {
    let shown = Arc::new(AtomicBool::new(false));
    {
        let shown = Arc::clone(&shown);
        let window = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(SHOW_FALLBACK);
            if !shown.load(Ordering::SeqCst) {
                let _ = window.show();
            }
        });
    }

    if let Some(dir) = store_dir {
        let saved = store::get(dir, PLACE_KEY).ok();
        if let Some(place) = saved.as_ref().and_then(place_of) {
            put_back(window, &place);
        }
    }

    if window.show().is_ok() {
        shown.store(true, Ordering::SeqCst);
    }
}

fn put_back<R: Runtime>(window: &WebviewWindow<R>, place: &Place) {
    let screens: Vec<Screen> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| Screen {
            x: m.position().x as i64,
            y: m.position().y as i64,
            w: m.size().width as i64,
            h: m.size().height as i64,
        })
        .collect();
    if reachable(place, &screens) {
        let at = PhysicalPosition::new(place.x, place.y);
        // Moved first, so that a move onto a screen of another scale has
        // been made (and the window rescaled for it) before the size is
        // set; then moved again in case that rescale shifted it.
        let _ = window.set_position(at);
        let _ = window.set_size(PhysicalSize::new(place.w, place.h));
        let _ = window.set_position(at);
    } else {
        let _ = window.center();
    }
    // The size above stays the one a maximised window goes back to. On
    // Windows and Linux a hidden window is only marked maximised, and
    // opens that way when shown; on macOS the zoom runs just after.
    if place.maximized {
        let _ = window.maximize();
    }
}

