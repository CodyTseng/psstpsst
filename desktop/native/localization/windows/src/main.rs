#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetLocaleInfoEx(locale: *const u16, kind: u32, data: *mut u16, size: i32) -> i32;
}

#[cfg(any(windows, test))]
fn clock_format(pattern: &[u16]) -> Option<bool> {
    let mut quoted = false;
    for &character in pattern {
        match character {
            0x27 => quoted = !quoted,
            0x48 if !quoted => return Some(true),
            0x68 if !quoted => return Some(false),
            _ => {}
        }
    }
    None
}

#[cfg(windows)]
fn read_clock(kind: u32) -> Option<bool> {
    // A null locale selects the current user and retains their format overrides.
    let mut pattern = [0u16; 128];
    let length = unsafe {
        GetLocaleInfoEx(
            std::ptr::null(),
            kind,
            pattern.as_mut_ptr(),
            pattern.len() as i32,
        )
    };
    if length <= 0 || length as usize > pattern.len() {
        return None;
    }
    clock_format(&pattern[..length as usize - 1])
}

#[cfg(windows)]
fn main() {
    const LOCALE_SSHORTTIME: u32 = 0x0079;
    const LOCALE_STIMEFORMAT: u32 = 0x1003;
    // Short-time preferences match the app's clocks. Retain long-time fallback
    // for systems that do not provide a short-time format.
    let format = read_clock(LOCALE_SSHORTTIME).or_else(|| read_clock(LOCALE_STIMEFORMAT));
    println!(
        "{}",
        match format {
            Some(true) => "24h",
            Some(false) => "12h",
            None => "unknown",
        }
    );
}

#[cfg(not(windows))]
fn main() {
    println!("unknown");
}

#[cfg(test)]
mod tests {
    use super::clock_format;

    #[test]
    fn detects_the_hour_token_and_ignores_quoted_literals() {
        for (pattern, expected) in [
            ("HH:mm", Some(true)),
            ("H:mm:ss", Some(true)),
            ("h:mm tt", Some(false)),
            ("tt hh:mm", Some(false)),
            ("'H' h:mm tt", Some(false)),
            ("'h' HH:mm", Some(true)),
            ("'it''s H' h:mm tt", Some(false)),
            ("'HH:mm'", None),
            ("", None),
        ] {
            assert_eq!(
                clock_format(&pattern.encode_utf16().collect::<Vec<_>>()),
                expected,
                "{pattern}"
            );
        }
    }
}
