//! Logging to stderr, one line per message:
//! `[YYYY-MM-DD HH:MM:SS.mmmZ] [Component] message` (UTC).
//!
//! The desktop keeps these lines in its logs and attaches the last ones to
//! crash reports. So never log transcript, clipboard or field text, key codes
//! or window titles. Log lengths and counts. Wrap user text in [`Redacted`]
//! when a message must refer to it.

use std::fmt;
use std::io::Write;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

macro_rules! log {
    ($component:expr, $($arg:tt)*) => {
        $crate::log::write($component, format_args!($($arg)*))
    };
}
pub(crate) use log;

pub fn write(component: &str, message: fmt::Arguments<'_>) {
    let message = message.to_string().replace(['\r', '\n'], " ");
    let since_epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let line = format!("[{}] [{component}] {message}\n", timestamp(since_epoch));
    // One write per line, so that lines from different threads do not mix.
    let _ = std::io::stderr().lock().write_all(line.as_bytes());
}

/// User text in a log message. It formats as its length, never its content.
/// It has no Debug, so `{:?}` cannot print it either.
pub struct Redacted<'a>(pub &'a str);

impl fmt::Display for Redacted<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "len={}", self.0.chars().count())
    }
}

/// Logs a panic as one line. Our panic messages never contain user text.
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown location".to_owned());
        let payload = info.payload();
        let message = payload
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
            .unwrap_or("no message");
        write("Panic", format_args!("panic at {location}: {message}"));
    }));
}

fn timestamp(since_epoch: Duration) -> String {
    let secs = since_epoch.as_secs();
    let (year, month, day) = civil_from_days((secs / 86_400) as i64);
    let second_of_day = secs % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}.{:03}Z",
        second_of_day / 3600,
        second_of_day / 60 % 60,
        second_of_day % 60,
        since_epoch.subsec_millis()
    )
}

/// Days since 1970-01-01 to a proleptic Gregorian date (H. Hinnant's
/// days-to-civil algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_index + 2) / 5 + 1) as u32;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    } as u32;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_is_utc_with_milliseconds() {
        assert_eq!(
            timestamp(Duration::from_millis(1_700_000_000_123)),
            "2023-11-14 22:13:20.123Z"
        );
        // The leap day at the end of a 400-year era (eras start on 1 March).
        assert_eq!(
            timestamp(Duration::from_millis(951_782_400_000)),
            "2000-02-29 00:00:00.000Z"
        );
        assert_eq!(timestamp(Duration::ZERO), "1970-01-01 00:00:00.000Z");
    }

    #[test]
    fn redacted_text_shows_only_its_length() {
        let text = "pick up milk ü";
        assert_eq!(format!("{}", Redacted(text)), "len=14");
    }
}
