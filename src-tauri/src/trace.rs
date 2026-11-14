//! Start-up timings for bug reports. With `PAPERWREN_TRACE=1` in the
//! environment the app writes one line per milestone to stderr, as
//! `paperwren-trace: <ms> <milestone>`, with the milliseconds counted from
//! the first thing `run` does. Without it nothing is written, and a mark
//! costs one atomic read.
//!
//! The web layer reports its own milestones through the `trace_mark`
//! command (lib.rs), so every line comes from one clock.

use std::io::Write;
use std::sync::OnceLock;
use std::time::Instant;

/// The variable that turns the trace on.
const VARIABLE: &str = "PAPERWREN_TRACE";

/// Longest milestone name taken from the web layer.
const NAME_MAX: usize = 60;

static START: OnceLock<Instant> = OnceLock::new();
static ENABLED: OnceLock<bool> = OnceLock::new();

/// Whether `value` of the variable asks for the trace: anything but
/// empty or `0`.
fn asks_for_trace(value: Option<&str>) -> bool {
    matches!(value, Some(v) if !v.is_empty() && v != "0")
}

/// Whether the trace is on. The variable is read once.
pub fn enabled() -> bool {
    *ENABLED.get_or_init(|| asks_for_trace(std::env::var(VARIABLE).ok().as_deref()))
}

/// One line of the trace.
fn line(ms: u128, milestone: &str) -> String {
    format!("paperwren-trace: {ms} {milestone}")
}

/// The name of a web milestone as it is printed: one line of plain
/// text, cut short, so a page cannot write anything else into the log.
fn web_name(name: &str) -> String {
    let text: String = name
        .chars()
        .filter(|c| !c.is_control())
        .take(NAME_MAX)
        .collect();
    format!("web: {text}")
}

/// What a bug report needs to know about the machine, on the lines
/// where it matters (the display and renderer choices of Linux).
#[cfg(target_os = "linux")]
fn session_facts() -> String {
    let mut text = String::new();
    for name in [
        "XDG_SESSION_TYPE",
        "WEBKIT_DISABLE_DMABUF_RENDERER",
        "WEBKIT_DISABLE_COMPOSITING_MODE",
    ] {
        if let Ok(value) = std::env::var(name) {
            text.push_str(&format!(" {name}={value}"));
        }
    }
    if std::env::var_os("APPIMAGE").is_some() {
        text.push_str(" appimage=yes");
    }
    text
}

#[cfg(not(target_os = "linux"))]
fn session_facts() -> String {
    String::new()
}

fn environment() -> String {
    format!(
        "environment os={} arch={} version={}{}",
        std::env::consts::OS,
        std::env::consts::ARCH,
        env!("CARGO_PKG_VERSION"),
        session_facts()
    )
}

fn print(ms: u128, milestone: &str) {
    // A closed stderr (a Windows app has none) is not an error here.
    let _ = writeln!(std::io::stderr().lock(), "{}", line(ms, milestone));
}

/// Starts the clock, and with the trace on says what machine this is.
/// The first call of `run`.
pub fn start() {
    START.get_or_init(Instant::now);
    if enabled() {
        print(0, "process start");
        print(0, &environment());
    }
}

/// Writes a milestone, with the time since `start`.
pub fn mark(milestone: &str) {
    if !enabled() {
        return;
    }
    let ms = START.get_or_init(Instant::now).elapsed().as_millis();
    print(ms, milestone);
}

/// Writes a milestone the web layer reached.
pub fn mark_web(name: &str) {
    if enabled() {
        mark(&web_name(name));
    }
}

#[cfg(test)]
mod tests {
    use super::{asks_for_trace, line, web_name};

    #[test]
    fn only_a_real_value_turns_the_trace_on() {
        assert!(asks_for_trace(Some("1")));
        assert!(asks_for_trace(Some("yes")));
        assert!(!asks_for_trace(None));
        assert!(!asks_for_trace(Some("")));
        assert!(!asks_for_trace(Some("0")));
    }

    #[test]
    fn a_line_has_the_milliseconds_then_the_milestone() {
        assert_eq!(line(1234, "window created"), "paperwren-trace: 1234 window created");
    }

    #[test]
    fn a_web_milestone_is_one_short_line() {
        assert_eq!(web_name("Home ready"), "web: Home ready");
        assert_eq!(web_name("a\nb\u{1b}[0m"), "web: ab[0m");
        assert_eq!(web_name(&"x".repeat(500)).len(), "web: ".len() + 60);
    }
}
